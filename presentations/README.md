# Presentation Pipeline

This project uses a YAML spec-driven presentation pipeline for generated,
editable PPTX decks. The pipeline is intentionally separate from the Astro CV
site source of truth.

## Tools

- YAML report specs declare deck metadata, theme, assets, equations, slides,
  proof objects, and appendix content.
- `scripts/presentations/validate_report_spec.py` validates YAML with Pydantic
  and PyYAML, rejects duplicate YAML keys, and resolves asset paths.
- `scripts/presentations/render_equations.py` renders LaTeX formula registry
  entries to deterministic SVG plus PNG assets using `latex`, `dvisvgm`, and
  `rsvg-convert`.
- `scripts/presentations/build-deck.mjs` generates one artifact-tool slide
  module per spec slide and exports an editable PPTX through
  `@oai/artifact-tool/presentation-jsx`.

## Build

```bash
python3 -m pip install -r requirements-presentations.txt
pnpm slides:validate -- --spec /absolute/path/to/report_spec.yaml --workspace /absolute/path/to/workspace
pnpm slides:build -- --spec /absolute/path/to/report_spec.yaml --workspace /absolute/path/to/workspace
```

The final PPTX, rendered PNG previews, layout JSON, equation cache, and contact
sheet are written under the workspace passed to `--workspace`.

## Keynote-Safe Rules

- Use a fixed 16:9 slide size.
- Use standard fonts only.
- Embed images; do not link media.
- Keep every mathematical token, including a standalone symbol, as a rendered
  transparent PNG in PPTX, with SVG cached next to it for vector reuse. Do not
  approximate symbols with raw Unicode, Unicode subscript/superscript
  characters, or manually formatted text runs.
- Avoid PowerPoint-only transitions, animations, and effects.

## Formula Columns in Tables

Table headers remain ordinary text. Table rows accept the same rich-text parts
as body copy, so a cell can reference a formula registry entry. Name every
symbol or math column in `formula_columns`; validation then rejects raw strings
in that column and requires each cell to contain at least one `formula` part.

```yaml
equation_registry: formulas.yaml
slides:
  - id: target-parameters
    layout: table
    title: Target Design Parameters
    table:
      headers: [Design parameter, Symbol, Target value]
      formula_columns: [Symbol]
      rows:
        - - Readout resonator frequencies
          - parts:
              - formula: symbol.omega.readout
          - Centered at 6.0 GHz
```

Keep surrounding prose and plain value/unit cells such as `6.0 GHz`, `90 MHz`,
and `dB` as theme text. Put the LaTeX source for each referenced symbol in the
equation registry so the SVG and PNG assets remain reproducible.
