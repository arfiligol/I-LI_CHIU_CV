#!/usr/bin/env python3
"""Validate a YAML presentation report spec and write normalized JSON."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]*$")


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
            raise ValueError(f"Duplicate YAML key: {key}")
        mapping[key] = loader.construct_object(value_node)
    return mapping


DuplicateKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


class MetadataSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    subtitle: Optional[str] = None
    author: Optional[str] = None
    date: Optional[str] = None
    defense_label: Optional[str] = None
    advisor: Optional[str] = None
    department: Optional[str] = None
    institution: Optional[str] = None
    year: Optional[str] = None
    output_name: str = "presentation"


class ThemeSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = "tech-slate"
    mode: Literal["light", "dark"] = "light"
    font_title: str = "Helvetica Neue"
    font_body: str = "Helvetica Neue"


class RichTextPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Optional[str] = None
    formula: Optional[str] = None

    @model_validator(mode="after")
    def _validate_single_part_kind(self) -> "RichTextPart":
        if bool(self.text) == bool(self.formula):
            raise ValueError("rich text part must define exactly one of text or formula")
        return self


class RichTextSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parts: List[RichTextPart]

    @model_validator(mode="after")
    def _validate_parts(self) -> "RichTextSpec":
        if not self.parts:
            raise ValueError("rich text must contain at least one part")
        return self


TextValue = Union[str, RichTextSpec]


class AssetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    alt: str
    role: Optional[str] = None


class MetricSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: TextValue
    value: TextValue
    context: Optional[TextValue] = None


class FigureSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset: str
    caption: Optional[TextValue] = None
    fit: Literal["contain", "cover"] = "contain"
    role: Optional[str] = None


class EquationRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: Optional[TextValue] = None
    role: Optional[str] = None
    y_offset: float = 0


class ColumnSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Optional[TextValue] = None
    body: List[TextValue] = Field(default_factory=list)
    bullets: List[TextValue] = Field(default_factory=list)
    equation: Optional[str] = None


class StepSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: TextValue
    detail: Optional[TextValue] = None


class TableSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headers: List[str]
    rows: List[List[TextValue]]
    formula_columns: List[str] = Field(default_factory=list)
    source: Optional[str] = None

    @model_validator(mode="after")
    def _validate_table_contract(self) -> "TableSpec":
        width = len(self.headers)
        bad_rows = [index for index, row in enumerate(self.rows, start=1) if len(row) != width]
        if bad_rows:
            raise ValueError(f"table rows must match header width {width}; bad rows: {bad_rows}")
        duplicate_headers = _duplicates(self.headers)
        if self.formula_columns and duplicate_headers:
            raise ValueError(
                "table headers must be unique when formula_columns names columns; "
                f"duplicates: {duplicate_headers}"
            )
        duplicate_formula_columns = _duplicates(self.formula_columns)
        if duplicate_formula_columns:
            raise ValueError(f"duplicate table formula_columns: {duplicate_formula_columns}")
        unknown_formula_columns = sorted(set(self.formula_columns) - set(self.headers))
        if unknown_formula_columns:
            raise ValueError(
                f"table formula_columns must name declared headers: {unknown_formula_columns}"
            )
        formula_column_indexes = {
            self.headers.index(header): header for header in self.formula_columns
        }
        invalid_formula_cells: list[str] = []
        for row_index, row in enumerate(self.rows, start=1):
            for column_index, header in formula_column_indexes.items():
                cell = row[column_index]
                if not isinstance(cell, RichTextSpec) or not any(
                    part.formula for part in cell.parts
                ):
                    invalid_formula_cells.append(f"row {row_index}, column {header!r}")
        if invalid_formula_cells:
            locations = "; ".join(invalid_formula_cells)
            raise ValueError(
                "table formula_columns require rich-text cells with at least one formula "
                f"part; invalid cells: {locations}"
            )
        return self


class SymbolSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    formula: str
    meaning: str

    @field_validator("formula")
    @classmethod
    def _validate_formula_id(cls, value: str) -> str:
        if not _ID_RE.match(value):
            raise ValueError(f"invalid formula id: {value!r}")
        return value


class SlideSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    layout: Literal[
        "cover",
        "section",
        "concept",
        "comparison",
        "workflow",
        "loss_tree",
        "circuit_question",
        "route_workflow",
        "derivation_stack",
        "figure",
        "evidence_pair",
        "result_focus",
        "two_figures",
        "table",
        "appendix_index",
        "references",
    ]
    title: TextValue
    kicker: Optional[str] = None
    mode: Optional[Literal["light", "dark"]] = None
    subtitle: Optional[TextValue] = None
    body: List[TextValue] = Field(default_factory=list)
    bullets: List[TextValue] = Field(default_factory=list)
    callouts: List[TextValue] = Field(default_factory=list)
    metrics: List[MetricSpec] = Field(default_factory=list)
    figures: List[FigureSpec] = Field(default_factory=list)
    equations: List[EquationRef] = Field(default_factory=list)
    columns: List[ColumnSpec] = Field(default_factory=list)
    steps: List[StepSpec] = Field(default_factory=list)
    table: Optional[TableSpec] = None
    footer: Optional[TextValue] = None
    notes: List[TextValue] = Field(default_factory=list)
    symbol_key: List[str] = Field(default_factory=list)
    symbol_key_position: Literal["bottom", "top", "right", "none"] = "bottom"

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not _ID_RE.match(value):
            raise ValueError(f"invalid slide id: {value!r}")
        return value


class ReportSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metadata: MetadataSpec
    theme: ThemeSpec = Field(default_factory=ThemeSpec)
    equation_registry: Optional[str] = None
    symbol_registry: Dict[str, SymbolSpec] = Field(default_factory=dict)
    assets: Dict[str, AssetSpec] = Field(default_factory=dict)
    slides: List[SlideSpec]

    @model_validator(mode="after")
    def _validate_refs(self) -> "ReportSpec":
        if not self.slides:
            raise ValueError("report spec must define at least one slide")
        duplicate_slide_ids = _duplicates(slide.id for slide in self.slides)
        if duplicate_slide_ids:
            raise ValueError(f"duplicate slide ids: {duplicate_slide_ids}")
        for asset_id in self.assets:
            if not _ID_RE.match(asset_id):
                raise ValueError(f"invalid asset id: {asset_id!r}")
        for symbol_id in self.symbol_registry:
            if not _ID_RE.match(symbol_id):
                raise ValueError(f"invalid symbol id: {symbol_id!r}")
        missing_assets: list[str] = []
        missing_symbols: list[str] = []
        for slide in self.slides:
            for figure in slide.figures:
                if figure.asset not in self.assets:
                    missing_assets.append(f"{slide.id}:{figure.asset}")
            for symbol_id in slide.symbol_key:
                if symbol_id not in self.symbol_registry:
                    missing_symbols.append(f"{slide.id}:{symbol_id}")
        if missing_assets:
            raise ValueError(f"unknown figure asset refs: {missing_assets}")
        if missing_symbols:
            raise ValueError(f"unknown symbol refs: {missing_symbols}")
        return self


def _duplicates(values: Any) -> List[str]:
    seen: set = set()
    duplicates: set = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def _load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.load(handle, Loader=DuplicateKeyLoader)


def _resolve_path(raw: str, *, spec_root: Path, workspace: Optional[Path]) -> str:
    path = Path(raw)
    if path.is_absolute():
        return str(path)
    candidates = [spec_root / path]
    if workspace is not None:
        candidates.append(workspace / path)
    for candidate in candidates:
        if candidate.exists():
            return str(candidate.resolve())
    return str(candidates[0].resolve())


def _collect_equation_ids(spec: ReportSpec) -> List[str]:
    ids: set = set()
    for slide in spec.slides:
        ids.update(_collect_text_equation_ids(slide.title))
        ids.update(_collect_text_equation_ids(slide.subtitle))
        ids.update(_collect_text_equation_ids(slide.footer))
        for value in [*slide.body, *slide.bullets, *slide.callouts, *slide.notes]:
            ids.update(_collect_text_equation_ids(value))
        ids.update(eq.id for eq in slide.equations)
        for equation in slide.equations:
            ids.update(_collect_text_equation_ids(equation.label))
        for figure in slide.figures:
            ids.update(_collect_text_equation_ids(figure.caption))
        for metric in slide.metrics:
            ids.update(_collect_text_equation_ids(metric.label))
            ids.update(_collect_text_equation_ids(metric.value))
            ids.update(_collect_text_equation_ids(metric.context))
        for step in slide.steps:
            ids.update(_collect_text_equation_ids(step.label))
            ids.update(_collect_text_equation_ids(step.detail))
        for column in slide.columns:
            ids.update(_collect_text_equation_ids(column.title))
            for value in [*column.body, *column.bullets]:
                ids.update(_collect_text_equation_ids(value))
        ids.update(column.equation for column in slide.columns if column.equation)
        if slide.table:
            for row in slide.table.rows:
                for cell in row:
                    ids.update(_collect_text_equation_ids(cell))
        for symbol_id in slide.symbol_key:
            symbol = spec.symbol_registry.get(symbol_id)
            if symbol:
                ids.add(symbol.formula)
    return sorted(ids)


def _collect_text_equation_ids(value: Optional[TextValue]) -> set[str]:
    if not isinstance(value, RichTextSpec):
        return set()
    return {part.formula for part in value.parts if part.formula}


def normalize(spec: ReportSpec, *, spec_path: Path, workspace: Optional[Path]) -> Dict[str, Any]:
    spec_root = spec_path.parent.resolve()
    data = spec.model_dump(mode="json")
    data["_paths"] = {
        "spec": str(spec_path.resolve()),
        "spec_root": str(spec_root),
        "workspace": str(workspace.resolve()) if workspace is not None else None,
    }
    for asset in data["assets"].values():
        asset["resolved_path"] = _resolve_path(asset["path"], spec_root=spec_root, workspace=workspace)
    if spec.equation_registry:
        data["equation_registry_resolved"] = _resolve_path(
            spec.equation_registry, spec_root=spec_root, workspace=workspace
        )
    else:
        data["equation_registry_resolved"] = None
    data["equation_ids"] = _collect_equation_ids(spec)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--out-json", type=Path)
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    raw = _load_yaml(args.spec)
    spec = ReportSpec.model_validate(raw)
    data = normalize(spec, spec_path=args.spec, workspace=args.workspace)

    missing = [
        (asset_id, asset["resolved_path"])
        for asset_id, asset in data["assets"].items()
        if not Path(asset["resolved_path"]).is_file()
    ]
    if missing:
        formatted = ", ".join(f"{asset_id} -> {path}" for asset_id, path in missing)
        raise FileNotFoundError(f"missing declared assets: {formatted}")
    if data["equation_ids"] and not data["equation_registry_resolved"]:
        raise ValueError("slides reference equations but equation_registry is not set")
    if data["equation_registry_resolved"] and not Path(data["equation_registry_resolved"]).is_file():
        raise FileNotFoundError(
            f"missing equation registry: {data['equation_registry_resolved']}"
        )

    if args.out_json:
        args.out_json.parent.mkdir(parents=True, exist_ok=True)
        args.out_json.write_text(f"{json.dumps(data, indent=2)}\n", encoding="utf-8")
    print(json.dumps({"slides": len(spec.slides), "equations": len(data["equation_ids"])}))


if __name__ == "__main__":
    main()
