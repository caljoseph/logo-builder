import { chromium } from "playwright";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputDir = new URL("../icosphere-output/", import.meta.url);
const resolutions = [20, 80, 320, 1280, 5120];
const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const previewCases = resolutions.flatMap((resolution) => [
  {
    label: `sphere-s${resolution}`,
    kind: "sphere",
    resolution,
    latticeRotation: { roll: 24, pitch: 18, yaw: 12 },
  },
  {
    label: `cover-a-s${resolution}`,
    kind: "cover",
    resolution,
    sourceRotation: { roll: 0, pitch: 0, yaw: 0 },
    latticeRotation: { roll: 24, pitch: 18, yaw: 12 },
  },
  {
    label: `cover-b-s${resolution}`,
    kind: "cover",
    resolution,
    sourceRotation: { roll: 35, pitch: 25, yaw: 0 },
    latticeRotation: { roll: -18, pitch: 42, yaw: 30 },
  },
]);

async function launchBrowser() {
  for (const executablePath of chromePaths) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch {
      // Try the next local browser path.
    }
  }

  return chromium.launch({ headless: true });
}

function pngBufferFromDataUrl(dataUrl) {
  return Buffer.from(dataUrl.split(",", 2)[1], "base64");
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await clearOutputPngs();

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 920, height: 920 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120_000);
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: browserPreviewBundle() });

  let written = 0;

  try {
    for (const previewCase of previewCases) {
      const dataUrl = await page.evaluate(
        ({ currentCase }) => window.generateIcospherePreview(currentCase),
        { currentCase: previewCase },
      );
      await writeFile(fileURLToPath(new URL(`${previewCase.label}.png`, outputDir)), pngBufferFromDataUrl(dataUrl));
      written += 1;
      console.log(`[icosphere] wrote ${previewCase.label}.png`);
    }
  } finally {
    await browser.close();
  }

  console.log(`[icosphere] complete: ${written} PNGs written to ${fileURLToPath(outputDir)}`);
}

async function clearOutputPngs() {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => rm(new URL(entry.name, outputDir))),
  );
}

function generateIcospherePreview(previewCase) {
  const SIZE = 900;
  const RADIUS = 340;
  const CENTER = [SIZE / 2, SIZE / 2];
  const SEAM_SAMPLES = 4000;
  const CIRCLE_SAMPLES = 1000;
  const EDGE_SAMPLES = 48;
  const seamPoints = createSeamPoints(SEAM_SAMPLES);
  const seamProjection = seamPoints.map(stereographicProject);
  const lattice = createIcosphere(previewCase.resolution);
  const latticeRotation = rotationMatrix(
    previewCase.latticeRotation.roll,
    previewCase.latticeRotation.pitch,
    previewCase.latticeRotation.yaw,
  );
  const sourceRotation = previewCase.kind === "cover"
    ? rotationMatrix(previewCase.sourceRotation.roll, previewCase.sourceRotation.pitch, previewCase.sourceRotation.yaw)
    : identityRotation();
  const maskPolygons = previewCase.kind === "cover"
    ? buildVisibleCoverPolygons(sourceRotation)
    : [circlePolygon(CIRCLE_SAMPLES)];

  assert(lattice.faces.length === previewCase.resolution, `Expected ${previewCase.resolution} faces.`);
  assert(lattice.edges.length > 0, "Icosphere has renderable edges.");
  assert(maskPolygons.length > 0, "Preview has at least one mask polygon.");

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, SIZE, SIZE);

  context.save();
  beginMaskPath(context, maskPolygons);
  context.clip();
  drawIcosphereEdges(context, lattice, latticeRotation, EDGE_SAMPLES);
  context.restore();

  drawMaskOutline(context, maskPolygons);

  return canvas.toDataURL("image/png");

  function drawIcosphereEdges(context, mesh, rotation, samples) {
    context.save();
    context.strokeStyle = "rgba(17, 17, 17, 0.9)";
    context.lineWidth = Math.max(1.75, RADIUS * 0.007);
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const [aIndex, bIndex] of mesh.edges) {
      const points = sampleGreatCircleEdge(mesh.vertices[aIndex], mesh.vertices[bIndex], samples)
        .map((point) => multiplyMatrixVector(rotation, point));
      drawFrontPolyline(context, points);
    }

    context.restore();
  }

  function drawFrontPolyline(context, points) {
    let drawing = false;

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[index - 1];

      if (previous && previous[2] * current[2] < 0) {
        const crossing = interpolateZCrossing(previous, current);
        const [x, y] = toCanvas(crossing);

        if (drawing) {
          context.lineTo(x, y);
          context.stroke();
          drawing = false;
        } else if (current[2] >= 0) {
          context.beginPath();
          context.moveTo(x, y);
          drawing = true;
        }
      }

      if (current[2] < 0) {
        continue;
      }

      const [x, y] = toCanvas(current);

      if (!drawing) {
        context.beginPath();
        context.moveTo(x, y);
        drawing = true;
      } else {
        context.lineTo(x, y);
      }
    }

    if (drawing) {
      context.stroke();
    }
  }

  function beginMaskPath(context, polygons) {
    context.beginPath();

    for (const polygon of polygons) {
      if (polygon.length < 3) {
        continue;
      }

      const [startX, startY] = toCanvas(polygon[0]);
      context.moveTo(startX, startY);

      for (let index = 1; index < polygon.length; index += 1) {
        const [x, y] = toCanvas(polygon[index]);
        context.lineTo(x, y);
      }

      context.closePath();
    }
  }

  function drawMaskOutline(context, polygons) {
    context.save();
    context.strokeStyle = "rgba(17, 17, 17, 0.9)";
    context.lineWidth = Math.max(1.75, RADIUS * 0.007);
    context.lineCap = "round";
    context.lineJoin = "round";
    beginMaskPath(context, polygons);
    context.stroke();
    context.restore();
  }

  function toCanvas(point) {
    return [CENTER[0] + point[0] * RADIUS, CENTER[1] - point[1] * RADIUS];
  }

  function buildVisibleCoverPolygons(rotation) {
    const rotated = seamPoints.map((point) => multiplyMatrixVector(rotation, point));
    const crossings = findSilhouetteCrossings(rotated);

    if (crossings.length === 0) {
      return isInCover([0, 0, 1], rotation) ? [circlePolygon(CIRCLE_SAMPLES)] : [];
    }

    const edges = [];
    const pointCount = rotated.length;

    for (let index = 0; index < crossings.length; index += 1) {
      const current = crossings[index];
      const next = crossings[(index + 1) % crossings.length];
      const seamIndices = wrappedIndices(current.index + 1, next.index, pointCount);
      const meanZ = seamIndices.reduce((total, seamIndex) => total + rotated[seamIndex][2], 0) / seamIndices.length;

      if (meanZ > 0) {
        edges.push({
          a: index,
          b: (index + 1) % crossings.length,
          points: [
            current.point,
            ...seamIndices.map((seamIndex) => [rotated[seamIndex][0], rotated[seamIndex][1]]),
            next.point,
          ],
        });
      }
    }

    const angles = crossings.map(({ point }) => positiveAngle(Math.atan2(point[1], point[0])));
    const order = angles.map((angle, index) => ({ angle, index })).sort((a, b) => a.angle - b.angle);

    for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      const a = order[orderIndex].index;
      const b = order[(orderIndex + 1) % order.length].index;
      const theta0 = angles[a];
      const delta = positiveAngle(angles[b] - theta0);
      const thetaMid = theta0 + delta / 2;
      const epsilon = 1e-7;
      const rho = Math.sqrt(1 - epsilon * epsilon);
      const testPoint = [rho * Math.cos(thetaMid), rho * Math.sin(thetaMid), epsilon];

      if (isInCover(testPoint, rotation)) {
        const arcPoints = Math.max(3, Math.floor((CIRCLE_SAMPLES * delta) / (Math.PI * 2)) + 2);
        const points = [];

        for (let sample = 0; sample < arcPoints; sample += 1) {
          const theta = theta0 + (delta * sample) / (arcPoints - 1);
          points.push([Math.cos(theta), Math.sin(theta)]);
        }

        edges.push({ a, b, points });
      }
    }

    return closePolygonsFromEdges(edges, crossings.length);
  }

  function isInCover(rotatedPoint, rotation) {
    const unrotated = multiplyMatrixVector(transpose(rotation), rotatedPoint);
    return pointInPolygon(stereographicProject(unrotated), seamProjection);
  }
}

function browserPreviewBundle() {
  return [
    createIcosphere,
    midpointIndex,
    uniqueEdges,
    sampleGreatCircleEdge,
    createSeamPoints,
    findSilhouetteCrossings,
    closePolygonsFromEdges,
    circlePolygon,
    pointInPolygon,
    wrappedIndices,
    identityRotation,
    rotationMatrix,
    multiplyMatrices,
    multiplyMatrixVector,
    transpose,
    interpolateZCrossing,
    stereographicProject,
    normalize3,
    dot3,
    positiveAngle,
    clamp,
    degreesToRadians,
    assert,
    generateIcospherePreview,
  ].map((fn) => fn.toString()).join("\n") + "\nwindow.generateIcospherePreview = generateIcospherePreview;";
}

function createIcosphere(faceCount) {
  const subdivisions = {
    20: 0,
    80: 1,
    320: 2,
    1280: 3,
    5120: 4,
  }[faceCount];

  assert(subdivisions !== undefined, `Unsupported icosphere face count: ${faceCount}`);

  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ].map(normalize3);
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let step = 0; step < subdivisions; step += 1) {
    const midpointCache = new Map();
    const nextFaces = [];

    for (const [a, b, c] of faces) {
      const ab = midpointIndex(vertices, midpointCache, a, b);
      const bc = midpointIndex(vertices, midpointCache, b, c);
      const ca = midpointIndex(vertices, midpointCache, c, a);
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }

    faces = nextFaces;
  }

  return { vertices, faces, edges: uniqueEdges(faces) };
}

function midpointIndex(vertices, cache, a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const midpoint = normalize3([
    (vertices[a][0] + vertices[b][0]) / 2,
    (vertices[a][1] + vertices[b][1]) / 2,
    (vertices[a][2] + vertices[b][2]) / 2,
  ]);
  const index = vertices.length;
  vertices.push(midpoint);
  cache.set(key, index);
  return index;
}

function uniqueEdges(faces) {
  const seen = new Set();
  const edges = [];

  for (const [a, b, c] of faces) {
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;

      if (!seen.has(key)) {
        seen.add(key);
        edges.push(start < end ? [start, end] : [end, start]);
      }
    }
  }

  return edges;
}

function sampleGreatCircleEdge(start, end, samples) {
  const dot = clamp(dot3(start, end), -1, 1);
  const angle = Math.acos(dot);

  if (angle < 1e-8) {
    return [start, end];
  }

  const sine = Math.sin(angle);
  const points = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const a = Math.sin((1 - t) * angle) / sine;
    const b = Math.sin(t * angle) / sine;
    points.push(normalize3([
      start[0] * a + end[0] * b,
      start[1] * a + end[1] * b,
      start[2] * a + end[2] * b,
    ]));
  }

  return points;
}

function createSeamPoints(samples) {
  const points = [];
  const a = 0.699;
  const b = 0.301;
  const yScale = 2 * Math.sqrt(a * b);

  for (let index = 0; index < samples; index += 1) {
    const t = (index / samples) * Math.PI * 2;
    points.push([
      a * Math.sin(t) + b * Math.sin(3 * t),
      yScale * Math.cos(2 * t),
      a * Math.cos(t) - b * Math.cos(3 * t),
    ]);
  }

  return points;
}

function findSilhouetteCrossings(rotated) {
  const crossings = [];

  for (let index = 0; index < rotated.length; index += 1) {
    const nextIndex = (index + 1) % rotated.length;
    const z0 = rotated[index][2];
    const z1 = rotated[nextIndex][2];

    if (z0 * z1 < 0) {
      const fraction = -z0 / (z1 - z0);
      const x = rotated[index][0] + fraction * (rotated[nextIndex][0] - rotated[index][0]);
      const y = rotated[index][1] + fraction * (rotated[nextIndex][1] - rotated[index][1]);
      const length = Math.hypot(x, y) || 1;
      crossings.push({ index, point: [x / length, y / length] });
    }
  }

  return crossings;
}

function closePolygonsFromEdges(edges, nodeCount) {
  const adjacency = Array.from({ length: nodeCount }, () => []);

  edges.forEach((edge, index) => {
    adjacency[edge.a].push(index);
    adjacency[edge.b].push(index);
  });

  const polygons = [];
  const used = new Set();

  for (let firstEdge = 0; firstEdge < edges.length; firstEdge += 1) {
    if (used.has(firstEdge)) {
      continue;
    }

    const startNode = edges[firstEdge].a;
    let currentNode = startNode;
    let edgeIndex = firstEdge;
    const vertices = [];

    while (!used.has(edgeIndex)) {
      used.add(edgeIndex);
      const edge = edges[edgeIndex];
      const forward = currentNode === edge.a;
      const part = forward ? edge.points : [...edge.points].reverse();
      const nextNode = forward ? edge.b : edge.a;

      vertices.push(...(vertices.length === 0 ? part : part.slice(1)));

      if (nextNode === startNode) {
        break;
      }

      const nextEdge = adjacency[nextNode].find((candidate) => !used.has(candidate));

      if (nextEdge === undefined) {
        break;
      }

      currentNode = nextNode;
      edgeIndex = nextEdge;
    }

    if (vertices.length >= 3) {
      polygons.push(vertices);
    }
  }

  return polygons;
}

function circlePolygon(samples) {
  const points = [];

  for (let index = 0; index < samples; index += 1) {
    const theta = (index / samples) * Math.PI * 2;
    points.push([Math.cos(theta), Math.sin(theta)]);
  }

  return points;
}

function pointInPolygon(point, polygon) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const xi = polygon[index][0];
    const yi = polygon[index][1];
    const xj = polygon[previous][0];
    const yj = polygon[previous][1];
    const intersects = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function wrappedIndices(start, end, count) {
  const indices = [];
  let index = start % count;

  while (true) {
    indices.push(index);

    if (index === end) {
      break;
    }

    index = (index + 1) % count;
  }

  return indices;
}

function identityRotation() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

function rotationMatrix(rollDegrees = 0, pitchDegrees = 0, yawDegrees = 0) {
  const roll = degreesToRadians(rollDegrees);
  const pitch = degreesToRadians(pitchDegrees);
  const yaw = degreesToRadians(yawDegrees);
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

function multiplyMatrixVector(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function transpose(matrix) {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function interpolateZCrossing(a, b) {
  const fraction = a[2] / (a[2] - b[2]);

  return [
    a[0] + (b[0] - a[0]) * fraction,
    a[1] + (b[1] - a[1]) * fraction,
    0,
  ];
}

function stereographicProject(point) {
  const denominator = 1 + point[2];
  return [point[0] / denominator, point[1] / denominator];
}

function normalize3(point) {
  const length = Math.hypot(point[0], point[1], point[2]) || 1;
  return [point[0] / length, point[1] / length, point[2] / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function positiveAngle(angle) {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
