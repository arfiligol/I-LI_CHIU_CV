#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected positional argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = true;
      continue;
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function requireArg(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
    encoding: "utf8",
    maxBuffer: 120 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function findPresentationsSkillDir() {
  if (process.env.PRESENTATIONS_SKILL_DIR) {
    return path.resolve(process.env.PRESENTATIONS_SKILL_DIR);
  }
  const root = path.join(os.homedir(), ".codex", "plugins", "cache", "openai-primary-runtime", "presentations");
  const versions = fsSync.existsSync(root)
    ? fsSync.readdirSync(root).filter((entry) => fsSync.statSync(path.join(root, entry)).isDirectory())
    : [];
  const candidates = versions
    .sort()
    .reverse()
    .map((version) => path.join(root, version, "skills", "presentations"))
    .filter((candidate) => fsSync.existsSync(path.join(candidate, "scripts", "build_artifact_deck.mjs")));
  if (candidates.length === 0) {
    throw new Error("Could not locate the bundled Presentations skill. Set PRESENTATIONS_SKILL_DIR.");
  }
  return candidates[0];
}

function contactSheetPython() {
  if (process.env.PRESENTATION_CONTACT_SHEET_PYTHON) {
    return process.env.PRESENTATION_CONTACT_SHEET_PYTHON;
  }
  const bundled = path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  return fsSync.existsSync(bundled) ? bundled : process.env.PYTHON || "python3";
}

async function generateSlideModules({ slidesDir, buildContextPath, slideCount }) {
  await fs.rm(slidesDir, { recursive: true, force: true });
  await fs.mkdir(slidesDir, { recursive: true });
  const builderPath = path.resolve("scripts/presentations/lib/slide-builder.mjs");
  const builderUrl = pathToFileURL(builderPath).href;
  const escapedContextPath = JSON.stringify(path.resolve(buildContextPath));
  for (let index = 0; index < slideCount; index += 1) {
    const number = String(index + 1).padStart(2, "0");
    const modulePath = path.join(slidesDir, `slide-${number}.mjs`);
    const source = [
      `import { buildSlideFromSpec } from ${JSON.stringify(builderUrl)};`,
      "",
      `export async function slide${number}(presentation, ctx) {`,
      `  return buildSlideFromSpec(presentation, ctx, ${escapedContextPath}, ${index});`,
      "}",
      "",
    ].join("\n");
    await fs.writeFile(modulePath, source, "utf8");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = path.resolve(requireArg(args, "spec"));
  const workspace = path.resolve(requireArg(args, "workspace"));
  const out = args.out
    ? path.resolve(args.out)
    : path.join(workspace, "output", "presentation.pptx");

  const qaDir = path.join(workspace, "qa");
  const assetDir = path.join(workspace, "assets");
  const slidesDir = path.join(workspace, "slides");
  const previewDir = path.join(workspace, "preview", "slides");
  const layoutDir = path.join(workspace, "layout", "slides");
  const normalizedSpecPath = path.join(qaDir, "report_spec.normalized.json");
  const equationAssetsPath = path.join(qaDir, "equation-assets.json");
  const buildContextPath = path.join(qaDir, "build-context.json");

  await fs.mkdir(qaDir, { recursive: true });
  await fs.mkdir(path.dirname(out), { recursive: true });

  const python = process.env.PRESENTATION_SPEC_PYTHON || process.env.PYTHON || "python3";
  run(python, [
    "scripts/presentations/validate_report_spec.py",
    "--spec",
    specPath,
    "--workspace",
    workspace,
    "--out-json",
    normalizedSpecPath,
  ]);
  run(python, [
    "scripts/presentations/render_equations.py",
    "--spec-json",
    normalizedSpecPath,
    "--out-dir",
    path.join(assetDir, "equations"),
    "--out-json",
    equationAssetsPath,
  ]);

  const spec = JSON.parse(await fs.readFile(normalizedSpecPath, "utf8"));
  const equationAssets = JSON.parse(await fs.readFile(equationAssetsPath, "utf8"));
  const buildContext = {
    ...spec,
    equation_assets: equationAssets.assets || {},
  };
  await fs.writeFile(buildContextPath, `${JSON.stringify(buildContext, null, 2)}\n`, "utf8");
  await fs.rm(previewDir, { recursive: true, force: true });
  await fs.rm(layoutDir, { recursive: true, force: true });
  await fs.rm(path.join(workspace, "preview", "contact-sheet.png"), { force: true });
  await generateSlideModules({
    slidesDir,
    buildContextPath,
    slideCount: buildContext.slides.length,
  });

  const skillDir = findPresentationsSkillDir();
  const buildScript = path.join(skillDir, "scripts", "build_artifact_deck.mjs");
  run(process.execPath, [
    buildScript,
    "--workspace",
    workspace,
    "--slides-dir",
    slidesDir,
    "--out",
    out,
    "--preview-dir",
    previewDir,
    "--layout-dir",
    layoutDir,
    "--contact-sheet",
    path.join(workspace, "preview", "contact-sheet.png"),
    "--manifest",
    path.join(qaDir, "artifact-build-manifest.json"),
    "--slide-size",
    "1280x720",
    "--scale",
    args.scale || "1",
    "--slide-count",
    String(buildContext.slides.length),
  ], {
    env: {
      ...process.env,
      PYTHON: contactSheetPython(),
    },
  });

  console.log(JSON.stringify({
    output: out,
    workspace,
    slides: buildContext.slides.length,
    normalizedSpecPath,
    equationAssetsPath,
    buildContextPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
