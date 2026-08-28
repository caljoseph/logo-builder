import type { BorderLayer, LatticeLayer, LogoState, PaintStyle } from "./types";
import { createLatticeGeometry } from "./icosphere";
import { multiplyMatrixVector, type Matrix3, type Vec3 } from "./rotation";
import {
  BACK_EDGE_ALPHA,
  DEFAULT_EXPORT_PADDING,
  EXPORT_SIZE,
  circlePolygon,
  latticeRotation,
  scaledLineWidth,
  visibleCoverPolygons,
  visibleRuns,
} from "./logoRenderer";

type Vec2 = [number, number];

type Geometry = {
  center: number;
  radius: number;
};

// Canvas composites with destination-out; SVG has no eraser, so every knockout
// becomes a luminance mask where black subtracts. Masks are collected here and
// emitted into a single <defs> block.
class Defs {
  private entries: string[] = [];
  private nextId = 0;

  add(build: (id: string) => string): string {
    const id = `d${this.nextId}`;
    this.nextId += 1;
    this.entries.push(build(id));
    return id;
  }

  render(): string {
    return this.entries.length > 0 ? `<defs>${this.entries.join("")}</defs>` : "";
  }
}

// Layers accumulate in draw order. A knockout layer paints nothing; it masks
// away everything already beneath it, which is what destination-out does on the
// canvas. Wrapping is destructive, so the stack owns its own contents rather
// than handing the array out to callers.
class Stack {
  private items: string[] = [];

  constructor(
    private readonly defs: Defs,
    private readonly size: number,
  ) {}

  push(markup: string): void {
    this.items.push(markup);
  }

  erase(shape: string): void {
    if (this.items.length === 0) {
      return;
    }

    const maskId = this.defs.add(
      (id) =>
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${this.size}" height="${this.size}">` +
        `<rect x="0" y="0" width="${this.size}" height="${this.size}" fill="#ffffff"/>${shape}</mask>`,
    );
    this.items = [`<g mask="url(#${maskId})">${this.items.join("")}</g>`];
  }

  render(): string {
    return this.items.join("");
  }
}

export function exportLogoSvg(state: LogoState): string {
  const size = EXPORT_SIZE;
  const geometry: Geometry = {
    center: size / 2,
    radius: (size * (1 - DEFAULT_EXPORT_PADDING * 2)) / 2,
  };
  const defs = new Defs();
  const rotation = state.rotation;
  const coverPolygons = visibleCoverPolygons(rotation);

  const stack = new Stack(defs, size);

  appendLayer(stack, defs, geometry, size, {
    paint: state.base,
    lattice: state.base.lattice,
    maskPolygons: [circlePolygon()],
    rotation,
    fillShape: (attributes) =>
      `<circle cx="${geometry.center}" cy="${geometry.center}" r="${round(geometry.radius)}" ${attributes}/>`,
  });

  appendLayer(stack, defs, geometry, size, {
    paint: state.cover,
    lattice: state.cover.lattice,
    maskPolygons: coverPolygons,
    rotation,
    fillShape: (attributes) => `<path d="${polygonPath(coverPolygons, geometry)}" ${attributes}/>`,
  });

  if (state.border) {
    appendBorder(stack, state.border, geometry);
  }

  const background =
    state.background.colorMode === "normal" && state.background.alpha > 0
      ? `<rect x="0" y="0" width="${size}" height="${size}" ` +
        `fill="${state.background.color}" fill-opacity="${round(state.background.alpha)}"/>`
      : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `${defs.render()}${background}${stack.render()}</svg>`
  );
}

type LayerOptions = {
  paint: PaintStyle;
  lattice?: LatticeLayer;
  maskPolygons: Vec2[][];
  rotation: Matrix3;
  fillShape: (attributes: string) => string;
};

function appendLayer(
  stack: Stack,
  defs: Defs,
  geometry: Geometry,
  size: number,
  options: LayerOptions,
): void {
  const { paint, lattice, maskPolygons, rotation, fillShape } = options;
  const meshRotation = lattice ? latticeRotation(rotation, lattice) : rotation;

  if (paint.colorMode === "knockout") {
    stack.erase(fillShape('fill="#000000"'));
  } else if (paint.alpha > 0) {
    let fill = fillShape(`fill="${paint.color}" fill-opacity="${round(paint.alpha)}"`);

    // Cut fill: the lattice subtracts from this layer's own fill only, so the
    // mask is scoped to the fill element rather than to the whole stack.
    if (lattice?.cutFill) {
      const cutShape = latticeShapes(lattice, meshRotation, maskPolygons, geometry, defs, "#000000", true);
      const maskId = defs.add(
        (id) =>
          `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}">` +
          `<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>${cutShape}</mask>`,
      );
      fill = `<g mask="url(#${maskId})">${fill}</g>`;
    }

    stack.push(fill);
  }

  if (!lattice) {
    return;
  }

  if (lattice.colorMode === "knockout") {
    stack.erase(latticeShapes(lattice, meshRotation, maskPolygons, geometry, defs, "#000000", true));
    return;
  }

  if (lattice.alpha > 0) {
    stack.push(latticeShapes(lattice, meshRotation, maskPolygons, geometry, defs, lattice.color, false));
  }
}

function appendBorder(
  stack: Stack,
  border: BorderLayer,
  geometry: Geometry,
): void {
  const circle = (attributes: string) =>
    `<circle cx="${geometry.center}" cy="${geometry.center}" r="${round(geometry.radius)}" fill="none" ` +
    `stroke-width="${round(scaledLineWidth(border.width, geometry.radius))}" ${attributes}/>`;

  if (border.colorMode === "knockout") {
    stack.erase(circle('stroke="#000000"'));
    return;
  }

  if (border.alpha > 0) {
    stack.push(circle(`stroke="${border.color}" stroke-opacity="${round(border.alpha)}"`));
  }
}

// The lattice as one group: back edges, front edges, and the outline, each
// clipped the same way the canvas clips them. `solid` drops the alpha and the
// back-edge fade, which is what the knockout and cut passes need.
function latticeShapes(
  lattice: LatticeLayer,
  rotation: Matrix3,
  maskPolygons: Vec2[][],
  geometry: Geometry,
  defs: Defs,
  color: string,
  solid: boolean,
): string {
  const mesh = createLatticeGeometry(lattice.frequency);
  const edgePoints = mesh.polylines.map((points) => points.map((point) => multiplyMatrixVector(rotation, point)));
  const strokeWidth = round(scaledLineWidth(lattice.lineWidth, geometry.radius));
  const opacity = solid ? 1 : lattice.alpha;
  const dash =
    lattice.dashLength > 0
      ? ` stroke-dasharray="${round(scaledLineWidth(lattice.dashLength, geometry.radius))}"`
      : "";
  const maskClipId = clipId(defs, maskPolygons, geometry, false);
  const parts: string[] = [];

  if (lattice.backEdges !== "off") {
    const backClip =
      lattice.backEdges === "both"
        ? clipId(defs, [circlePolygon()], geometry, false)
        : lattice.backEdges === "through"
          ? clipId(defs, [circlePolygon(), ...maskPolygons], geometry, true)
          : maskClipId;
    const backOpacity = solid ? 1 : lattice.alpha * BACK_EDGE_ALPHA;
    const path = runsPath(edgePoints, -1, geometry);

    if (path) {
      parts.push(
        `<g clip-path="url(#${backClip})"><path d="${path}" fill="none" stroke="${color}" ` +
          `stroke-opacity="${round(backOpacity)}" stroke-width="${strokeWidth}" ` +
          `stroke-linecap="round" stroke-linejoin="round"${dash}/></g>`,
      );
    }
  }

  const frontPath = runsPath(edgePoints, 1, geometry);

  if (frontPath) {
    parts.push(
      `<g clip-path="url(#${maskClipId})"><path d="${frontPath}" fill="none" stroke="${color}" ` +
        `stroke-opacity="${round(opacity)}" stroke-width="${strokeWidth}" ` +
        `stroke-linecap="round" stroke-linejoin="round"${dash}/></g>`,
    );
  }

  if (lattice.outline) {
    parts.push(
      `<path d="${polygonPath(maskPolygons, geometry)}" fill="none" stroke="${color}" ` +
        `stroke-opacity="${round(opacity)}" ` +
        `stroke-width="${round(scaledLineWidth(lattice.outlineWidth, geometry.radius))}" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  return parts.join("");
}

function clipId(defs: Defs, polygons: Vec2[][], geometry: Geometry, evenOdd: boolean): string {
  const d = polygonPath(polygons, geometry);
  const rule = evenOdd ? ' clip-rule="evenodd"' : "";
  return defs.add((id) => `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${d}"${rule}/></clipPath>`);
}

function runsPath(edgePoints: Vec3[][], side: 1 | -1, geometry: Geometry): string {
  const commands: string[] = [];

  for (const points of edgePoints) {
    for (const run of visibleRuns(points, side)) {
      commands.push(runPath(run, geometry));
    }
  }

  return commands.join(" ");
}

function runPath(run: Vec3[], geometry: Geometry): string {
  return run
    .map((point, index) => {
      const [x, y] = project([point[0], point[1]], geometry);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

function polygonPath(polygons: Vec2[][], geometry: Geometry): string {
  return polygons
    .filter((polygon) => polygon.length >= 3)
    .map(
      (polygon) =>
        polygon
          .map((point, index) => {
            const [x, y] = project(point, geometry);
            return `${index === 0 ? "M" : "L"}${x} ${y}`;
          })
          .join(" ") + " Z",
    )
    .join(" ");
}

function project(point: Vec2, geometry: Geometry): [string, string] {
  return [
    round(geometry.center + point[0] * geometry.radius).toString(),
    round(geometry.center - point[1] * geometry.radius).toString(),
  ];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
