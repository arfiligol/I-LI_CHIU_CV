# Typst PDF Path

The Typst PDFs are generated from `src/data/resume.json` by `scripts/generate-typst.mjs`.

Run:

```sh
pnpm pdf:typst
```

Outputs:

- `dist/files/Yi-Li-Chiu-CV-typst-en.pdf`
- `dist/files/Yi-Li-Chiu-CV-typst-zh.pdf`

Generated `.typ` files are written to `build/typst/` and are not committed.
