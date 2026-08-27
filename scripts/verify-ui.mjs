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
    rotation: identityRotation(),
    selected: false,
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

function coverLayer(id, overrides = {}) {
  return {
    id,
    colorMode: "normal",
    color: "#000000",
    alpha: 1,
    rotation: identityRotation(),
    selected: false,
    ...overrides,
  };
}

function latticeLayer(overrides = {}) {
  return {
    colorMode: "normal",
    color: "#000000",
    alpha: 1,
    resolution: 320,
    lineWidth: 3,
    showIntersections: false,
    dotSize: 4,
    rotation: identityRotation(),
    selected: false,
    ...overrides,
  };
}

function logoState(overrides = {}) {
  const cover = coverLayer("cover-1", { selected: true });

  return {
    background: backgroundLayer(),
    base: baseLayer(),
    covers: [cover],
    stack: [{ kind: "cover", id: cover.id }],
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

async function selectedCount(page) {
  return page.locator(".layer-swatch.selected").count();
}

async function coverRotations(page) {
  return (await appState(page)).covers.map((cover) => cover.rotation);
}

async function rotatableRotations(page) {
  const state = await appState(page);
  const rotations = [state.base.rotation];

  if (state.base.lattice) {
    rotations.push(state.base.lattice.rotation);
  }

  for (const item of state.stack) {
    const cover = state.covers.find((candidate) => candidate.id === item.id);

    if (!cover) {
      continue;
    }

    if (item.kind === "cover") {
      rotations.push(cover.rotation);
    } else if (cover.lattice) {
      rotations.push(cover.lattice.rotation);
    }
  }

  return rotations;
}

async function setAllRotations(page, rotation) {
  const state = await appState(page);
  state.base.rotation = rotation;
  state.base.selected = true;
  if (state.base.lattice) {
    state.base.lattice.rotation = rotation;
    state.base.lattice.selected = true;
  }
  state.covers = state.covers.map((cover) => ({
    ...cover,
    rotation,
    selected: true,
    lattice: cover.lattice ? { ...cover.lattice, rotation, selected: true } : cover.lattice,
  }));
  await setAppState(page, state);
}

async function setCoverFixtures(page, covers, stack) {
  const state = await appState(page);
  state.base.selected = false;
  state.base.lattice = undefined;
  state.covers = covers;
  state.stack = stack ?? covers.flatMap((cover) => [
    { kind: "cover", id: cover.id },
    ...(cover.lattice ? [{ kind: "coverLattice", id: cover.id }] : []),
  ]);
  await setAppState(page, state);
}

async function eulerFieldValue(page, label) {
  return page.getByRole("textbox", { name: label }).inputValue();
}

async function assertEulerFieldValues(page, expected, message) {
  const actual = {
    Roll: await eulerFieldValue(page, "Roll"),
    Pitch: await eulerFieldValue(page, "Pitch"),
    Yaw: await eulerFieldValue(page, "Yaw"),
  };

  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} Expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}.`);
}

async function expectDisabled(page, label) {
  assert(await page.getByRole("textbox", { name: label }).isDisabled(), `${label} field is disabled.`);
}

async function longPress(locator, page) {
  const box = await locator.boundingBox();
  assert(box, "Long-press target has a bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(620);
  await page.mouse.up();
}

async function verifyLegacyMigration(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    localStorage.setItem(
      "logoBuilder.state.v1",
      JSON.stringify({
        base: { color: "#ffffff", alpha: 1, latticeResolution: 20, latticeSelected: true },
        covers: [{ id: "legacy-cover", color: "#000000", alpha: 1, roll: 12, pitch: 23, yaw: 34, selected: true }],
      }),
    );
  });
  await page.reload();
  await page.waitForSelector("[data-logo-canvas]");

  const state = await appState(page);
  assert(state.background.color === "#ffffff" && state.background.colorMode === "normal", "Legacy state gains a normal white background.");
  assert(state.base.lattice?.resolution === 20 && state.base.lattice.selected === true, "Legacy base lattice fields migrate to a lattice object.");
  assertMatrixClose(state.covers[0].rotation, eulerToMatrix(12, 23, 34), "Legacy roll/pitch/yaw state migrates to a rotation matrix.");
  assert(JSON.stringify(state.stack) === JSON.stringify([{ kind: "cover", id: "legacy-cover" }]), "Missing stack rebuilds from cover order.");
}

async function verifySelectionAndBase(page) {
  await resetApp(page);
  assert(
    JSON.stringify(await layerLabels(page)) === JSON.stringify(["Background", "Base sphere", "Cover 1", "Add cover"]),
    "Initial row includes background, base, cover, and add.",
  );
  assert((await selectedCount(page)) === 1, "Initial cover is selected.");

  await page.getByRole("button", { name: "Background" }).click();
  let state = await appState(page);
  assert(state.base.selected === true && state.covers[0].selected === true, "Background swatch selects all rotatable layers.");
  assert((await selectedCount(page)) === 2, "Background itself is not visually selected.");

  await page.getByRole("button", { name: "Background" }).click();
  state = await appState(page);
  assert(state.base.selected === false && state.covers[0].selected === false, "Background swatch clears all rotatable selections.");
  await assertEulerFieldValues(page, { Roll: "", Pitch: "", Yaw: "" }, "Euler fields blank when no rotatable layer is selected.");
  await Promise.all([expectDisabled(page, "Roll"), expectDisabled(page, "Pitch"), expectDisabled(page, "Yaw")]);

  await page.getByRole("button", { name: "Base sphere" }).click();
  const beforeBase = (await appState(page)).base.rotation;
  await dragLogo(page, { dx: 70, dy: 0 });
  state = await appState(page);
  assert(maxMatrixDifference(state.base.rotation, beforeBase) > 0.001, "Selected base sphere rotates from drag.");
  assert(state.covers[0].selected === false, "Selecting base sphere does not select the cover.");
}

async function verifyEulerEditor(page) {
  await resetApp(page);
  await assertEulerFieldValues(page, { Roll: "0.0", Pitch: "0.0", Yaw: "0.0" }, "Initial Euler fields show the selected cover rotation.");

  const rollInput = page.getByRole("textbox", { name: "Roll" });
  const pitchInput = page.getByRole("textbox", { name: "Pitch" });
  const yawInput = page.getByRole("textbox", { name: "Yaw" });
  const beforeDraft = await stableCanvasStats(page);
  await rollInput.fill("45");
  const afterDraft = await stableCanvasStats(page);
  assert(beforeDraft.checksum === afterDraft.checksum, "Typing in an Euler field does not mutate the logo before commit.");
  await rollInput.press("Enter");
  await assertEulerFieldValues(page, { Roll: "45.0", Pitch: "0.0", Yaw: "0.0" }, "Enter commits an Euler field edit.");
  let [rotation] = await coverRotations(page);
  assertMatrixClose(rotation, eulerToMatrix(45, 0, 0), "Enter commit applies the absolute Euler rotation.");

  await pitchInput.fill("30");
  await pitchInput.evaluate((input) => input.blur());
  await assertEulerFieldValues(page, { Roll: "45.0", Pitch: "30.0", Yaw: "0.0" }, "Blur commits an Euler field edit.");
  [rotation] = await coverRotations(page);
  assertMatrixClose(rotation, eulerToMatrix(45, 30, 0), "Blur commit applies the absolute Euler rotation.");

  await pitchInput.fill("-20");
  await pitchInput.press("Enter");
  assert((await eulerFieldValue(page, "Pitch")) === "0.0", "Euler input clamps values below 0.");

  await yawInput.fill("720");
  await yawInput.press("Enter");
  assert((await eulerFieldValue(page, "Yaw")) === "360.0", "Euler input clamps values above 360.");

  await rollInput.fill("");
  await rollInput.press("Enter");
  assert((await eulerFieldValue(page, "Roll")) === "45.0", "Empty Euler input reverts to the current live value.");

  const firstRotation = eulerToMatrix(10, 20, 30);
  const secondRotation = eulerToMatrix(35, 50, 65);
  const thirdRotation = eulerToMatrix(80, 95, 110);
  await setCoverFixtures(page, [
    coverLayer("deep", { color: "#000000", rotation: firstRotation, selected: true }),
    coverLayer("surface", { color: "#444444", alpha: 0.8, rotation: secondRotation, selected: true }),
    coverLayer("still", { color: "#888888", alpha: 0.6, rotation: thirdRotation, selected: false }),
  ]);
  await assertEulerFieldValues(page, { Roll: "10.0", Pitch: "20.0", Yaw: "30.0" }, "Deepest selected rotatable layer drives the Euler fields.");

  await rollInput.fill("80");
  await rollInput.press("Enter");
  const covers = (await appState(page)).covers;
  const targetRotation = eulerToMatrix(80, 20, 30);
  const deltaRotation = multiplyMatrices(targetRotation, transpose(firstRotation));
  assertMatrixClose(covers[0].rotation, targetRotation, "Euler edit lands the deepest selected cover on the absolute target.");
  assertMatrixClose(covers[1].rotation, multiplyMatrices(deltaRotation, secondRotation), "Euler edit applies the same delta to another selected cover.");
  assertMatrixClose(covers[2].rotation, thirdRotation, "Euler edit does not move unselected covers.");
}

async function verifyRotationGestures(page) {
  await resetApp(page);
  await page.getByRole("button", { name: "Background" }).click();
  await dragLogo(page, { dx: 100, dy: 0 });
  let rotations = await rotatableRotations(page);
  let expectedRotation = modelAxisRotation({ yDegrees: 100 * DRAG_DEGREES_PER_PIXEL });
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Dragging right applies only screen y-axis rotation."));

  await resetApp(page);
  await page.getByRole("button", { name: "Background" }).click();
  await dragLogo(page, { dx: 0, dy: 100 });
  rotations = await rotatableRotations(page);
  expectedRotation = modelAxisRotation({ xDegrees: 100 * DRAG_DEGREES_PER_PIXEL });
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Dragging down applies only screen x-axis rotation."));

  await resetApp(page);
  await page.getByRole("button", { name: "Background" }).click();
  await dragLogo(page, { startOffsetY: -100, dx: 100, dy: 100, shift: true });
  rotations = await rotatableRotations(page);
  expectedRotation = modelAxisRotation({ zDegrees: -90 });
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Clockwise Shift-drag applies only screen z-axis rotation."));

  const preRotated = screenAxisRotation({ xDegrees: 28, yDegrees: -17, zDegrees: 42 });
  await setAllRotations(page, preRotated);
  await dragLogo(page, { dx: 80, dy: 0 });
  rotations = await rotatableRotations(page);
  expectedRotation = multiplyMatrices(modelAxisRotation({ yDegrees: 80 * DRAG_DEGREES_PER_PIXEL }), preRotated);
  rotations.forEach((rotation) => assertMatrixClose(rotation, expectedRotation, "Horizontal drag pre-multiplies screen y-axis rotation."));
}

async function verifyLatticeLayers(page, screenshotPrefix) {
  await resetApp(page);
  await longPress(page.getByRole("button", { name: "Background" }), page);
  await page.waitForSelector(".color-modal");
  await capture(page, screenshotPrefix, "background-modal.png");
  let modalText = await visibleTextWithin(page, ".color-modal");
  assert(JSON.stringify(modalText) === JSON.stringify(["Color", "Alpha"]), `Background modal labels are limited to Color and Alpha. Found ${JSON.stringify(modalText)}.`);
  await page.getByRole("button", { name: "Close" }).click();

  await longPress(page.getByRole("button", { name: "Base sphere" }), page);
  await page.waitForSelector(".color-modal");
  await capture(page, screenshotPrefix, "base-modal.png");
  modalText = await visibleTextWithin(page, ".color-modal");
  assert(JSON.stringify(modalText) === JSON.stringify(["Color", "Alpha", "Lattice"]), `Base modal exposes source labels only. Found ${JSON.stringify(modalText)}.`);
  await page.getByRole("button", { name: "Close" }).click();

  await longPress(page.getByRole("button", { name: "Cover 1", exact: true }), page);
  await page.waitForSelector(".color-modal");
  await capture(page, screenshotPrefix, "cover-modal.png");
  modalText = await visibleTextWithin(page, ".color-modal");
  assert(JSON.stringify(modalText) === JSON.stringify(["Color", "Alpha", "Lattice"]), `Cover modal exposes source labels only. Found ${JSON.stringify(modalText)}.`);
  assert((await page.getByRole("combobox", { name: "Lattice resolution" }).count()) === 0, "Source modal does not expose lattice resolution.");
  assert((await page.getByRole("slider", { name: "Line width" }).count()) === 0, "Source modal does not expose lattice line width.");
  assert((await page.getByRole("slider", { name: "Dot size" }).count()) === 0, "Source modal does not expose lattice dot size.");
  await page.getByRole("checkbox", { name: "Lattice" }).check();

  let state = await appState(page);
  assert(state.covers[0].lattice?.resolution === 320, "Cover lattice defaults to resolution 320.");
  assert(state.covers[0].lattice.lineWidth === 3, "Cover lattice defaults to line width 3.");
  assert(state.covers[0].lattice.showIntersections === false, "Cover lattice defaults to dots off.");
  assert(state.covers[0].lattice.dotSize === 4, "Cover lattice defaults to dot size 4.");
  assert(state.covers[0].selected === true && state.covers[0].lattice.selected === true, "Enabling cover lattice selects source and lattice.");
  assert(JSON.stringify(state.stack) === JSON.stringify([{ kind: "cover", id: state.covers[0].id }, { kind: "coverLattice", id: state.covers[0].id }]), "Cover lattice is inserted outside its source.");

  const withLattice = await canvasStats(page);
  assert(withLattice.darkPixels > 1000, "Source fill remains visible after lattice creation.");
  await page.getByRole("button", { name: "Close" }).click();
  assert(
    JSON.stringify(await layerLabels(page)) === JSON.stringify(["Background", "Base sphere", "Cover 1", "Cover 1 lattice", "Add cover"]),
    "Layer row shows the cover lattice in stack order.",
  );

  await longPress(page.getByRole("button", { name: "Cover 1 lattice" }), page);
  await page.waitForSelector(".lattice-modal");
  await capture(page, screenshotPrefix, "cover-lattice-modal.png");
  modalText = await visibleTextWithin(page, ".lattice-modal");
  assert(
    modalText.every((text) => ["Color", "Alpha", "Resolution", "20", "80", "320", "1280", "5120", "Line width", "Dots", "Dot size"].includes(text)),
    `Lattice modal text is limited to approved labels and resolution values. Found ${JSON.stringify(modalText)}.`,
  );
  for (const label of ["Color", "Alpha", "Resolution", "Line width", "Dots", "Dot size"]) {
    assert(modalText.includes(label), `Lattice modal includes ${label}.`);
  }
  const previewBefore = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewBefore.nonTransparentPixels > 100, "Lattice modal preview circle renders lattice pixels.");
  const latticeOptions = await page.getByRole("combobox", { name: "Lattice resolution" }).evaluate((select) =>
    [...select.options].map((option) => option.textContent),
  );
  assert(JSON.stringify(latticeOptions) === JSON.stringify(["20", "80", "320", "1280", "5120"]), "Lattice modal exposes every resolution.");
  await page.getByRole("combobox", { name: "Lattice resolution" }).selectOption("1280");
  await page.waitForTimeout(80);
  const previewAfterResolution = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterResolution.checksum !== previewBefore.checksum, "Lattice preview changes when resolution changes.");
  await page.getByRole("slider", { name: "Line width" }).fill("6");
  await page.waitForTimeout(80);
  const previewAfterWidth = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterWidth.checksum !== previewAfterResolution.checksum, "Lattice preview changes when line width changes.");
  assert(await page.getByRole("slider", { name: "Dot size" }).isDisabled(), "Dot-size slider is disabled while intersections are off.");
  await page.getByRole("checkbox", { name: "Intersection points" }).check();
  await page.waitForTimeout(80);
  const previewAfterDots = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterDots.checksum !== previewAfterWidth.checksum, "Lattice preview changes when dots are enabled.");
  await page.getByRole("slider", { name: "Dot size" }).fill("7");
  await page.waitForTimeout(80);
  const previewAfterDotSize = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterDotSize.checksum !== previewAfterDots.checksum, "Lattice preview changes when dot size changes.");
  await page.locator(".color-modal input[type='color']").fill("#ff0000");
  await page.waitForTimeout(80);
  const previewAfterColor = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterColor.checksum !== previewAfterDotSize.checksum, "Lattice preview changes when color changes.");
  await page.getByRole("slider", { name: "Alpha" }).fill("0.35");
  await page.waitForTimeout(80);
  const previewAfterAlpha = await elementCanvasStats(page, ".lattice-preview-canvas");
  assert(previewAfterAlpha.checksum !== previewAfterColor.checksum, "Lattice preview changes when alpha changes.");
  state = await appState(page);
  assert(state.covers[0].lattice.resolution === 1280, "Lattice resolution is stored on the lattice.");
  assert(state.covers[0].lattice.lineWidth === 6, "Lattice line width is stored on the lattice.");
  assert(state.covers[0].lattice.showIntersections === true && state.covers[0].lattice.dotSize === 7, "Intersection settings are stored on the lattice.");
  assert(state.covers[0].lattice.color === "#ff0000" && state.covers[0].lattice.alpha === 0.35, "Lattice color and alpha are independent.");

  await page.getByRole("button", { name: "Close" }).click();
  await capture(page, screenshotPrefix, "lattice-dots-on.png");
  await longPress(page.getByRole("button", { name: "Cover 1", exact: true }), page);
  await page.locator(".color-modal input[type='color']").fill("#00aa00");
  await page.getByRole("slider", { name: "Alpha" }).fill("0.65");
  state = await appState(page);
  assert(state.covers[0].color === "#00aa00" && state.covers[0].alpha === 0.65, "Source color and alpha update.");
  assert(state.covers[0].lattice.color === "#ff0000" && state.covers[0].lattice.alpha === 0.35, "Existing lattice does not inherit later source edits.");
  await page.getByRole("button", { name: "Close" }).click();

  const beforeIndependent = await appState(page);
  await page.getByRole("button", { name: "Cover 1", exact: true }).click();
  await dragLogo(page, { dx: 80, dy: 0 });
  state = await appState(page);
  assertMatrixClose(state.covers[0].rotation, beforeIndependent.covers[0].rotation, "Unselected source cover does not rotate when only lattice is selected.");
  assert(maxMatrixDifference(state.covers[0].lattice.rotation, beforeIndependent.covers[0].lattice.rotation) > 0.001, "Selected lattice rotates independently from its source.");

  await page.getByRole("button", { name: "Cover 1", exact: true }).click();
  const beforeTogether = await appState(page);
  await dragLogo(page, { dx: 0, dy: 80 });
  state = await appState(page);
  assert(
    maxMatrixDifference(state.covers[0].rotation, beforeTogether.covers[0].rotation) > 0.001 &&
      maxMatrixDifference(state.covers[0].lattice.rotation, beforeTogether.covers[0].lattice.rotation) > 0.001,
    "Selecting source and lattice rotates both together.",
  );

  await page.getByRole("button", { name: "Add cover" }).click();
  await longPress(page.getByRole("button", { name: "Cover 1 lattice" }), page);
  await page.waitForSelector(".lattice-modal");
  await page.getByRole("button", { name: "Move right" }).click();
  state = await appState(page);
  assert(state.stack[2].kind === "coverLattice", "Moving a lattice changes only the movable stack order.");
  await page.getByRole("button", { name: "Close" }).click();
  await capture(page, screenshotPrefix, "reordered-layers.png");
  await longPress(page.getByRole("button", { name: "Cover 1 lattice" }), page);
  await page.waitForSelector(".lattice-modal");
  await page.getByRole("button", { name: "Move left" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await longPress(page.getByRole("button", { name: "Base sphere" }), page);
  await page.waitForSelector(".color-modal");
  assert(await page.getByRole("button", { name: "Move left" }).isDisabled(), "Base sphere left move is disabled.");
  assert(await page.getByRole("button", { name: "Move right" }).isDisabled(), "Base sphere right move is disabled.");
  await page.getByRole("checkbox", { name: "Lattice" }).check();
  state = await appState(page);
  assert(state.base.selected === true && state.base.lattice?.selected === true, "Enabling base lattice selects base and base lattice.");
  await page.getByRole("button", { name: "Close" }).click();
  await longPress(page.getByRole("button", { name: "Base lattice" }), page);
  await capture(page, screenshotPrefix, "base-lattice-modal.png");
  assert(await page.getByRole("button", { name: "Move left" }).isDisabled(), "Base lattice left move is disabled.");
  assert(await page.getByRole("button", { name: "Move right" }).isDisabled(), "Base lattice right move is disabled.");
  await page.getByRole("button", { name: "Delete lattice" }).click();
  assert((await page.getByRole("button", { name: "Base lattice" }).count()) === 0, "Base lattice can be deleted from its modal.");

  await longPress(page.getByRole("button", { name: "Cover 1 lattice" }), page);
  await page.getByRole("button", { name: "Delete lattice" }).click();
  assert((await page.getByRole("button", { name: "Cover 1 lattice" }).count()) === 0, "Cover lattice can be deleted from its modal.");
}

async function verifyKnockoutAndExport(page, screenshotPrefix) {
  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000" }),
    base: baseLayer({ color: "#0000ff", alpha: 1, selected: false }),
    covers: [coverLayer("cover-1", { alpha: 0, selected: false })],
    stack: [{ kind: "cover", id: "cover-1" }],
  }));
  let stats = await canvasStats(page);
  assert(stats.bluePixels > 1000, "Alpha 0 hides a layer without erasing lower layers.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ffffff", alpha: 0 }),
    base: baseLayer({ alpha: 0, selected: false }),
    covers: [coverLayer("cover-1", { alpha: 0, selected: false })],
    stack: [{ kind: "cover", id: "cover-1" }],
  }));
  await capture(page, screenshotPrefix, "transparent-background-preview.png");
  stats = await canvasStats(page);
  assert(stats.transparentPixels > 1000, "Background alpha 0 reveals the checkerboard behind transparent canvas pixels.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ffffff", alpha: 0.5 }),
    base: baseLayer({ alpha: 0, selected: false }),
    covers: [coverLayer("cover-1", { alpha: 0, selected: false })],
    stack: [{ kind: "cover", id: "cover-1" }],
  }));
  const previewAlpha = await page.locator(".logo-zone").evaluate((element) =>
    window.getComputedStyle(element, "::before").opacity,
  );
  assert(previewAlpha === "0.5", "Partially transparent background previews through the middle-section background layer.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000" }),
    base: baseLayer({ color: "#0000ff", alpha: 1, selected: false }),
    covers: [coverLayer("cover-1", { colorMode: "knockout", color: "#000000", alpha: 1, selected: false })],
    stack: [{ kind: "cover", id: "cover-1" }],
  }));
  await capture(page, screenshotPrefix, "cover-knockout.png");
  stats = await canvasStats(page);
  assert(stats.transparentPixels > 1000 && stats.bluePixels > 1000, "Knockout erases lower layers only where its geometry is visible.");

  await setAppState(page, logoState({
    background: backgroundLayer({ color: "#ff0000" }),
    base: baseLayer({
      color: "#0000ff",
      lattice: latticeLayer({ colorMode: "knockout", lineWidth: 8, selected: false }),
    }),
    covers: [coverLayer("cover-1", { alpha: 0, selected: false })],
    stack: [{ kind: "cover", id: "cover-1" }],
  }));
  await capture(page, screenshotPrefix, "lattice-knockout.png");
  stats = await canvasStats(page);
  assert(stats.transparentPixels > 100 && stats.bluePixels > 1000, "Knockout lattice erases only drawn lattice geometry, not gaps.");

  await resetApp(page);
  await longPress(page.getByRole("button", { name: "Cover 1", exact: true }), page);
  assert((await page.locator(".color-input-shell.active").count()) === 1, "Normal color circle is highlighted in normal color mode.");
  assert((await page.locator(".transparent-color-button.active").count()) === 0, "Transparent color is not highlighted in normal color mode.");
  await page.getByRole("button", { name: "Transparent color" }).click();
  assert(await page.getByRole("slider", { name: "Alpha" }).isDisabled(), "Knockout disables the alpha slider.");
  let state = await appState(page);
  assert(state.covers[0].colorMode === "knockout" && state.covers[0].alpha === 1, "Knockout sets alpha to 1.");
  assert((await page.locator(".color-input-shell.active").count()) === 0, "Normal color circle is not highlighted in knockout color mode.");
  assert((await page.locator(".transparent-color-button.active").count()) === 1, "Transparent color is highlighted in knockout color mode.");
  await page.locator(".color-modal input[type='color']").fill("#123456");
  state = await appState(page);
  assert(state.covers[0].colorMode === "normal" && state.covers[0].alpha === 1, "Choosing a normal color leaves knockout with alpha 1.");
  assert(!(await page.getByRole("slider", { name: "Alpha" }).isDisabled()), "Normal color re-enables alpha.");
  assert((await page.locator(".color-input-shell.knockout").count()) === 0, "Normal color removes knockout modal styling.");
  assert((await page.locator(".color-input-shell.active").count()) === 1, "Normal color circle is highlighted again after returning to normal color mode.");
  await page.getByRole("button", { name: "Transparent color" }).click();
  assert((await page.locator(".color-input-shell.knockout").count()) === 1, "Knockout modal styling is discoverable.");
  await page.getByRole("button", { name: "Close" }).click();
  assert((await page.locator(".layer-swatch.knockout").count()) >= 1, "Knockout swatch styling is discoverable in the row.");

  await verifyExportAlpha(page, backgroundLayer({ alpha: 0 }), 0, "Background alpha 0 exports transparent corner pixels.");
  await verifyExportAlphaRange(page, backgroundLayer({ color: "#ffffff", alpha: 0.5 }), 120, 140, "Background alpha 0.5 exports translucent pixels without baking in the checkerboard.");
  await verifyExportAlpha(page, backgroundLayer({ colorMode: "knockout", alpha: 1 }), 0, "Background knockout exports transparent corner pixels.");
  await verifyExportAlpha(page, backgroundLayer({ color: "#ffffff", alpha: 1 }), 255, "Opaque background exports opaque corner pixels.");
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
  await setAppState(page, logoState({
    background,
    base: baseLayer({ alpha: 0 }),
    covers: [coverLayer("cover-1", { alpha: 0 })],
    stack: [{ kind: "cover", id: "cover-1" }],
  }));
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
  return alphaAt(png, 0, 0);
}

function alphaAt(png, x, y) {
  return png.data[(png.width * y + x) * 4 + 3];
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
    JSON.stringify(await visibleText(page)) === JSON.stringify(["Roll", "Pitch", "Yaw"]),
    "Main screen text is limited to the Euler field labels.",
  );

  const initial = await canvasStats(page);
  assert(initial.width > 0 && initial.height > 0, "Canvas has a rendered pixel buffer.");
  assert(initial.darkPixels > 1000, "Initial logo render contains visible cover pixels.");

  await verifySelectionAndBase(page);
  await verifyEulerEditor(page);
  await verifyRotationGestures(page);
  await verifyLatticeLayers(page, screenshotPrefix);
  await verifyKnockoutAndExport(page, screenshotPrefix);

  await resetApp(page);
  await longPress(page.getByRole("button", { name: "Cover 1", exact: true }), page);
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
