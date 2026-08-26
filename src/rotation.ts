export type Vec3 = [number, number, number];
export type Matrix3 = [Vec3, Vec3, Vec3];

export type ScreenAxisRotation = {
  xDegrees?: number;
  yDegrees?: number;
  zDegrees?: number;
};

export function identityRotation(): Matrix3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

export function screenAxisRotation({
  xDegrees = 0,
  yDegrees = 0,
  zDegrees = 0,
}: ScreenAxisRotation): Matrix3 {
  const angleDegrees = Math.hypot(xDegrees, yDegrees, zDegrees);

  if (angleDegrees === 0) {
    return identityRotation();
  }

  const axis: Vec3 = [xDegrees / angleDegrees, yDegrees / angleDegrees, zDegrees / angleDegrees];
  const angle = degreesToRadians(angleDegrees);
  const [x, y, z] = axis;
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

export function legacyEulerToMatrix(rollDeg = 0, pitchDeg = 0, yawDeg = 0): Matrix3 {
  const roll = degreesToRadians(rollDeg);
  const pitch = degreesToRadians(pitchDeg);
  const yaw = degreesToRadians(yawDeg);
  const rz: Matrix3 = [
    [Math.cos(yaw), -Math.sin(yaw), 0],
    [Math.sin(yaw), Math.cos(yaw), 0],
    [0, 0, 1],
  ];
  const ry: Matrix3 = [
    [Math.cos(pitch), 0, Math.sin(pitch)],
    [0, 1, 0],
    [-Math.sin(pitch), 0, Math.cos(pitch)],
  ];
  const rx: Matrix3 = [
    [1, 0, 0],
    [0, Math.cos(roll), -Math.sin(roll)],
    [0, Math.sin(roll), Math.cos(roll)],
  ];

  return multiplyMatrices(multiplyMatrices(rz, ry), rx);
}

export function multiplyMatrices(a: Matrix3, b: Matrix3): Matrix3 {
  return a.map((row) =>
    b[0].map((_, column) => row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column]),
  ) as Matrix3;
}

export function multiplyMatrixVector(matrix: Matrix3, vector: Vec3): Vec3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

export function transpose(matrix: Matrix3): Matrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

export function normalizeRotation(matrix: Matrix3): Matrix3 {
  const x = normalize(column(matrix, 0), [1, 0, 0]);
  const yRaw = column(matrix, 1);
  const y = normalize(subtract(yRaw, scale(x, dot(yRaw, x))), perpendicularTo(x));
  const z = cross(x, y);

  return [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
}

function column(matrix: Matrix3, index: number): Vec3 {
  return [matrix[0][index], matrix[1][index], matrix[2][index]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function perpendicularTo(vector: Vec3): Vec3 {
  return Math.abs(vector[0]) < 0.9 ? normalize(cross(vector, [1, 0, 0]), [0, 1, 0]) : normalize(cross(vector, [0, 1, 0]), [0, 0, 1]);
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);

  if (length === 0) {
    return fallback;
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
