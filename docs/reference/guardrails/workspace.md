# Workspace Guardrails

## Project Goal

Build and maintain a bilingual academic CV website for Yi-Li Chiu that can be deployed to GitHub Pages and can generate high-quality downloadable PDFs.

## Stack Summary

- Astro static site generation.
- Tailwind CSS v4 via the Vite plugin.
- pnpm for package management.
- Playwright for the primary Astro print-to-PDF pipeline.
- Typst for the secondary print-quality PDF experiment.
- GitHub Actions for checks, PDF generation, and GitHub Pages deployment.

## Run / Build Commands

- `pnpm install`
- `pnpm dev`
- `pnpm check`
- `pnpm build`
- `pnpm pdf`
- `pnpm pdf:typst`
- `pnpm preview`

## Lint / Format Commands

- `pnpm check` is the required static validation command.
- No auto-format command is defined yet. Preserve the existing style when editing.

## Testing Commands

- `pnpm check`
- `pnpm build`
- `pnpm pdf`
- `pnpm pdf:typst`

## Docs Rules

- Keep these workspace rules in `docs/reference/guardrails/workspace.md`.
- When updating rules, copy the `## Agent Rules` block verbatim into `.agent/rules/workspace.md`.
- Keep public deployment assumptions, commands, and CI gates documented here.

## Folder Structure

- `src/data/resume.json`: bilingual content source of truth.
- `src/pages/`: Astro public routes.
- `src/components/`: reusable presentation components.
- `src/styles/`: shared CSS and Tailwind import.
- `scripts/`: PDF generation automation.
- `typst/`: Typst-related notes/templates.
- `public/`: static assets committed with the site.
- `dist/`: generated deploy output, not committed.

## CI Gates

- Install pnpm dependencies with a frozen lockfile.
- Install Playwright Chromium for the PDF route.
- Install Typst and CJK fonts for bilingual PDF generation.
- Run `pnpm check`, `pnpm build`, `pnpm pdf`, and `pnpm pdf:typst`.
- Upload `dist/` to GitHub Pages only after all gates pass.

## Agent Rules

- Treat `src/data/resume.json` as the source of truth for resume content; do not hard-code resume facts in components or scripts unless they are structural labels.
- Keep English as the primary language and Traditional Chinese as the secondary language.
- Preserve GitHub Pages compatibility by keeping `site: "https://arfiligol.github.io"` and `base: "/I-LI_CHIU_CV"` unless the repository name changes.
- Generate primary PDFs from Astro print routes with Playwright; keep Typst as the secondary PDF path.
- Keep generated PDFs in `dist/files/` during build/deploy and do not commit PDF binaries unless explicitly requested.
- Use `pnpm check`, `pnpm build`, `pnpm pdf`, and `pnpm pdf:typst` as the minimum verification gates before deployment.
- Use the public GitHub profile `https://github.com/arfiligol`; keep the email placeholder until a real public email is provided.
- Avoid unrelated refactors and keep design, data, PDF, and deployment changes scoped to the CV site.
