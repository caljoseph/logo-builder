import type { BorderLayer, ColorMode, CoverLayer, LatticeLayer, LogoState, PaintStyle } from "./types";
import { createLatticeGeometry } from "./icosphere";
import { eulerToMatrix, multiplyMatrices, multiplyMatrixVector, transpose, type Matrix3, type Vec3 } from "./rotation";

type Vec2 = [number, number];

type Edge = {
  a: number;
  b: number;
  points: Vec2[];
};

const SEAM_SAMPLES = 4000;
const CIRCLE_SAMPLES = 1000;
export const DEFAULT_EXPORT_PADDING = 0.14;
export const BACK_EDGE_ALPHA = 0.28;
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

  const layerCanvas = context.canvas.ownerDocument.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerContext = layerCanvas.getContext("2d");

  if (!layerContext) {
    return;
  }

  renderLogoLayers(layerContext, state, centerX, centerY, radius);
  context.drawImage(layerCanvas, 0, 0);
}

function renderLogoLayers(
  context: CanvasRenderingContext2D,
  state: LogoState,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const rotation = state.rotation;
  const coverPolygons = visibleCoverPolygons(rotation);

  drawLayerGroup(context, {
    paint: state.base,
    lattice: state.base.lattice,
    maskPolygons: [circlePolygon()],
    rotation,
    centerX,
    centerY,
    radius,
    drawFill: (target) => drawCirclePaint(target, centerX, centerY, radius, state.base),
  });

  drawLayerGroup(context, {
    paint: state.cover,
    lattice: state.cover.lattice,
    maskPolygons: coverPolygons,
    rotation,
    centerX,
    centerY,
    radius,
    drawFill: (target) => drawCover(target, state.cover, coverPolygons, centerX, centerY, radius),
  });

  if (state.border) {
    strokeBorder(context, state.border, centerX, centerY, radius);
  }
}

// The border rides on top of every other layer so the ball keeps a clean rim
// even where a cover reaches the silhouette.
function strokeBorder(
  context: CanvasRenderingContext2D,
  border: BorderLayer,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  if (border.colorMode === "normal" && border.alpha <= 0) {
    return;
  }

  context.save();
  applyPaint(context, border);
  context.lineWidth = scaledLineWidth(border.width, radius);
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

type LayerGroupOptions = {
  paint: PaintStyle;
  lattice?: LatticeLayer;
  maskPolygons: Vec2[][];
  rotation: Matrix3;
  centerX: number;
  centerY: number;
  radius: number;
  drawFill: (target: CanvasRenderingContext2D) => void;
};

// A layer is its fill plus the lattice drawn over it. When the lattice cuts the
// fill, the fill has to land on its own surface first: erasing on the shared
// canvas would punch through everything already painted underneath, instead of
// only through this layer.
function drawLayerGroup(context: CanvasRenderingContext2D, options: LayerGroupOptions): void {
  const { paint, lattice, maskPolygons, rotation, centerX, centerY, radius, drawFill } = options;
  // The mask keeps the logo's own rotation; only the mesh takes the offset, so
  // the lines can spin inside a cover that stays where it is.
  const latticeOptions = lattice
    ? { maskPolygons, lattice, rotation: latticeRotation(rotation, lattice), centerX, centerY, radius }
    : null;
  const shouldCut = Boolean(lattice?.cutFill) && paint.colorMode === "normal" && paint.alpha > 0;

  if (!shouldCut || !latticeOptions) {
    drawFill(context);

    if (latticeOptions) {
      drawLatticeLayer(context, latticeOptions);
    }

    return;
  }

  const scratch = createScratchContext(context);

  if (!scratch) {
    drawFill(context);
    drawLatticeLayer(context, latticeOptions);
    return;
  }

  drawFill(scratch);
  drawLatticeLayer(scratch, { ...latticeOptions, cut: true });
  context.drawImage(scratch.canvas, 0, 0);
  drawLatticeLayer(context, latticeOptions);
}

export function latticeRotation(rotation: Matrix3, lattice: LatticeLayer): Matrix3 {
  const { roll, pitch, yaw } = lattice.offset;

  if (roll === 0 && pitch === 0 && yaw === 0) {
    return rotation;
  }

  return multiplyMatrices(rotation, eulerToMatrix(roll, pitch, yaw));
}

function createScratchContext(context: CanvasRenderingContext2D): CanvasRenderingContext2D | null {
  const scratch = context.canvas.ownerDocument.createElement("canvas");
  scratch.width = context.canvas.width;
  scratch.height = context.canvas.height;
  return scratch.getContext("2d");
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
  polygons: Vec2[][],
  centerX: number,
  centerY: number,
  radius: number,
): void {
  if (cover.colorMode === "normal" && cover.alpha <= 0) {
    return;
  }

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
  rotation: Matrix3;
  centerX: number;
  centerY: number;
  radius: number;
  // Draw the same geometry as an eraser instead of as paint.
  cut?: boolean;
};

function drawLatticeLayer(
  context: CanvasRenderingContext2D,
  { maskPolygons, lattice, rotation, centerX, centerY, radius, cut = false }: LatticeDrawOptions,
): void {
  if ((!cut && lattice.colorMode === "normal" && lattice.alpha <= 0) || maskPolygons.length === 0) {
    return;
  }

  const geometry = createLatticeGeometry(lattice.frequency);
  const strokeWidth = scaledLineWidth(lattice.lineWidth, radius);
  // Dashes belong to the mesh lines only; the outline and the dots stay solid.
  const applyLatticePaint = (target: CanvasRenderingContext2D, dashed = false) => {
    if (cut) {
      applyPaint(target, { colorMode: "knockout", color: "#000000", alpha: 1 });
    } else {
      applyPaint(target, lattice);
    }

    target.setLineDash(dashed && lattice.dashLength > 0 ? [scaledLineWidth(lattice.dashLength, radius)] : []);
  };

  const edgePoints = geometry.polylines.map((points) =>
    points.map((point) => multiplyMatrixVector(rotation, point)),
  );

  // Edges that curve around the far side of the sphere, drawn faintly so the
  // lattice reads as a globe rather than a flat disc. See-through widens their
  // clip from the lattice's own mask to the whole ball, so the far side shows
  // across the part of the sphere no lattice covers.
  if (lattice.backEdges !== "off") {
    context.save();

    if (lattice.backEdges === "through") {
      // Circle and mask in one path, filled even-odd: the ball minus whatever
      // the lattice covers, leaving only the bare half.
      beginMaskPath(context, [circlePolygon(), ...maskPolygons], centerX, centerY, radius);
      context.clip("evenodd");
    } else {
      beginMaskPath(context, lattice.backEdges === "both" ? [circlePolygon()] : maskPolygons, centerX, centerY, radius);
      context.clip();
    }

    applyLatticePaint(context, true);
    context.lineWidth = strokeWidth;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (!cut) {
      context.globalAlpha = BACK_EDGE_ALPHA;
    }

    context.beginPath();

    for (const points of edgePoints) {
      appendVisiblePolyline(context, points, centerX, centerY, radius, -1);
    }

    context.stroke();
    context.restore();
  }

  context.save();
  beginMaskPath(context, maskPolygons, centerX, centerY, radius);
  context.clip();
  applyLatticePaint(context, true);
  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  // Every front-facing edge goes into one path and is stroked once. Stroking
  // each edge separately would composite the shared vertices five or six times
  // over, blooming them into dark knots at any alpha below 1.
  context.beginPath();

  for (const points of edgePoints) {
    appendVisiblePolyline(context, points, centerX, centerY, radius, 1);
  }

  context.stroke();
  context.restore();

  if (lattice.outline) {
    context.save();
    applyLatticePaint(context);
    context.lineWidth = scaledLineWidth(lattice.outlineWidth, radius);
    context.lineCap = "round";
    context.lineJoin = "round";
    beginMaskPath(context, maskPolygons, centerX, centerY, radius);
    context.stroke();
    context.restore();
  }

}

// Splits one edge into the runs that face the viewer (side 1) or face away
// (side -1), cutting exactly at the horizon. Shared by both renderers: the
// canvas one strokes the runs, the SVG one serializes them.
export function visibleRuns(points: Vec3[], side: 1 | -1): Vec3[][] {
  const isVisible = (point: Vec3) => point[2] * side >= 0;
  const runs: Vec3[][] = [];
  let current: Vec3[] | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];

    if (previous && previous[2] * point[2] < 0) {
      const crossing = interpolateZCrossing(previous, point);

      if (current) {
        current.push(crossing);
        runs.push(current);
        current = null;
      } else if (isVisible(point)) {
        current = [crossing];
      }
    }

    if (!isVisible(point)) {
      continue;
    }

    if (!current) {
      current = [point];
    } else {
      current.push(point);
    }
  }

  if (current && current.length > 1) {
    runs.push(current);
  }

  return runs;
}

function appendVisiblePolyline(
  context: CanvasRenderingContext2D,
  points: Vec3[],
  centerX: number,
  centerY: number,
  radius: number,
  side: 1 | -1,
): void {
  for (const run of visibleRuns(points, side)) {
    run.forEach((point, index) => {
      const [x, y] = toCanvas(point, centerX, centerY, radius);

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
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

export function toCanvas(point: Vec2 | Vec3, centerX: number, centerY: number, radius: number): Vec2 {
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

export function scaledLineWidth(lineWidth: number, radius: number): number {
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

export function circlePolygon(): Vec2[] {
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

export function colorWithAlpha(hex: string, alpha: number): string {
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

function positiveAngle(angle: number): number {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}
