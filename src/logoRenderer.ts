import type { ColorMode, CoverLayer, LatticeLayer, LogoState, PaintStyle, StackItem } from "./types";
import { createIcosphere, sampleGreatCircleEdge } from "./icosphere";
import { multiplyMatrixVector, transpose, type Matrix3, type Vec3 } from "./rotation";

type Vec2 = [number, number];

type Edge = {
  a: number;
  b: number;
  points: Vec2[];
};

const SEAM_SAMPLES = 4000;
const CIRCLE_SAMPLES = 1000;
const DEFAULT_EXPORT_PADDING = 0.14;
const seamPoints = createSeamPoints(SEAM_SAMPLES);
const seamProjection = seamPoints.map(stereographicProject);

export const EXPORT_SIZE = 1024;

export function renderLogoToCanvas(
  canvas: HTMLCanvasElement,
  state: LogoState,
  options: { transparent?: boolean; omitBackground?: boolean; padding?: number; deviceScale?: number } = {},
): void {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  renderLogo(context, state, width, height, options);
}

export function renderLogo(
  context: CanvasRenderingContext2D,
  state: LogoState,
  width: number,
  height: number,
  options: { transparent?: boolean; omitBackground?: boolean; padding?: number } = {},
): void {
  const padding = options.padding ?? DEFAULT_EXPORT_PADDING;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = (Math.min(width, height) * (1 - padding * 2)) / 2;

  context.clearRect(0, 0, width, height);

  if (!options.omitBackground && !options.transparent) {
    drawRectPaint(context, 0, 0, width, height, state.background);
  }

  drawCirclePaint(context, centerX, centerY, radius, state.base);

  if (state.base.lattice) {
    drawLatticeLayer(context, {
      maskPolygons: [circlePolygon()],
      lattice: state.base.lattice,
      centerX,
      centerY,
      radius,
    });
  }

  for (const item of state.stack) {
    const cover = findCover(state, item);

    if (!cover) {
      continue;
    }

    if (item.kind === "cover") {
      drawCover(context, cover, centerX, centerY, radius);
    }

    if (item.kind === "coverLattice" && cover.lattice) {
      const polygons = visibleCoverPolygons(cover.rotation);
      drawLatticeLayer(context, {
        maskPolygons: polygons,
        lattice: cover.lattice,
        centerX,
        centerY,
        radius,
      });
    }
  }
}

export async function exportLogoPng(state: LogoState): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_SIZE;
  canvas.height = EXPORT_SIZE;
  renderLogoToCanvas(canvas, state);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

  if (!blob) {
    throw new Error("Unable to export logo PNG.");
  }

  return blob;
}

function createSeamPoints(samples: number): Vec3[] {
  const points: Vec3[] = [];
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

function drawCover(
  context: CanvasRenderingContext2D,
  cover: CoverLayer,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  if (cover.colorMode === "normal" && cover.alpha <= 0) {
    return;
  }

  const rotation = cover.rotation;
  const polygons = visibleCoverPolygons(rotation);

  context.save();
  applyPaint(context, cover);

  for (const polygon of polygons) {
    if (polygon.length < 3) {
      continue;
    }

    context.beginPath();
    context.moveTo(centerX + polygon[0][0] * radius, centerY - polygon[0][1] * radius);

    for (let index = 1; index < polygon.length; index += 1) {
      context.lineTo(centerX + polygon[index][0] * radius, centerY - polygon[index][1] * radius);
    }

    context.closePath();
    context.fill();
  }

  context.restore();
}

export function visibleCoverPolygons(rotation: Matrix3): Vec2[][] {
  const rotated = seamPoints.map((point) => multiplyMatrixVector(rotation, point));
  return buildVisibleCoverPolygons(rotated, rotation);
}

type LatticeDrawOptions = {
  maskPolygons: Vec2[][];
  lattice: LatticeLayer;
  centerX: number;
  centerY: number;
  radius: number;
};

function drawLatticeLayer(
  context: CanvasRenderingContext2D,
  { maskPolygons, lattice, centerX, centerY, radius }: LatticeDrawOptions,
): void {
  if ((lattice.colorMode === "normal" && lattice.alpha <= 0) || maskPolygons.length === 0) {
    return;
  }

  const mesh = createIcosphere(lattice.resolution);
  const strokeWidth = scaledLineWidth(lattice.lineWidth, radius);

  context.save();
  beginMaskPath(context, maskPolygons, centerX, centerY, radius);
  context.clip();
  applyPaint(context, lattice);
  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const [startIndex, endIndex] of mesh.edges) {
    const points = sampleGreatCircleEdge(mesh.vertices[startIndex], mesh.vertices[endIndex]).map((point) =>
      multiplyMatrixVector(lattice.rotation, point),
    );
    drawFrontPolyline(context, points, centerX, centerY, radius);
  }

  context.restore();

  context.save();
  applyPaint(context, lattice);
  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  beginMaskPath(context, maskPolygons, centerX, centerY, radius);
  context.stroke();
  context.restore();

  if (lattice.showIntersections) {
    const dotRadius = scaledLineWidth(lattice.dotSize, radius) / 2;

    context.save();
    applyPaint(context, lattice);

    for (const vertex of mesh.vertices) {
      const rotated = multiplyMatrixVector(lattice.rotation, vertex);

      if (rotated[2] < 0 || !pointInAnyPolygon([rotated[0], rotated[1]], maskPolygons)) {
        continue;
      }

      const [x, y] = toCanvas(rotated, centerX, centerY, radius);
      context.beginPath();
      context.arc(x, y, dotRadius, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }
}

function drawFrontPolyline(
  context: CanvasRenderingContext2D,
  points: Vec3[],
  centerX: number,
  centerY: number,
  radius: number,
): void {
  let drawing = false;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];

    if (previous && previous[2] * current[2] < 0) {
      const crossing = interpolateZCrossing(previous, current);
      const [x, y] = toCanvas(crossing, centerX, centerY, radius);

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

    const [x, y] = toCanvas(current, centerX, centerY, radius);

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

function beginMaskPath(
  context: CanvasRenderingContext2D,
  polygons: Vec2[][],
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.beginPath();

  for (const polygon of polygons) {
    if (polygon.length < 3) {
      continue;
    }

    const [startX, startY] = toCanvas(polygon[0], centerX, centerY, radius);
    context.moveTo(startX, startY);

    for (let index = 1; index < polygon.length; index += 1) {
      const [x, y] = toCanvas(polygon[index], centerX, centerY, radius);
      context.lineTo(x, y);
    }

    context.closePath();
  }
}

function toCanvas(point: Vec2 | Vec3, centerX: number, centerY: number, radius: number): Vec2 {
  return [centerX + point[0] * radius, centerY - point[1] * radius];
}

function interpolateZCrossing(a: Vec3, b: Vec3): Vec3 {
  const fraction = a[2] / (a[2] - b[2]);

  return [
    a[0] + (b[0] - a[0]) * fraction,
    a[1] + (b[1] - a[1]) * fraction,
    0,
  ];
}

function scaledLineWidth(lineWidth: number, radius: number): number {
  return Math.max(0.75, lineWidth * (radius / 340));
}

function buildVisibleCoverPolygons(rotated: Vec3[], rotation: Matrix3): Vec2[][] {
  const crossings = findSilhouetteCrossings(rotated);

  if (crossings.length === 0) {
    return isInCover([0, 0, 1], rotation) ? [circlePolygon()] : [];
  }

  const edges: Edge[] = [];
  const pointCount = rotated.length;

  // Front-facing seam arcs become part of the visible leather boundary.
  for (let index = 0; index < crossings.length; index += 1) {
    const current = crossings[index];
    const next = crossings[(index + 1) % crossings.length];
    const seamIndices = wrappedIndices(current.index + 1, next.index, pointCount);
    const meanZ =
      seamIndices.reduce((total, seamIndex) => total + rotated[seamIndex][2], 0) / seamIndices.length;

    if (meanZ > 0) {
      edges.push({
        a: index,
        b: (index + 1) % crossings.length,
        points: [
          current.point,
          ...seamIndices.map((seamIndex) => [rotated[seamIndex][0], rotated[seamIndex][1]] as Vec2),
          next.point,
        ],
      });
    }
  }

  // Where the filled piece reaches the sphere silhouette, the circle edge closes the polygon.
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
    const testPoint: Vec3 = [rho * Math.cos(thetaMid), rho * Math.sin(thetaMid), epsilon];

    if (isInCover(testPoint, rotation)) {
      const arcPoints = Math.max(3, Math.floor((CIRCLE_SAMPLES * delta) / (Math.PI * 2)) + 2);
      const points: Vec2[] = [];

      for (let sample = 0; sample < arcPoints; sample += 1) {
        const theta = theta0 + (delta * sample) / (arcPoints - 1);
        points.push([Math.cos(theta), Math.sin(theta)]);
      }

      edges.push({ a, b, points });
    }
  }

  return closePolygonsFromEdges(edges, crossings.length);
}

function findSilhouetteCrossings(rotated: Vec3[]): { index: number; point: Vec2 }[] {
  const crossings: { index: number; point: Vec2 }[] = [];

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

function closePolygonsFromEdges(edges: Edge[], nodeCount: number): Vec2[][] {
  const adjacency = Array.from({ length: nodeCount }, () => [] as number[]);

  edges.forEach((edge, index) => {
    adjacency[edge.a].push(index);
    adjacency[edge.b].push(index);
  });

  const polygons: Vec2[][] = [];
  const used = new Set<number>();

  for (let firstEdge = 0; firstEdge < edges.length; firstEdge += 1) {
    if (used.has(firstEdge)) {
      continue;
    }

    const startNode = edges[firstEdge].a;
    let currentNode = startNode;
    let edgeIndex = firstEdge;
    const vertices: Vec2[] = [];

    while (!used.has(edgeIndex)) {
      used.add(edgeIndex);
      const edge = edges[edgeIndex];
      const forward = currentNode === edge.a;
      const part = forward ? edge.points : [...edge.points].reverse();
      const nextNode = forward ? edge.b : edge.a;

      if (vertices.length === 0) {
        vertices.push(...part);
      } else {
        vertices.push(...part.slice(1));
      }

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

function isInCover(rotatedPoint: Vec3, rotation: Matrix3): boolean {
  const unrotated = multiplyMatrixVector(transpose(rotation), rotatedPoint);

  return pointInPolygon(stereographicProject(unrotated), seamProjection);
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
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

function pointInAnyPolygon(point: Vec2, polygons: Vec2[][]): boolean {
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function circlePolygon(): Vec2[] {
  const points: Vec2[] = [];

  for (let index = 0; index < CIRCLE_SAMPLES; index += 1) {
    const theta = (index / CIRCLE_SAMPLES) * Math.PI * 2;
    points.push([Math.cos(theta), Math.sin(theta)]);
  }

  return points;
}

function drawRectPaint(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: PaintStyle,
): void {
  if (paint.colorMode === "normal" && paint.alpha <= 0) {
    return;
  }

  context.save();
  applyPaint(context, paint);
  context.fillRect(x, y, width, height);
  context.restore();
}

function drawCirclePaint(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  paint: PaintStyle,
): void {
  if (paint.colorMode === "normal" && paint.alpha <= 0) {
    return;
  }

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  applyPaint(context, paint);
  context.fill();
  context.restore();
}

function stereographicProject(point: Vec3): Vec2 {
  const denominator = 1 + point[2];
  return [point[0] / denominator, point[1] / denominator];
}

function wrappedIndices(start: number, end: number, count: number): number[] {
  const indices: number[] = [];
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

function colorWithAlpha(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, alpha))})`;
}

function applyPaint(context: CanvasRenderingContext2D, paint: PaintStyle | { colorMode: ColorMode; color: string; alpha: number }): void {
  if (paint.colorMode === "knockout") {
    context.globalCompositeOperation = "destination-out";
    context.globalAlpha = 1;
    context.fillStyle = "#000000";
    context.strokeStyle = "#000000";
    return;
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.fillStyle = colorWithAlpha(paint.color, paint.alpha);
  context.strokeStyle = colorWithAlpha(paint.color, paint.alpha);
}

function findCover(state: LogoState, item: StackItem): CoverLayer | undefined {
  return state.covers.find((cover) => cover.id === item.id);
}

function positiveAngle(angle: number): number {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}
