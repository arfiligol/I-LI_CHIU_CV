#!/usr/bin/env python3
"""Render report equations from a validated presentation spec."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

import yaml
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

_EQUATION_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$")
_HEX_COLOR_RE = re.compile(r"^[0-9A-Fa-f]{6}$")
_SVG_SIZE_RE = re.compile(
    r"<svg\b[^>]*\bwidth=['\"](?P<width>[0-9.]+)pt['\"][^>]*"
    r"\bheight=['\"](?P<height>[0-9.]+)pt['\"]"
)
_MIN_CANVAS_HEIGHT_PT = 24.0


class DuplicateKeyLoader(yaml.SafeLoader):
    """YAML loader that rejects duplicate mapping keys."""


def _construct_unique_mapping(
    loader: DuplicateKeyLoader, node: yaml.nodes.MappingNode
) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in mapping:
            raise ValueError(f"Duplicate YAML key in equation registry: {key}")
        mapping[key] = loader.construct_object(value_node)
    return mapping


DuplicateKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


class EquationFormulaSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str
    latex: str
    tags: Tuple[str, ...] = ()
    description: str

    @field_validator("title", "latex", "description")
    @classmethod
    def _validate_nonempty(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("equation formula fields must not be empty")
        return normalized


class EquationRegistry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    formulas: Dict[str, EquationFormulaSpec]

    @model_validator(mode="after")
    def _validate_formula_ids(self) -> "EquationRegistry":
        invalid = [
            formula_id for formula_id in self.formulas if not _EQUATION_ID_RE.match(formula_id)
        ]
        if invalid:
            raise ValueError(f"invalid equation formula IDs: {invalid}")
        return self

    def require(self, formula_id: str) -> EquationFormulaSpec:
        try:
            return self.formulas[formula_id]
        except KeyError as error:
            available = ", ".join(sorted(self.formulas))
            raise KeyError(f"Unknown equation formula ID {formula_id!r}. Available: {available}") from error


@dataclass(frozen=True)
class RenderedEquation:
    equation_id: str
    latex_hash: str
    cache_key: str
    svg_path: Path
    png_path: Path
    color: str
    dpi: int
    scale: float
    raw_svg_width_pt: float
    raw_svg_height_pt: float
    canvas_width_pt: float
    canvas_height_pt: float


@dataclass(frozen=True)
class SvgDimensions:
    width_pt: float
    height_pt: float


def load_registry(path: Path) -> EquationRegistry:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.load(handle, Loader=DuplicateKeyLoader) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Equation registry must be a YAML mapping: {path}")
    return EquationRegistry.model_validate({"formulas": data})


def render_equation(
    equation_id: str,
    *,
    registry: EquationRegistry,
    output_dir: Path,
    color: str,
    dpi: int,
    scale: float,
    force: bool,
    min_canvas_height_pt: float = _MIN_CANVAS_HEIGHT_PT,
) -> RenderedEquation:
    if dpi <= 0:
        raise ValueError(f"Equation render dpi must be positive: {dpi}")
    if scale <= 0:
        raise ValueError(f"Equation render scale must be positive: {scale}")
    if min_canvas_height_pt <= 0:
        raise ValueError(f"Equation canvas height must be positive: {min_canvas_height_pt}")
    formula = registry.require(equation_id)
    normalized_color = _normalize_hex_color(color)
    normalized_latex = _normalize_latex_math(formula.latex)
    latex_hash = _short_hash(normalized_latex)
    cache_key = _short_hash(
        "\0".join(
            [
                equation_id,
                normalized_latex,
                normalized_color,
                str(dpi),
                f"{scale:.6g}",
                f"min-canvas-height-pt={min_canvas_height_pt:.6g}",
            ]
        ),
        length=16,
    )
    stem = f"{_safe_equation_id(equation_id)}-{cache_key}"
    output_dir.mkdir(parents=True, exist_ok=True)
    svg_path = output_dir / f"{stem}.svg"
    png_path = output_dir / f"{stem}.png"
    metadata_path = output_dir / f"{stem}.json"
    if not force and svg_path.exists() and png_path.exists() and metadata_path.exists():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        return RenderedEquation(
            equation_id=equation_id,
            latex_hash=latex_hash,
            cache_key=cache_key,
            svg_path=svg_path,
            png_path=png_path,
            color=normalized_color,
            dpi=dpi,
            scale=scale,
            raw_svg_width_pt=metadata["raw_svg_width_pt"],
            raw_svg_height_pt=metadata["raw_svg_height_pt"],
            canvas_width_pt=metadata["canvas_width_pt"],
            canvas_height_pt=metadata["canvas_height_pt"],
        )

    latex_binary = _require_tool("latex")
    dvisvgm_binary = _require_tool("dvisvgm")
    rsvg_binary = _require_tool("rsvg-convert")
    with tempfile.TemporaryDirectory(prefix="presentation-equation-") as tmp_name:
        tmp_dir = Path(tmp_name)
        tex_path = tmp_dir / "equation.tex"
        tex_path.write_text(_latex_document(normalized_latex, color=normalized_color), encoding="utf-8")
        _run_checked([latex_binary, "-interaction=nonstopmode", "-halt-on-error", tex_path.name], cwd=tmp_dir)
        dvi_path = tmp_dir / "equation.dvi"
        if not dvi_path.exists():
            raise RuntimeError(f"LaTeX did not produce expected DVI file: {dvi_path}")
        raw_svg_path = tmp_dir / "equation.raw.svg"
        _run_checked([dvisvgm_binary, "--no-fonts", "--exact", f"--output={raw_svg_path}", str(dvi_path)], cwd=tmp_dir)
        raw_dimensions = _read_svg_dimensions(raw_svg_path)
        canvas_width_pt = raw_dimensions.width_pt
        canvas_height_pt = max(raw_dimensions.height_pt, min_canvas_height_pt)
        top_offset_pt = (canvas_height_pt - raw_dimensions.height_pt) / 2
        effective_dpi = str(max(round(dpi * scale), 1))
        normalized_canvas_args = [
            "--page-width",
            _format_pt(canvas_width_pt),
            "--page-height",
            _format_pt(canvas_height_pt),
            "--left",
            "0pt",
            "--top",
            _format_pt(top_offset_pt),
        ]
        _run_checked(
            [
                rsvg_binary,
                "--format",
                "svg",
                *normalized_canvas_args,
                "--output",
                str(svg_path),
                str(raw_svg_path),
            ],
            cwd=tmp_dir,
        )
        _run_checked(
            [
                rsvg_binary,
                "--dpi-x",
                effective_dpi,
                "--dpi-y",
                effective_dpi,
                *normalized_canvas_args,
                "--output",
                str(png_path),
                str(raw_svg_path),
            ],
            cwd=tmp_dir,
        )
    metadata = {
        "raw_svg_width_pt": raw_dimensions.width_pt,
        "raw_svg_height_pt": raw_dimensions.height_pt,
        "canvas_width_pt": canvas_width_pt,
        "canvas_height_pt": canvas_height_pt,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return RenderedEquation(
        equation_id=equation_id,
        latex_hash=latex_hash,
        cache_key=cache_key,
        svg_path=svg_path,
        png_path=png_path,
        color=normalized_color,
        dpi=dpi,
        scale=scale,
        raw_svg_width_pt=raw_dimensions.width_pt,
        raw_svg_height_pt=raw_dimensions.height_pt,
        canvas_width_pt=canvas_width_pt,
        canvas_height_pt=canvas_height_pt,
    )


def _latex_document(latex: str, *, color: str) -> str:
    return "\n".join(
        [
            r"\documentclass{article}",
            r"\usepackage[active,tightpage]{preview}",
            r"\usepackage{xcolor}",
            r"\usepackage{amsmath}",
            r"\pagestyle{empty}",
            r"\begin{document}",
            r"\begin{preview}",
            rf"{{\color[HTML]{{{color}}}\ensuremath{{\displaystyle {latex}}}}}",
            r"\end{preview}",
            r"\end{document}",
            "",
        ]
    )


def _run_checked(command: list[str], *, cwd: Path) -> None:
    try:
        subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        output = "\n".join(part for part in (error.stdout, error.stderr) if part)
        raise RuntimeError(f"Equation render command failed: {' '.join(command)}\n{output}") from error


def _require_tool(name: str) -> str:
    binary = shutil.which(name)
    if binary is None:
        raise RuntimeError(f"{name} is required to render report equations.")
    return binary


def _read_svg_dimensions(path: Path) -> SvgDimensions:
    header = path.read_text(encoding="utf-8", errors="ignore")[:1024]
    match = _SVG_SIZE_RE.search(header)
    if not match:
        raise ValueError(f"Could not read dvisvgm SVG width/height in pt: {path}")
    return SvgDimensions(
        width_pt=float(match.group("width")),
        height_pt=float(match.group("height")),
    )


def _format_pt(value: float) -> str:
    return f"{value:.6f}pt"


def _normalize_hex_color(color: str) -> str:
    normalized = color.strip().lstrip("#")
    if not _HEX_COLOR_RE.match(normalized):
        raise ValueError(f"Equation color must be a 6-digit hex color: {color!r}")
    return normalized.upper()


def _normalize_latex_math(latex: str) -> str:
    normalized = latex.strip()
    for start, end in (("$$", "$$"), (r"\[", r"\]"), ("$", "$")):
        if normalized.startswith(start) and normalized.endswith(end):
            return normalized[len(start) : -len(end)].strip()
    return normalized


def _safe_equation_id(equation_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", equation_id.strip())


def _short_hash(value: str, *, length: int = 12) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec-json", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--out-json", required=True, type=Path)
    parser.add_argument("--color", default="2D3748")
    parser.add_argument("--dpi", type=int, default=360)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--min-canvas-height-pt", type=float, default=_MIN_CANVAS_HEIGHT_PT)
    parser.add_argument("--force", action="store_true")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    spec = json.loads(args.spec_json.read_text(encoding="utf-8"))
    registry_path = spec.get("equation_registry_resolved")
    equation_ids = spec.get("equation_ids", [])
    if not equation_ids:
        args.out_json.parent.mkdir(parents=True, exist_ok=True)
        args.out_json.write_text(json.dumps({"assets": {}}, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"rendered": 0}))
        return
    if not registry_path:
        raise ValueError("spec references equations but has no equation_registry_resolved")

    registry = load_registry(Path(registry_path))
    rendered = {}
    for equation_id in equation_ids:
        result = render_equation(
            equation_id,
            registry=registry,
            output_dir=args.out_dir,
            color=args.color,
            dpi=args.dpi,
            scale=args.scale,
            force=args.force,
            min_canvas_height_pt=args.min_canvas_height_pt,
        )
        formula = registry.require(equation_id)
        rendered[equation_id] = {
            "title": formula.title,
            "description": formula.description,
            "latex_hash": result.latex_hash,
            "cache_key": result.cache_key,
            "svg_path": str(result.svg_path.resolve()),
            "png_path": str(result.png_path.resolve()),
            "color": result.color,
            "dpi": result.dpi,
            "scale": result.scale,
            "raw_svg_width_pt": result.raw_svg_width_pt,
            "raw_svg_height_pt": result.raw_svg_height_pt,
            "canvas_width_pt": result.canvas_width_pt,
            "canvas_height_pt": result.canvas_height_pt,
        }
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps({"assets": rendered}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rendered": len(rendered)}))


if __name__ == "__main__":
    main()
