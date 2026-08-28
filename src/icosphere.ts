import type { Vec3 } from "./rotation";

export type IcosphereMesh = {
  vertices: Vec3[];
  faces: [number, number, number][];
  edges: [number, number][];
};

// A lattice reduced to what the renderer actually needs: curves to stroke, and
// the points where they meet.
export type LatticeGeometry = {
  polylines: Vec3[][];
  vertices: Vec3[];
};

export const MIN_FREQUENCY = 1;
export const MAX_FREQUENCY = 16;

const meshCache = new Map<number, IcosphereMesh>();
const geometryCache = new Map<number, LatticeGeometry>();
const PHI = (1 + Math.sqrt(5)) / 2;

const BASE_VERTICES: Vec3[] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];

const BASE_FACES: [number, number, number][] = [
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

export function clampFrequency(value: number): number {
  return Math.min(MAX_FREQUENCY, Math.max(MIN_FREQUENCY, Math.round(value)));
}

export function faceCountForFrequency(frequency: number): number {
  return 20 * clampFrequency(frequency) ** 2;
}

// A class-I geodesic polyhedron at the given frequency: every icosahedron edge
// is cut into `frequency` parts and the resulting triangular grid is projected
// onto the sphere. Recursive 4-way subdivision only reaches frequencies that are
// powers of two; this reaches every whole frequency, so face counts step
// 20, 80, 180, 320, 500, ... instead of 20, 80, 320, 1280.
export function createIcosphere(frequency: number): IcosphereMesh {
  const steps = clampFrequency(frequency);
  const cached = meshCache.get(steps);

  if (cached) {
    return cached;
  }

  const corners = BASE_VERTICES.map(normalize);
  const vertices: Vec3[] = [];
  const indexByKey = new Map<string, number>();
  const faces: [number, number, number][] = [];

  const vertexIndex = (point: Vec3): number => {
    const unit = normalize(point);
    const key = `${unit[0].toFixed(6)}:${unit[1].toFixed(6)}:${unit[2].toFixed(6)}`;
    const existing = indexByKey.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const index = vertices.length;
    vertices.push(unit);
    indexByKey.set(key, index);
    return index;
  };

  for (const [a, b, c] of BASE_FACES) {
    const cornerA = corners[a];
    const cornerB = corners[b];
    const cornerC = corners[c];
    // rows[i][j] is the grid point i steps toward B and j steps toward C.
    const rows: number[][] = [];

    for (let i = 0; i <= steps; i += 1) {
      const row: number[] = [];

      for (let j = 0; j <= steps - i; j += 1) {
        const weightA = steps - i - j;
        row.push(
          vertexIndex([
            (cornerA[0] * weightA + cornerB[0] * i + cornerC[0] * j) / steps,
            (cornerA[1] * weightA + cornerB[1] * i + cornerC[1] * j) / steps,
            (cornerA[2] * weightA + cornerB[2] * i + cornerC[2] * j) / steps,
          ]),
        );
      }

      rows.push(row);
    }

    for (let i = 0; i < steps; i += 1) {
      for (let j = 0; j < steps - i; j += 1) {
        faces.push([rows[i][j], rows[i + 1][j], rows[i][j + 1]]);

        if (j < steps - i - 1) {
          faces.push([rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]]);
        }
      }
    }
  }

  const mesh: IcosphereMesh = { vertices, faces, edges: uniqueEdges(faces) };
  meshCache.set(steps, mesh);
  return mesh;
}

export function createLatticeGeometry(frequency: number): LatticeGeometry {
  const steps = clampFrequency(frequency);
  const cached = geometryCache.get(steps);

  if (cached) {
    return cached;
  }

  const mesh = createIcosphere(steps);
  const geometry: LatticeGeometry = {
    polylines: mesh.edges.map(([a, b]) => sampleGreatCircleEdge(mesh.vertices[a], mesh.vertices[b])),
    vertices: mesh.vertices,
  };
  geometryCache.set(steps, geometry);
  return geometry;
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
