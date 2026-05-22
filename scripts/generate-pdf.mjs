import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const outDir = path.join(distDir, "files");
const host = "127.0.0.1";
const port = process.env.PREVIEW_PORT ?? "4321";
const basePath = (process.env.BASE_PATH ?? "/I-LI_CHIU_CV").replace(/\/$/, "");

const outputs = [
  { lang: "en", file: "Yi-Li-Chiu-CV-en.pdf" },
  { lang: "zh", file: "Yi-Li-Chiu-CV-zh.pdf" },
];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url, serverLog) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Timed out waiting for Astro preview at ${url}\n${serverLog()}`);
}

if (!(await exists(path.join(distDir, "index.html")))) {
  throw new Error("Missing dist/index.html. Run `pnpm build` before `pnpm pdf`.");
}

await mkdir(outDir, { recursive: true });

let log = "";
const server = spawn("pnpm", ["exec", "astro", "preview", "--host", host, "--port", port], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => {
  log += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  log += chunk.toString();
});

const serverLog = () => log.split("\n").slice(-20).join("\n");

try {
  await waitFor(`http://${host}:${port}${basePath}/print/en/`, serverLog);
  const browser = await chromium.launch();

  try {
    for (const output of outputs) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
      await page.emulateMedia({ media: "print" });
      await page.goto(`http://${host}:${port}${basePath}/print/${output.lang}/`, {
        waitUntil: "networkidle",
      });
      await page.pdf({
        path: path.join(outDir, output.file),
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
      await page.close();
      console.log(`Generated dist/files/${output.file}`);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}
