import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "src", "data", "resume.json");
const buildDir = path.join(root, "build", "typst");
const outDir = path.join(root, "dist", "files");

const resume = JSON.parse(await readFile(dataPath, "utf8"));
const outputs = [
  { lang: "en", file: "Yi-Li-Chiu-CV-typst-en.pdf" },
  { lang: "zh", file: "Yi-Li-Chiu-CV-typst-zh.pdf" },
];

function escapeTypst(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("#", "\\#")
    .replaceAll("$", "\\$")
    .replaceAll("@", "\\@")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function section(title) {
  return [
    "#v(0.72em)",
    `#text(size: 10.6pt, weight: "bold", fill: accent)[${escapeTypst(title)}]`,
    "#v(0.12em)",
    "#line(length: 100%, stroke: 0.5pt + accent)",
    "#v(0.35em)",
  ].join("\n");
}

function bullet(label, text) {
  return `- *${escapeTypst(label)}:* ${escapeTypst(text)}`;
}

function list(items) {
  return items.map((item) => `- ${escapeTypst(item)}`).join("\n");
}

function detectFont() {
  const candidates = [
    "Noto Sans CJK TC",
    "Noto Sans CJK SC",
    "Arial Unicode MS",
    "Heiti TC",
    "Hiragino Sans",
    "Helvetica Neue",
    "Arial",
  ];
  const result = spawnSync("typst", ["fonts"], { encoding: "utf8" });
  const available = new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
  return candidates.find((font) => available.has(font)) ?? "Arial";
}

function render(lang, fontName) {
  const content = resume.languages[lang];
  const contact = resume.contact;
  const summary = content.summary.map(escapeTypst).join("\n\n");
  const projects = content.projects
    .map((project) =>
      [
        `#text(size: 9.8pt, weight: "bold")[${escapeTypst(project.title)}]`,
        `#text(size: 8.8pt, fill: muted)[${escapeTypst(project.meta)}]`,
        `#text(size: 8pt, fill: accent)[${escapeTypst(project.tags.join(" / "))}]`,
        project.bullets.map((item) => bullet(item.label, item.text)).join("\n"),
      ].join("\n"),
    )
    .join("\n\n");
  const education = content.education
    .map((item) =>
      [
        `#text(size: 9.8pt, weight: "bold")[${escapeTypst(item.school)}]`,
        `${escapeTypst(item.degree)} · ${escapeTypst(item.period)}`,
        list(item.details),
      ].join("\n"),
    )
    .join("\n\n");

  return `#set page(paper: "a4", margin: (x: 1.35cm, y: 1.22cm))
#set text(font: "${escapeTypst(fontName)}", size: 9.2pt)
#set par(leading: 0.56em, justify: false)

#let accent = rgb("#0f58c9")
#let muted = rgb("#5a667b")

#align(center)[
  #text(size: 20pt, weight: "bold")[${escapeTypst(contact.name[lang])}]
  #v(0.2em)
  #text(size: 8.8pt, fill: muted)[${escapeTypst(contact.email)} | #link("${contact.github.url}")[${escapeTypst(contact.github.label)}] | ${escapeTypst(contact.location[lang])}]
]

${section(content.sections.summary)}
${summary}

${section(content.sections.projects)}
${projects}

${section(content.sections.education)}
${education}
`;
}

async function ensureDist() {
  try {
    await stat(path.join(root, "dist"));
  } catch {
    await mkdir(path.join(root, "dist"), { recursive: true });
  }
  await mkdir(outDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
}

await ensureDist();

const version = spawnSync("typst", ["--version"], { encoding: "utf8" });
if (version.status !== 0) {
  throw new Error("Typst CLI is not installed. Install it with `brew install typst` and rerun `pnpm pdf:typst`.");
}

for (const output of outputs) {
  const fontName = detectFont();
  const sourcePath = path.join(buildDir, `resume-${output.lang}.typ`);
  const pdfPath = path.join(outDir, output.file);
  await writeFile(sourcePath, render(output.lang, fontName), "utf8");

  const result = spawnSync("typst", ["compile", sourcePath, pdfPath], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Typst failed for ${output.lang}:\n${result.stderr || result.stdout}`);
  }

  console.log(`Generated dist/files/${output.file}`);
}
