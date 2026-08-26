import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url);
const assetsDir = new URL("assets/", distDir);
const serviceWorkerPath = new URL("sw.js", distDir);
const placeholder = "/* __VITE_ASSETS__ */";

const files = await readdir(assetsDir);
const assets = files
  .filter((file) => file.endsWith(".css") || file.endsWith(".js"))
  .sort()
  .map((file) => `  "./${join("assets", file).replaceAll("\\", "/")}",`);

const serviceWorker = await readFile(serviceWorkerPath, "utf8");

if (!serviceWorker.includes(placeholder)) {
  throw new Error("Service worker asset placeholder was not found.");
}

await writeFile(serviceWorkerPath, serviceWorker.replace(placeholder, assets.join("\n")), "utf8");
