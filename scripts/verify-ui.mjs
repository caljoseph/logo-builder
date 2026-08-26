import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const baseUrl = "http://127.0.0.1:5174/";
const DRAG_DEGREES_PER_PIXEL = 0.45;
const outputDir = new URL("../verification-output/", import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(message) {
  console.log(`[verify-ui] ${message}`);
}

async function withTimeout(label, timeoutMs, action) {
  let timeout;

  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function viteCommand() {
  const args = ["exec", "vite", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"];

  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", npmCommand(), ...args] };
  }

  return { command: npmCommand(), args };
}

function outputPath(name) {
  return fileURLToPath(new URL(name, outputDir));
}

function identityRotation() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

function screenAxisRotation({ xDegrees = 0, yDegrees = 0, zDegrees = 0 }) {
  const angleDegrees = Math.hypot(xDegrees, yDegrees, zDegrees);

  if (angleDegrees === 0) {
    return identityRotation();
  }

  const x = xDegrees / angleDegrees;
  const y = yDegrees / angleDegrees;
  const z = zDegrees / angleDegrees;
  const angle = (angleDegrees * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const oneMinusCosine = 1 - cosine;

  return [
    [
      cosine + x * x * oneMinusCosine,
      x * y * oneMinusCosine - z * sine,
      x * z * oneMinusCosine + y * sine,
    ],
    [
      y * x * oneMinusCosine + z * sine,
      cosine + y * y * oneMinusCosine,
      y * z * oneMinusCosine - x * sine,
    ],
    [
      z * x * oneMinusCosine - y * sine,
      z * y * oneMinusCosine + x * sine,
      cosine + z * z * oneMinusCosine,
    ],
  ];
}

function legacyEulerToMatrix(rollDeg = 0, pitchDeg = 0, yawDeg = 0) {
  const roll = (rollDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const yaw = (yawDeg * Math.PI) / 180;
  const rz = [
    [Math.cos(yaw), -Math.sin(yaw), 0],
    [Math.sin(yaw), Math.cos(yaw), 0],
    [0, 0, 1],
  ];
  const ry = [
    [Math.cos(pitch), 0, Math.sin(pitch)],
    [0, 1, 0],
    [-Math.sin(pitch), 0, Math.cos(pitch)],
  ];
  const rx = [
    [1, 0, 0],
    [0, Math.cos(roll), -Math.sin(roll)],
    [0, Math.sin(roll), Math.cos(roll)],
  ];

  return multiplyMatrices(multiplyMatrices(rz, ry), rx);
}

function multiplyMatrices(a, b) {
  return a.map((row) =>
    b[0].map((_, column) => row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column]),
  );
}

function maxMatrixDifference(a, b) {
  return Math.max(...a.flatMap((row, rowIndex) => row.map((value, column) => Math.abs(value - b[rowIndex][column]))));
}

function assertMatrixClose(actual, expected, message) {
  assert(maxMatrixDifference(actual, expected) < 0.000_001, message);
}

async function waitForServer(processHandle) {
  let output = "";

  processHandle.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  processHandle.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (output.includes("Local:") || output.includes("ready")) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Vite did not start.\n${output}`);
}

async function stopServer(processHandle) {
  if (!processHandle.pid || processHandle.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {
    processHandle.kill("SIGTERM");
  }

  await Promise.race([
    once(processHandle, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);

  if (processHandle.exitCode === null) {
    try {
      process.kill(-processHandle.pid, "SIGKILL");
    } catch {
      processHandle.kill("SIGKILL");
    }
  }
}

async function launchBrowser() {
  for (const executablePath of chromePaths) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch {
      // Try the next locally installed browser path.
    }
  }

  return chromium.launch({ headless: true });
}

async function visibleText(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const visible = [];
    let current = walker.nextNode();

    while (current) {
      const text = current.textContent?.trim();
      const parent = current.parentElement;

      if (text && parent) {
        const style = window.getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();

        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          visible.push(text);
        }
      }

      current = walker.nextNode();
    }

    return visible;
  });
}

async function canvasStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-logo-canvas]");

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Logo canvas was not found.");
    }

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Logo canvas has no 2D context.");
    }

    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let darkPixels = 0;
    let nonWhitePixels = 0;
    let checksum = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];

      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        nonWhitePixels += 1;
      }

      if (alpha > 0 && red < 64 && green < 64 && blue < 64) {
        darkPixels += 1;
      }

      checksum = (checksum + red * 3 + green * 5 + blue * 7 + alpha * 11 + (index % 997)) % 1_000_000_007;
    }

    return { width, height, darkPixels, nonWhitePixels, checksum };
  });
}

async function dragLogo(page, options = {}) {
  const box = await page.locator("[data-logo-canvas]").boundingBox();
  assert(box, "Logo canvas has a bounding box.");
  const startX = box.x + box.width / 2 + (options.startOffsetX ?? 0);
  const startY = box.y + box.height / 2 + (options.startOffsetY ?? 0);

  if (options.shift) {
    await page.keyboard.down("Shift");
  }

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + (options.dx ?? 120), startY + (options.dy ?? 78), { steps: 10 });
  await page.mouse.up();

  if (options.shift) {
    await page.keyboard.up("Shift");
  }
}

async function coverRotations(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("logoBuilder.state.v1");
    if (!raw) {
      throw new Error("Logo state was not persisted.");
    }

    return JSON.parse(raw).covers.map((cover) => cover.rotation);
  });
}

async function setCoverRotations(page, rotation) {
  await page.evaluate((nextRotation) => {
    const raw = localStorage.getItem("logoBuilder.state.v1");
    if (!raw) {
      throw new Error("Logo state was not persisted.");
    }

    const state = JSON.parse(raw);
    state.covers = state.covers.map((cover) => ({ ...cover, rotation: nextRotation }));
    localStorage.setItem("logoBuilder.state.v1", JSON.stringify(state));
  }, rotation);
}

async function verifyLegacyMigration(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    localStorage.setItem(
      "logoBuilder.state.v1",
      JSON.stringify({
        base: { color: "#ffffff", alpha: 1 },
        covers: [{ id: "legacy-cover", color: "#000000", alpha: 1, roll: 12, pitch: 23, yaw: 34, selected: true }],
      }),
    );
  });
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");

  const [rotation] = await coverRotations(page);
  assertMatrixClose(rotation, legacyEulerToMatrix(12, 23, 34), "Legacy roll/pitch/yaw state migrates to a rotation matrix.");
}

async function longPress(locator, page) {
  const box = await locator.boundingBox();
  assert(box, "Long-press target has a bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(620);
  await page.mouse.up();
}

async function runMainFlowChecks(page, screenshotPrefix) {
  logStep(`${screenshotPrefix}: load app`);
  page.setDefaultTimeout(15_000);
  await verifyLegacyMigration(page);
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await page.screenshot({ path: outputPath(`${screenshotPrefix}-main.png`), fullPage: true });

  assert((await visibleText(page)).length === 0, "Main screen has no visible text.");

  const initial = await canvasStats(page);
  assert(initial.width > 0 && initial.height > 0, "Canvas has a rendered pixel buffer.");
  assert(initial.darkPixels > 1000, "Initial logo render contains visible cover pixels.");

  logStep(`${screenshotPrefix}: add and rotate covers`);
  await page.getByRole("button", { name: "Add cover" }).click();
  assert((await page.locator(".layer-swatch.selected").count()) === 2, "Added cover starts selected without clearing existing selection.");

  const beforeDrag = await canvasStats(page);
  await dragLogo(page);
  const afterDrag = await canvasStats(page);
  assert(beforeDrag.checksum !== afterDrag.checksum, "Dragging selected layers changes rendered pixels.");

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await page.getByRole("button", { name: "Add cover" }).click();

  await dragLogo(page, { dx: 100, dy: 0 });
  let rotations = await coverRotations(page);
  let expectedRotation = screenAxisRotation({ yDegrees: 100 * DRAG_DEGREES_PER_PIXEL });
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Dragging right applies only screen y-axis rotation."));

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await page.getByRole("button", { name: "Add cover" }).click();

  await dragLogo(page, { dx: 0, dy: 100 });
  rotations = await coverRotations(page);
  expectedRotation = screenAxisRotation({ xDegrees: 100 * DRAG_DEGREES_PER_PIXEL });
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Dragging down applies only screen x-axis rotation."));

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await page.getByRole("button", { name: "Add cover" }).click();

  await dragLogo(page, { startOffsetY: -100, dx: 100, dy: 100, shift: true });
  rotations = await coverRotations(page);
  expectedRotation = screenAxisRotation({ zDegrees: -90 });
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Clockwise Shift-drag applies only screen z-axis rotation."));

  const preRotated = screenAxisRotation({ xDegrees: 28, yDegrees: -17, zDegrees: 42 });
  await setCoverRotations(page, preRotated);
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await dragLogo(page, { dx: 80, dy: 0 });
  rotations = await coverRotations(page);
  expectedRotation = multiplyMatrices(screenAxisRotation({ yDegrees: 80 * DRAG_DEGREES_PER_PIXEL }), preRotated);
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Horizontal drag pre-multiplies screen y-axis rotation."));

  await setCoverRotations(page, preRotated);
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await dragLogo(page, { dx: 0, dy: 80 });
  rotations = await coverRotations(page);
  expectedRotation = multiplyMatrices(screenAxisRotation({ xDegrees: 80 * DRAG_DEGREES_PER_PIXEL }), preRotated);
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Vertical drag pre-multiplies screen x-axis rotation."));

  await setCoverRotations(page, preRotated);
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
  await dragLogo(page, { startOffsetY: -100, dx: 100, dy: 100, shift: true });
  rotations = await coverRotations(page);
  expectedRotation = multiplyMatrices(screenAxisRotation({ zDegrees: -90 }), preRotated);
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Clockwise Shift-drag pre-multiplies screen z-axis rotation."));

  await page.getByRole("button", { name: "Base sphere" }).click();
  assert((await page.locator(".layer-swatch.selected").count()) === 0, "Base sphere clears selection when every cover is selected.");

  const beforeInactiveDrag = await canvasStats(page);
  await dragLogo(page);
  const afterInactiveDrag = await canvasStats(page);
  assert(
    beforeInactiveDrag.checksum === afterInactiveDrag.checksum,
    "Dragging with no selected covers leaves rendered pixels unchanged.",
  );

  await page.getByRole("button", { name: "Base sphere" }).click();
  assert((await page.locator(".layer-swatch.selected").count()) === 2, "Base sphere selects all covers when any cover is unselected.");

  logStep(`${screenshotPrefix}: open color modal`);
  await longPress(page.getByRole("button", { name: "Cover 2" }), page);
  await page.waitForSelector(".color-modal");
  assert((await visibleText(page)).length === 0, "Color modal has no visible text.");
  await page.getByRole("slider", { name: "Alpha" }).fill("0.42");
  const previewAlpha = await page.locator(".color-input-shell").evaluate((element) =>
    Number(window.getComputedStyle(element).getPropertyValue("--edit-alpha")),
  );
  assert(Math.abs(previewAlpha - 0.42) < 0.001, "Color modal preview reflects alpha changes.");
  await page.screenshot({ path: outputPath(`${screenshotPrefix}-color-modal.png`), fullPage: true });
  await page.getByRole("button", { name: "Close" }).click();

  logStep(`${screenshotPrefix}: export logo`);
  await page.getByRole("button", { name: "Save logo" }).click();
  await page.waitForSelector(".save-modal");
  const filenameInput = page.getByRole("textbox", { name: "Filename" });
  assert((await filenameInput.inputValue()) === "logo.png", "Save modal opens with logo.png.");
  const selection = await filenameInput.evaluate((input) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
  }));
  assert(selection.start === 0 && selection.end === 4, "Save modal selects only the logo filename stem.");
  await page.screenshot({ path: outputPath(`${screenshotPrefix}-save-modal.png`), fullPage: true });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirm" }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  assert(downloadedPath, "Logo export download produced a file.");
  assert(download.suggestedFilename() === "logo.png", "Logo export suggests logo.png.");

  const png = PNG.sync.read(await readFile(downloadedPath));
  assert(png.width === 1024 && png.height === 1024, "Logo export is 1024x1024.");
  assert(alphaAt(png, 0, 0) === 0, "Logo export corner is transparent.");
  assert(alphaAt(png, 512, 512) > 0, "Logo export has an opaque center logo.");
}

function alphaAt(png, x, y) {
  return png.data[(png.width * y + x) * 4 + 3];
}

async function main() {
  const forcedExit = setTimeout(() => {
    console.error("[verify-ui] Verification did not finish within 150000ms.");
    process.exit(1);
  }, 150_000);

  await mkdir(outputDir, { recursive: true });

  const vite = viteCommand();
  logStep("start Vite");
  const server = spawn(vite.command, vite.args, {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await withTimeout("Vite startup", 20_000, () =>
      Promise.race([
        waitForServer(server),
        once(server, "exit").then(([code]) => {
          throw new Error(`Vite exited before verification started with code ${code}.`);
        }),
      ]),
    );

    logStep("launch browser");
    const browser = await launchBrowser();
    const mobile = await browser.newPage({ acceptDownloads: true, deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
    await withTimeout("Mobile UI verification", 60_000, () => runMainFlowChecks(mobile, "mobile"));

    const desktop = await browser.newPage({ acceptDownloads: true, deviceScaleFactor: 1, viewport: { width: 900, height: 900 } });
    await withTimeout("Desktop UI verification", 60_000, () => runMainFlowChecks(desktop, "desktop"));
    await browser.close();
  } finally {
    await stopServer(server);
    clearTimeout(forcedExit);
  }

  logStep("complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
