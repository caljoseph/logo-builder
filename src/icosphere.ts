import type { Vec3 } from "./rotation";
import type { LatticeResolution } from "./types";

export type IcosphereMesh = {
  vertices: Vec3[];
  faces: [number, number, number][];
  edges: [number, number][];
};

const meshCache = new Map<LatticeResolution, IcosphereMesh>();

export function createIcosphere(faceCount: LatticeResolution): IcosphereMesh {
  const cached = meshCache.get(faceCount);

  if (cached) {
    return cached;
  }

  const subdivisions = {
    20: 0,
    80: 1,
    320: 2,
    1280: 3,
    5120: 4,
  }[faceCount];
  const phi = (1 + Math.sqrt(5)) / 2;
  const initialVertices: Vec3[] = [
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
  ];
  let faces: [number, number, number][] = [
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
  const vertices = initialVertices.map(normalize);

  for (let step = 0; step < subdivisions; step += 1) {
    const midpointCache = new Map<string, number>();
    const nextFaces: [number, number, number][] = [];

    for (const [a, b, c] of faces) {
      const ab = midpointIndex(vertices, midpointCache, a, b);
      const bc = midpointIndex(vertices, midpointCache, b, c);
      const ca = midpointIndex(vertices, midpointCache, c, a);
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }

    faces = nextFaces;
  }

  const mesh = { vertices, faces, edges: uniqueEdges(faces) };
  meshCache.set(faceCount, mesh);
  return mesh;
}

export function sampleGreatCircleEdge(start: Vec3, end: Vec3): Vec3[] {
  const dot = clamp(dot3(start, end), -1, 1);
  const angle = Math.acos(dot);

  if (angle < 1e-8) {
    return [start, end];
  }

  const samples = Math.max(2, Math.ceil(angle / 0.035));
  const sine = Math.sin(angle);
  const points: Vec3[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const a = Math.sin((1 - t) * angle) / sine;
    const b = Math.sin(t * angle) / sine;
    points.push(normalize([
      start[0] * a + end[0] * b,
      start[1] * a + end[1] * b,
      start[2] * a + end[2] * b,
    ]));
  }

  return points;
}

function midpointIndex(vertices: Vec3[], cache: Map<string, number>, a: number, b: number): number {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const index = vertices.length;
  vertices.push(normalize([
    (vertices[a][0] + vertices[b][0]) / 2,
    (vertices[a][1] + vertices[b][1]) / 2,
    (vertices[a][2] + vertices[b][2]) / 2,
  ]));
  cache.set(key, index);
  return index;
}

function uniqueEdges(faces: [number, number, number][]): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];

  for (const [a, b, c] of faces) {
    for (const [start, end] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;

      if (!seen.has(key)) {
        seen.add(key);
        edges.push(start < end ? [start, end] : [end, start]);
      }
    }
  }

  return edges;
}

function normalize(point: Vec3): Vec3 {
  const length = Math.hypot(point[0], point[1], point[2]) || 1;
  return [point[0] / length, point[1] / length, point[2] / length];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
