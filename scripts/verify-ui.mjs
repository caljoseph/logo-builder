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

async function capture(page, prefix, name) {
  await page.screenshot({ path: outputPath(`${prefix}-${name}`), fullPage: true });

  if (prefix === "mobile") {
    await page.screenshot({ path: outputPath(name), fullPage: true });
  }
}

function identityRotation() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

function screenAxisRotation({ xDegrees = 0, yDegrees = 0, zDegrees = 0 }) {
  return modelAxisRotation({
    xDegrees,
    yDegrees,
    zDegrees: -zDegrees,
  });
}

function modelAxisRotation({ xDegrees = 0, yDegrees = 0, zDegrees = 0 }) {
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

function eulerToMatrix(rollDeg = 0, pitchDeg = 0, yawDeg = 0) {
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

function transpose(matrix) {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function maxMatrixDifference(a, b) {
  return Math.max(...a.flatMap((row, rowIndex) => row.map((value, column) => Math.abs(value - b[rowIndex][column]))));
}

function assertMatrixClose(actual, expected, message) {
  assert(maxMatrixDifference(actual, expected) < 0.000_001, message);
}

function baseLayer(overrides = {}) {
  return {
    colorMode: "normal",
    color: "#ffffff",
    alpha: 1,
    ...overrides,
  };
}

function backgroundLayer(overrides = {}) {
  return {
    colorMode: "normal",
    color: "#ffffff",
    alpha: 1,
    ...overrides,
  };
}

function coverLayer(overrides = {}) {
  return {
    colorMode: "normal",
    color: "#000000",
    alpha: 1,
    ...overrides,
  };
}

function latticeLayer(overrides = {}) {
  return {
    colorMode: "normal",
    color: "#000000",
    alpha: 1,
    frequency: 4,
    lineWidth: 3,
    cutFill: true,
    outline: true,
    outlineWidth: 3,
    backEdges: "off",
    dashLength: 0,
    ...overrides,
  };
}

function logoState(overrides = {}) {
  return {
    background: backgroundLayer(),
    base: baseLayer(),
    cover: coverLayer(),
    rotation: identityRotation(),
    ...overrides,
  };
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

  await Promise.race([once(processHandle, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);

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

async function visibleTextWithin(page, selector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);

    if (!root) {
      throw new Error(`Could not find ${rootSelector}.`);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
  }, selector);
}

async function elementCanvasStats(page, selector) {
  return page.evaluate((canvasSelector) => {
    const canvas = document.querySelector(canvasSelector);

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas ${canvasSelector} was not found.`);
    }

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(`Canvas ${canvasSelector} has no 2D context.`);
    }

    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let nonTransparentPixels = 0;
    let checksum = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];

      if (alpha > 0) {
        nonTransparentPixels += 1;
      }

      checksum = (checksum + red * 3 + green * 5 + blue * 7 + alpha * 11 + (index % 997)) % 1_000_000_007;
    }

    return { width, height, nonTransparentPixels, checksum };
  }, selector);
}

async function assertCheckerboardSurface(page) {
  const styles = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const logoZone = document.querySelector(".logo-zone");
    const swatch = document.querySelector(".layer-swatch");

    return [shell, logoZone, swatch].map((element) =>
      element ? window.getComputedStyle(element).backgroundImage : "missing",
    );
  });

  assert(styles.every((backgroundImage) => backgroundImage.includes("conic-gradient")), "Editor surfaces use the checkerboard transparency preview.");
}

async function assertOpaquePanels(page) {
  const panelStyles = await page.evaluate(() => {
    const topPanel = document.querySelector(".top-panel");
    const bottomPanel = document.querySelector(".bottom-panel");

    return [topPanel, bottomPanel].map((element) => {
      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        left: rect.left,
        width: rect.width,
        viewportWidth: window.innerWidth,
        backgroundColor: style.backgroundColor,
      };
    });
  });

  for (const panel of panelStyles) {
    assert(panel, "Top and bottom panels exist.");
    assert(Math.round(panel.left) === 0 && Math.round(panel.width) === panel.viewportWidth, "Panels are full width.");
    assert(panel.backgroundColor === "rgb(255, 255, 255)", "Panels use opaque white backgrounds.");
  }
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
    let transparentPixels = 0;
    let bluePixels = 0;
    let redPixels = 0;
    let checksum = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];

      if (alpha === 0) {
        transparentPixels += 1;
      }

      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        nonWhitePixels += 1;
      }

      if (alpha > 0 && red < 64 && green < 64 && blue < 64) {
        darkPixels += 1;
      }

      if (alpha > 0 && blue > 180 && red < 80 && green < 120) {
        bluePixels += 1;
      }

      if (alpha > 0 && red > 180 && green < 90 && blue < 90) {
        redPixels += 1;
      }

      checksum = (checksum + red * 3 + green * 5 + blue * 7 + alpha * 11 + (index % 997)) % 1_000_000_007;
    }

    return { width, height, darkPixels, nonWhitePixels, transparentPixels, bluePixels, redPixels, checksum };
  });
}

async function stableCanvasStats(page) {
  let previous = await canvasStats(page);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(80);
    const next = await canvasStats(page);

    if (next.checksum === previous.checksum && next.width === previous.width && next.height === previous.height) {
      return next;
    }

    previous = next;
  }

  return previous;
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

async function appState(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("logoBuilder.state.v1");
    if (!raw) {
      throw new Error("Logo state was not persisted.");
    }

    return JSON.parse(raw);
  });
}

async function setAppState(page, state) {
  await page.goto(baseUrl);
  await page.evaluate((nextState) => {
    localStorage.setItem("logoBuilder.state.v1", JSON.stringify(nextState));
  }, state);
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
}

async function resetApp(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");
}

async function layerLabels(page) {
  return page.locator(".layer-row button").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label")),
  );
}

async function logoRotation(page) {
  return (await appState(page)).rotation;
}

async function setRotation(page, rotation) {
  const state = await appState(page);
  state.rotation = rotation;
  await setAppState(page, state);
}

async function eulerFieldValue(page, label) {
  return page.getByRole("textbox", { name: label }).inputValue();
}

async function eulerSlider(page, label) {
  return page.getByRole("slider", { name: `${label} slider` });
}

async function assertEulerFieldValues(page, expected, message) {
  const actual = {
    Roll: await eulerFieldValue(page, "Roll"),
    Pitch: await eulerFieldValue(page, "Pitch"),
    Yaw: await eulerFieldValue(page, "Yaw"),
  };

  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} Expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}.`);
}

async function openLayerModal(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForSelector(".color-modal");
}

async function verifyLegacyMigration(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    localStorage.setItem(
      "logoBuilder.state.v1",
      JSON.stringify({
        base: { color: "#ffffff", alpha: 1, latticeResolution: 20 },
        covers: [{ id: "legacy-cover", color: "#123456", alpha: 1, roll: 12, pitch: 23, yaw: 34 }],
      }),
    );
  });
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");

  const state = await appState(page);
  assert(state.background.color === "#ffffff" && state.background.colorMode === "normal", "Legacy state gains a normal white background.");
  assert(state.base.lattice?.frequency === 1, "Legacy base lattice face count migrates to a frequency.");
  assert(state.cover.color === "#123456", "The first legacy cover becomes the single cover.");
  assert(state.covers === undefined && state.stack === undefined, "Legacy cover array and stack are dropped.");
  assertMatrixClose(state.rotation, eulerToMatrix(12, 23, 34), "Legacy per-cover roll/pitch/yaw becomes the shared rotation.");
}

async function verifyLayerRow(page) {
  await resetApp(page);
  assert(
    JSON.stringify(await layerLabels(page)) === JSON.stringify(["Background", "Base sphere", "Cover"]),
    "Initial row is background, base, and the single cover.",
  );
  assert((await page.locator(".layer-swatch.selected").count()) === 0, "Layer swatches carry no selection state.");

  // Every swatch opens its own editor on a single tap.
  for (const [name, label] of [["Background", "Layer color"], ["Base sphere", "Layer color"], ["Cover", "Layer color"]]) {
    await openLayerModal(page, name);
    assert((await page.getByRole("dialog").getAttribute("aria-label")) === label, `${name} swatch opens its editor.`);
    await page.getByRole("button", { name: "Close" }).click();
  }

  // Dragging always rotates the whole logo; there is nothing to select first.
  const before = await logoRotation(page);
  await dragLogo(page, { dx: 70, dy: 0 });
  assert(maxMatrixDifference(await logoRotation(page), before) > 0.001, "Dragging rotates the logo without any prior selection.");
}

async function verifyEulerEditor(page) {
  await resetApp(page);
  await assertEulerFieldValues(page, { Roll: "0.0", Pitch: "0.0", Yaw: "0.0" }, "Initial Euler readouts show the logo rotation.");

  const rollSlider = await eulerSlider(page, "Roll");
  const pitchSlider = await eulerSlider(page, "Pitch");
  const yawSlider = await eulerSlider(page, "Yaw");

  for (const [label, slider] of [["Roll", rollSlider], ["Pitch", pitchSlider], ["Yaw", yawSlider]]) {
    const bounds = await slider.evaluate((input) => ({ min: input.min, max: input.max, step: input.step }));
    assert(bounds.min === "0" && bounds.max === "360", `${label} slider spans 0 to 360.`);
    assert(bounds.step === "0.1", `${label} slider steps by 0.1.`);
  }

  // A slider applies immediately, unlike the text field which waits for a commit.
  await rollSlider.fill("45");
  await assertEulerFieldValues(page, { Roll: "45.0", Pitch: "0.0", Yaw: "0.0" }, "Roll slider updates the readouts live.");
  assertMatrixClose(await logoRotation(page), eulerToMatrix(45, 0, 0), "Roll slider applies the absolute Euler rotation.");

  await pitchSlider.fill("30");
  await assertEulerFieldValues(page, { Roll: "45.0", Pitch: "30.0", Yaw: "0.0" }, "Moving one slider leaves the other axes alone.");
  assertMatrixClose(await logoRotation(page), eulerToMatrix(45, 30, 0), "Pitch slider applies the absolute Euler rotation.");

  await yawSlider.fill("120");
  assertMatrixClose(await logoRotation(page), eulerToMatrix(45, 30, 120), "Yaw slider applies the absolute Euler rotation.");

  const rollInput = page.getByRole("textbox", { name: "Roll" });
  const pitchInput = page.getByRole("textbox", { name: "Pitch" });
  const yawInput = page.getByRole("textbox", { name: "Yaw" });

  await resetApp(page);
  const beforeDraft = await stableCanvasStats(page);
  await rollInput.fill("45");
  const afterDraft = await stableCanvasStats(page);
  assert(beforeDraft.checksum === afterDraft.checksum, "Typing in an Euler field does not mutate the logo before commit.");
  await rollInput.press("Enter");
  await assertEulerFieldValues(page, { Roll: "45.0", Pitch: "0.0", Yaw: "0.0" }, "Enter commits an Euler field edit.");
  assertMatrixClose(await logoRotation(page), eulerToMatrix(45, 0, 0), "Enter commit applies the absolute Euler rotation.");
  assert((await (await eulerSlider(page, "Roll")).inputValue()) === "45", "The slider tracks a committed text edit.");

  await pitchInput.fill("30");
  await pitchInput.evaluate((input) => input.blur());
  await assertEulerFieldValues(page, { Roll: "45.0", Pitch: "30.0", Yaw: "0.0" }, "Blur commits an Euler field edit.");
  assertMatrixClose(await logoRotation(page), eulerToMatrix(45, 30, 0), "Blur commit applies the absolute Euler rotation.");

  await pitchInput.fill("-20");
  await pitchInput.press("Enter");
  assert((await eulerFieldValue(page, "Pitch")) === "0.0", "Euler input clamps values below 0.");

  await yawInput.fill("720");
  await yawInput.press("Enter");
  assert((await eulerFieldValue(page, "Yaw")) === "360.0", "Euler input clamps values above 360.");

  await rollInput.fill("");
  await rollInput.press("Enter");
  assert((await eulerFieldValue(page, "Roll")) === "45.0", "Empty Euler input reverts to the current live value.");

  await page.getByRole("button", { name: "Reset rotation" }).click();
  assertMatrixClose(await logoRotation(page), identityRotation(), "Reset returns the logo to the identity rotation.");
  await assertEulerFieldValues(page, { Roll: "0.0", Pitch: "0.0", Yaw: "0.0" }, "Reset zeroes the readouts.");
}

async function verifyRotationGestures(page) {
  await resetApp(page);
  await dragLogo(page, { dx: 100, dy: 0 });
  assertMatrixClose(
    await logoRotation(page),
    modelAxisRotation({ yDegrees: 100 * DRAG_DEGREES_PER_PIXEL }),
    "Dragging right applies only screen y-axis rotation.",
  );

  await resetApp(page);
  await dragLogo(page, { dx: 0, dy: 100 });
  assertMatrixClose(
    await logoRotation(page),
    modelAxisRotation({ xDegrees: 100 * DRAG_DEGREES_PER_PIXEL }),
    "Dragging down applies only screen x-axis rotation.",
  );

  await resetApp(page);
  await dragLogo(page, { startOffsetY: -100, dx: 100, dy: 100, shift: true });
  assertMatrixClose(await logoRotation(page), modelAxisRotation({ zDegrees: -90 }), "Clockwise Shift-drag applies only screen z-axis rotation.");

  const preRotated = screenAxisRotation({ xDegrees: 28, yDegrees: -17, zDegrees: 42 });
  await setRotation(page, preRotated);
  await dragLogo(page, { dx: 80, dy: 0 });
  assertMatrixClose(
    await logoRotation(page),
    multiplyMatrices(modelAxisRotation({ yDegrees: 80 * DRAG_DEGREES_PER_PIXEL }), preRotated),
    "Horizontal drag pre-multiplies screen y-axis rotation.",
  );

  // One rotation drives every layer, so the whole logo stays rigid.
  await setAppState(page, logoState({
    base: baseLayer({ lattice: latticeLayer() }),
    cover: coverLayer({ lattice: latticeLayer() }),
  }));
  const beforeRigid = await stableCanvasStats(page);
  await dragLogo(page, { dx: 60, dy: 40 });
  const afterRigid = await stableCanvasStats(page);
  assert(beforeRigid.checksum !== afterRigid.checksum, "Dragging rotates a logo carrying both lattices.");
  const rigidState = await appState(page);
  assert(
    rigidState.base.lattice.rotation === undefined && rigidState.cover.lattice.rotation === undefined && rigidState.cover.rotation === undefined,
    "Layers no longer carry their own rotation.",
  );
}

async function verifyLatticeLayers(page, screenshotPrefix) {
  await resetApp(page);
  await openLayerModal(page, "Background");
  await capture(page, screenshotPrefix, "background-modal.png");
  let modalText = await visibleTextWithin(page, ".color-modal");
  assert(JSON.stringify(modalText) === JSON.stringify(["Color", "Alpha"]), `Background modal labels are limited to Color and Alpha. Found ${JSON.stringify(modalText)}.`);
  await page.getByRole("button", { name: "Close" }).click();

  await openLayerModal(page, "Base sphere");
  await capture(page, screenshotPrefix, "base-modal.png");
  modalText = await visibleTextWithin(page, ".color-modal");
  assert(JSON.stringify(modalText) === JSON.stringify(["Color", "Alpha", "Lattice"]), `Base modal exposes source labels only. Found ${JSON.stringify(modalText)}.`);
  await page.getByRole("button", { name: "Close" }).click();

  await openLayerModal(page, "Cover");
  await capture(page, screenshotPrefix, "cover-modal.png");
  modalText = await visibleTextWithin(page, ".color-modal");
  assert(JSON.stringify(modalText) === JSON.stringify(["Color", "Alpha", "Lattice"]), `Cover modal exposes source labels only. Found ${JSON.stringify(modalText)}.`);
  assert((await page.getByRole("slider", { name: "Density" }).count()) === 0, "Source modal does not expose lattice density.");
  assert((await page.getByRole("slider", { name: "Line width" }).count()) === 0, "Source modal does not expose lattice line width.");
  assert((await page.getByRole("button", { name: "Move left" }).count()) === 0, "There is no stack to reorder.");
  assert((await page.getByRole("button", { name: "Delete cover" }).count()) === 0, "The single cover cannot be deleted.");
  await page.getByRole("checkbox", { name: "Lattice" }).check();

  let state = await appState(page);
  assert(state.cover.lattice?.frequency === 4, "Cover lattice defaults to frequency 4.");
  assert(state.cover.lattice.lineWidth === 3, "Cover lattice defaults to line width 3.");
  assert(state.cover.lattice.cutFill === true, "Cover lattice defaults to cutting its source fill.");

  const withLattice = await canvasStats(page);
  assert(withLattice.darkPixels > 1000, "Source fill remains visible after lattice creation.");
  await page.getByRole("button", { name: "Close" }).click();
  assert(
    JSON.stringify(await layerLabels(page)) === JSON.stringify(["Background", "Base sphere", "Cover", "Cover lattice"]),
    "Layer row shows the cover lattice after its source.",
  );

  await openLayerModal(page, "Cover lattice");
  await page.waitForSelector(".lattice-modal");
  await capture(page, screenshotPrefix, "cover-lattice-modal.png");
  modalText = await visibleTextWithin(page, ".lattice-modal");
  assert(
    modalText.every((text) => ["Color", "Alpha", "Density", "Line width", "Outline", "Outline width", "Spin", "Roll", "Pitch", "Yaw", "Dashes", "Back edges", "Off", "Lattice", "Both", "Through", "Cut fill"].includes(text)),
    `Lattice modal text is limited to approved labels and resolution values. Found ${JSON.stringify(modalText)}.`,
  );
  for (const label of ["Color", "Alpha", "Density", "Line width", "Outline", "Outline width", "Spin", "Dashes", "Back edges", "Off", "Lattice", "Both", "Through", "Cut fill"]) {
    assert(modalText.includes(label), `Lattice modal includes ${label}.`);
  }
  const previewBefore = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewBefore.nonTransparentPixels > 100, "Lattice modal preview circle renders lattice pixels.");
  const densitySlider = page.getByRole("slider", { name: "Density" });
  const densityBounds = await densitySlider.evaluate((input) => ({ min: input.min, max: input.max, step: input.step }));
  assert(
    densityBounds.min === "1" && densityBounds.max === "16" && densityBounds.step === "1",
    "Density slider steps through every geodesic frequency.",
  );
  await densitySlider.fill("3");
  await page.waitForTimeout(80);
  const previewAfterResolution = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterResolution.checksum !== previewBefore.checksum, "Lattice preview changes when resolution changes.");
  await page.getByRole("slider", { name: "Line width" }).fill("6");
  await page.waitForTimeout(80);
  const previewAfterWidth = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterWidth.checksum !== previewAfterResolution.checksum, "Lattice preview changes when line width changes.");
  await page.locator(".color-modal input[type='color']").fill("#ff0000");
  await page.waitForTimeout(80);
  const previewAfterColor = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterColor.checksum !== previewAfterWidth.checksum, "Lattice preview changes when color changes.");
  await page.getByRole("slider", { name: "Alpha" }).fill("0.35");
  await page.waitForTimeout(80);
  const previewAfterAlpha = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterAlpha.checksum !== previewAfterColor.checksum, "Lattice preview changes when alpha changes.");
  state = await appState(page);
  assert(state.cover.lattice.frequency === 3, "Lattice frequency is stored on the lattice.");
  assert(state.cover.lattice.lineWidth === 6, "Lattice line width is stored on the lattice.");
  assert(state.cover.lattice.color === "#ff0000" && state.cover.lattice.alpha === 0.35, "Lattice color and alpha are independent.");

  await page.getByRole("button", { name: "Close" }).click();
  await capture(page, screenshotPrefix, "lattice-styled.png");
  await openLayerModal(page, "Cover");
  await page.locator(".color-modal input[type='color']").fill("#00aa00");
  await page.getByRole("slider", { name: "Alpha" }).fill("0.65");
  state = await appState(page);
  assert(state.cover.color === "#00aa00" && state.cover.alpha === 0.65, "Source color and alpha update.");
  assert(state.cover.lattice.color === "#ff0000" && state.cover.lattice.alpha === 0.35, "Existing lattice does not inherit later source edits.");
  await page.getByRole("button", { name: "Close" }).click();

  await openLayerModal(page, "Base sphere");
  await page.getByRole("checkbox", { name: "Lattice" }).check();
  state = await appState(page);
  assert(state.base.lattice?.frequency === 4, "Base lattice is created from its source modal.");
  await page.getByRole("button", { name: "Close" }).click();
  assert(
    JSON.stringify(await layerLabels(page)) === JSON.stringify(["Background", "Base sphere", "Base lattice", "Cover", "Cover lattice"]),
    "Layer row shows both lattices after their sources.",
  );
  await openLayerModal(page, "Base lattice");
  await capture(page, screenshotPrefix, "base-lattice-modal.png");
  await page.getByRole("button", { name: "Delete lattice" }).click();
  assert((await page.getByRole("button", { name: "Base lattice" }).count()) === 0, "Base lattice can be deleted from its modal.");

  await openLayerModal(page, "Cover lattice");
  await page.getByRole("button", { name: "Delete lattice" }).click();
  assert((await page.getByRole("button", { name: "Cover lattice" }).count()) === 0, "Cover lattice can be deleted from its modal.");
}

// A cut lattice erases its own source's fill, so the fill never tints the lines.
// The erase must stop at that layer and leave whatever sits below it intact.
async function verifyLatticeCutFill(page, screenshotPrefix) {
  const cutState = (cutFill) => logoState({
    background: backgroundLayer({ color: "#ffffff", alpha: 1 }),
    base: baseLayer({
      color: "#0000ff",
      alpha: 1,
      lattice: latticeLayer({ color: "#ff0000", alpha: 0.4, lineWidth: 8, cutFill }),
    }),
    cover: coverLayer({ alpha: 0 }),
  });

  await setAppState(page, cutState(false));
  const blended = await stableCanvasStats(page);
  await setAppState(page, cutState(true));
  await capture(page, screenshotPrefix, "lattice-cut-fill.png");
  const cut = await stableCanvasStats(page);

  assert(cut.checksum !== blended.checksum, "Cutting the fill changes the render.");
  assert(cut.redPixels > blended.redPixels, "Cut lines read as their own color instead of blending with the fill beneath them.");
  assert(cut.bluePixels > 1000, "Cutting the fill leaves the negative space between the lines filled.");

  // The cover's lattice may only cut the cover, never the base under it.
  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000", alpha: 1 }),
    base: baseLayer({ color: "#0000ff", alpha: 1 }),
    cover: coverLayer({
      color: "#000000",
      alpha: 1,
      lattice: latticeLayer({ colorMode: "normal", color: "#ffffff", alpha: 0, lineWidth: 8, cutFill: true }),
    }),
    rotation: eulerToMatrix(45, 0, 0),
  }));
  const layered = await stableCanvasStats(page);
  assert(layered.bluePixels > 1000, "A cut cover lattice reveals the base sphere through the cut lines.");
  assert(layered.redPixels === 0, "A cut cover lattice never punches through to the background.");
}

async function verifyKnockoutAndExport(page, screenshotPrefix) {
  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000" }),
    base: baseLayer({ color: "#0000ff", alpha: 1 }),
    cover: coverLayer({ alpha: 0 }),
  }));
  let stats = await canvasStats(page);
  assert(stats.bluePixels > 1000, "Alpha 0 hides a layer without erasing lower layers.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ffffff", alpha: 0 }),
    base: baseLayer({ alpha: 0 }),
    cover: coverLayer({ alpha: 0 }),
  }));
  await capture(page, screenshotPrefix, "transparent-background-preview.png");
  stats = await canvasStats(page);
  assert(stats.transparentPixels > 1000, "Background alpha 0 reveals the checkerboard behind transparent canvas pixels.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ffffff", alpha: 0.5 }),
    base: baseLayer({ alpha: 0 }),
    cover: coverLayer({ alpha: 0 }),
  }));
  const previewAlpha = await page.locator(".logo-zone").evaluate((element) =>
    window.getComputedStyle(element, "::before").opacity,
  );
  assert(previewAlpha === "0.5", "Partially transparent background previews through the middle-section background layer.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000" }),
    base: baseLayer({ color: "#0000ff", alpha: 1 }),
    cover: coverLayer({ colorMode: "knockout", color: "#000000", alpha: 1 }),
  }));
  await capture(page, screenshotPrefix, "cover-knockout.png");
  stats = await canvasStats(page);
  assert(stats.transparentPixels > 1000 && stats.bluePixels > 1000, "Knockout erases lower layers only where its geometry is visible.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000" }),
    base: baseLayer({
      color: "#0000ff",
      lattice: latticeLayer({ colorMode: "knockout", lineWidth: 8 }),
    }),
    cover: coverLayer({ alpha: 0 }),
  }));
  await capture(page, screenshotPrefix, "lattice-knockout.png");
  stats = await canvasStats(page);
  assert(stats.transparentPixels > 100 && stats.bluePixels > 1000, "Knockout lattice erases only drawn lattice geometry, not gaps.");

  await resetApp(page);
  await openLayerModal(page, "Cover");
  await page.locator(".color-modal input[type='color']").fill("#336699");
  let state = await appState(page);
  assert(state.cover.color === "#336699" && state.cover.colorMode === "normal", "Normal color selection stores the regular color.");
  assert((await page.locator(".color-input-shell.active").count()) === 1, "Normal color circle is highlighted in normal color mode.");
  assert((await page.locator(".transparent-color-button.active").count()) === 0, "Transparent color is not highlighted in normal color mode.");
  await page.getByRole("button", { name: "Transparent color" }).click();
  assert(await page.getByRole("slider", { name: "Alpha" }).isDisabled(), "Knockout disables the alpha slider.");
  state = await appState(page);
  assert(state.cover.colorMode === "knockout" && state.cover.alpha === 1, "Knockout sets alpha to 1.");
  assert(state.cover.color === "#336699", "Selecting knockout does not overwrite the saved regular color.");
  assert((await page.locator(".color-input-shell.active").count()) === 0, "Normal color circle is not highlighted in knockout color mode.");
  assert((await page.locator(".transparent-color-button.active").count()) === 1, "Transparent color is highlighted in knockout color mode.");
  assert((await page.locator(".color-input-shell.knockout").count()) === 0, "Normal color circle does not adopt knockout styling.");
  await page.locator(".color-input-shell").dispatchEvent("pointerdown");
  state = await appState(page);
  assert(state.cover.colorMode === "normal" && state.cover.color === "#336699", "Selecting the regular color circle clears knockout without changing the saved color.");
  assert((await page.locator(".color-input-shell.active").count()) === 1, "Normal color circle is highlighted after selecting it.");
  assert((await page.locator(".transparent-color-button.active").count()) === 0, "Selecting regular color deselects transparent color.");
  await page.getByRole("button", { name: "Transparent color" }).click();
  await page.locator(".color-modal input[type='color']").fill("#123456");
  state = await appState(page);
  assert(state.cover.colorMode === "normal" && state.cover.alpha === 1, "Choosing a normal color leaves knockout with alpha 1.");
  assert(!(await page.getByRole("slider", { name: "Alpha" }).isDisabled()), "Normal color re-enables alpha.");
  assert((await page.locator(".transparent-color-button.active").count()) === 0, "Choosing a normal color deselects transparent color.");
  assert((await page.locator(".color-input-shell.active").count()) === 1, "Normal color circle is highlighted again after returning to normal color mode.");
  await page.getByRole("button", { name: "Transparent color" }).click();
  assert((await page.locator(".transparent-color-button.active").count()) === 1, "Knockout modal styling is discoverable.");
  await page.getByRole("button", { name: "Close" }).click();
  assert((await page.locator(".layer-swatch.knockout").count()) >= 1, "Knockout swatch styling is discoverable in the row.");

  await verifyExportAlpha(page, backgroundLayer({ alpha: 0 }), 0, "Background alpha 0 exports transparent corner pixels.");
  await verifyExportAlphaRange(page, backgroundLayer({ color: "#ffffff", alpha: 0.5 }), 120, 140, "Background alpha 0.5 exports translucent pixels without baking in the checkerboard.");
  await verifyExportAlpha(page, backgroundLayer({ colorMode: "knockout", alpha: 1 }), 0, "Background knockout exports transparent corner pixels.");
  await verifyExportAlpha(page, backgroundLayer({ color: "#ffffff", alpha: 1 }), 255, "Opaque background exports opaque corner pixels.");

  const knockoutExport = await exportPngForState(page, logoState({
    background: backgroundLayer({ color: "#ff0000", alpha: 1 }),
    base: baseLayer({ colorMode: "knockout", alpha: 1 }),
    cover: coverLayer({ alpha: 0 }),
  }));
  const center = rgbaAt(knockoutExport, 512, 512);
  assert(center.red > 240 && center.green < 20 && center.blue < 20 && center.alpha === 255, "Knockout layers preserve the editable background in exported PNGs.");
}

async function verifyExportAlpha(page, background, expectedCornerAlpha, message) {
  const cornerAlpha = await exportCornerAlpha(page, background);
  assert(cornerAlpha === expectedCornerAlpha, message);
}

async function verifyExportAlphaRange(page, background, minCornerAlpha, maxCornerAlpha, message) {
  const cornerAlpha = await exportCornerAlpha(page, background);
  assert(cornerAlpha >= minCornerAlpha && cornerAlpha <= maxCornerAlpha, message);
}

async function exportCornerAlpha(page, background) {
  const png = await exportPngForState(page, logoState({
    background,
    base: baseLayer({ alpha: 0 }),
    cover: coverLayer({ alpha: 0 }),
  }));

  return alphaAt(png, 0, 0);
}

async function exportPngForState(page, state) {
  await setAppState(page, state);
  await page.getByRole("button", { name: "Save logo" }).click();
  await page.waitForSelector(".save-modal");
  const filenameInput = page.getByRole("textbox", { name: "Filename" });
  assert((await filenameInput.inputValue()) === "logo.png", "Save modal opens with logo.png.");
  const selection = await filenameInput.evaluate((input) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
  }));
  assert(selection.start === 0 && selection.end === 4, "Save modal selects only the logo filename stem.");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirm" }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  assert(downloadedPath, "Logo export download produced a file.");
  assert(download.suggestedFilename() === "logo.png", "Logo export suggests logo.png.");

  const png = PNG.sync.read(await readFile(downloadedPath));
  assert(png.width === 1024 && png.height === 1024, "Logo export is 1024x1024.");
  return png;
}

function alphaAt(png, x, y) {
  return png.data[(png.width * y + x) * 4 + 3];
}

function rgbaAt(png, x, y) {
  const index = (png.width * y + x) * 4;
  return {
    red: png.data[index],
    green: png.data[index + 1],
    blue: png.data[index + 2],
    alpha: png.data[index + 3],
  };
}

async function runMainFlowChecks(page, screenshotPrefix) {
  logStep(`${screenshotPrefix}: load app`);
  page.setDefaultTimeout(15_000);
  await verifyLegacyMigration(page);
  await resetApp(page);
  await page.screenshot({ path: outputPath(`${screenshotPrefix}-main.png`), fullPage: true });
  await capture(page, screenshotPrefix, "main-checker-background.png");
  await assertCheckerboardSurface(page);
  await assertOpaquePanels(page);

  assert(
    JSON.stringify(await visibleText(page)) === JSON.stringify(["Roll", "Pitch", "Yaw", "Reset"]),
    "Main screen text is limited to the Euler labels and the reset control.",
  );

  const initial = await canvasStats(page);
  assert(initial.width > 0 && initial.height > 0, "Canvas has a rendered pixel buffer.");
  assert(initial.darkPixels > 1000, "Initial logo render contains visible cover pixels.");

  await verifyLayerRow(page);
  await verifyEulerEditor(page);
  await verifyRotationGestures(page);
  await verifyLatticeLayers(page, screenshotPrefix);
  await verifyLatticeCutFill(page, screenshotPrefix);
  await verifyKnockoutAndExport(page, screenshotPrefix);

  await resetApp(page);
  await openLayerModal(page, "Cover");
  const sourceModalText = await visibleTextWithin(page, ".color-modal");
  assert(
    JSON.stringify(sourceModalText) === JSON.stringify(["Color", "Alpha", "Lattice"]),
    `Color modal visible text is limited to approved source labels. Found ${JSON.stringify(sourceModalText)}.`,
  );
  await page.screenshot({ path: outputPath(`${screenshotPrefix}-color-modal.png`), fullPage: true });
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Save logo" }).click();
  await page.screenshot({ path: outputPath(`${screenshotPrefix}-save-modal.png`), fullPage: true });
  await page.getByRole("button", { name: "Close" }).click();
}

async function main() {
  const forcedExit = setTimeout(() => {
    console.error("[verify-ui] Verification did not finish within 180000ms.");
    process.exit(1);
  }, 180_000);

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
    await withTimeout("Mobile UI verification", 80_000, () => runMainFlowChecks(mobile, "mobile"));

    const desktop = await browser.newPage({ acceptDownloads: true, deviceScaleFactor: 1, viewport: { width: 900, height: 900 } });
    await withTimeout("Desktop UI verification", 80_000, () => runMainFlowChecks(desktop, "desktop"));
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
