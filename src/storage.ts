import type {
  BackEdgeMode,
  BackgroundLayer,
  BorderLayer,
  ColorMode,
  CoverLayer,
  LatticeLayer,
  LatticeOffset,
  LatticeResolution,
  LogoState,
  SphereLayer,
} from "./types";
import { identityRotation, legacyEulerToMatrix, normalizeRotation, type Matrix3 } from "./rotation";
import { clampFrequency } from "./icosphere";

const STORAGE_KEY = "logoBuilder.state.v1";
const DEFAULT_LINE_WIDTH = 3;
const DEFAULT_BORDER_WIDTH = 6;
export const BORDER_WIDTH_MIN = 1;
export const BORDER_WIDTH_MAX = 24;
const DEFAULT_FREQUENCY = 4;
export const DASH_LENGTH_MAX = 24;

export function createBackground(overrides: Partial<BackgroundLayer> = {}): BackgroundLayer {
  return normalizePaint({ color: "#ffffff", alpha: 1, colorMode: "normal", ...overrides }, "#ffffff");
}

export function createLattice(overrides: Partial<LatticeLayer> = {}): LatticeLayer {
  const base = normalizePaint({ color: "#000000", alpha: 1, colorMode: "normal", ...overrides }, "#000000");

  return {
    ...base,
    frequency: normalizeFrequency(
      overrides.frequency ?? frequencyFromFaceCount((overrides as { resolution?: unknown }).resolution),
    ),
    lineWidth: normalizeLineWidth(overrides.lineWidth),
    cutFill: overrides.cutFill !== false,
    outline: overrides.outline !== false,
    outlineWidth: normalizeBorderWidth(overrides.outlineWidth, DEFAULT_LINE_WIDTH),
    backEdges: normalizeBackEdges(overrides),
    dashLength: normalizeDashLength(overrides.dashLength),
    offset: normalizeOffset(overrides.offset),
  };
}

export function createBorder(overrides: Partial<BorderLayer> = {}): BorderLayer {
  const paint = normalizePaint({ color: "#000000", alpha: 1, colorMode: "normal", ...overrides }, "#000000");

  return {
    ...paint,
    width: normalizeBorderWidth(overrides.width),
  };
}

export function createCover(overrides: Partial<CoverLayer> = {}): CoverLayer {
  const paint = normalizePaint({ color: "#000000", alpha: 1, colorMode: "normal", ...overrides }, "#000000");

  return {
    ...paint,
    lattice: overrides.lattice ? createLattice(overrides.lattice) : undefined,
  };
}

export function createBase(overrides: Partial<SphereLayer> = {}): SphereLayer {
  const paint = normalizePaint({ color: "#ffffff", alpha: 1, colorMode: "normal", ...overrides }, "#ffffff");

  return {
    ...paint,
    lattice: overrides.lattice ? createLattice(overrides.lattice) : undefined,
  };
}

export function createLatticeFromSource(source: BackgroundLayer | SphereLayer | CoverLayer): LatticeLayer {
  return createLattice({
    colorMode: source.colorMode,
    color: source.color,
    alpha: source.colorMode === "knockout" ? 1 : source.alpha,
    frequency: DEFAULT_FREQUENCY,
    lineWidth: DEFAULT_LINE_WIDTH,
    cutFill: true,
    outline: true,
    outlineWidth: DEFAULT_LINE_WIDTH,
    backEdges: "off",
    dashLength: 0,
    offset: { roll: 0, pitch: 0, yaw: 0 },
  });
}

export function defaultLogoState(): LogoState {
  return {
    background: createBackground(),
    base: createBase(),
    cover: createCover(),
    rotation: identityRotation(),
  };
}

function normalizePaint(value: unknown, fallbackColor: string): BackgroundLayer {
  const candidate = value && typeof value === "object" ? (value as Partial<BackgroundLayer>) : {};
  const colorMode = normalizeColorMode(candidate.colorMode);

  return {
    colorMode,
    color: normalizeColor(candidate.color, fallbackColor),
    alpha: colorMode === "knockout" ? 1 : clampAlpha(candidate.alpha, 1),
  };
}

function normalizeColorMode(value: unknown): ColorMode {
  return value === "knockout" ? "knockout" : "normal";
}

function clampAlpha(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeLineWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(12, Math.max(1, value))
    : DEFAULT_LINE_WIDTH;
}

function normalizeBorderWidth(value: unknown, fallback = DEFAULT_BORDER_WIDTH): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(BORDER_WIDTH_MAX, Math.max(BORDER_WIDTH_MIN, value))
    : fallback;
}

function normalizeFrequency(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clampFrequency(value) : DEFAULT_FREQUENCY;
}

// Older documents stored this as a pair of booleans.
function normalizeBackEdges(overrides: Partial<LatticeLayer> & { seeThrough?: unknown }): BackEdgeMode {
  const value = overrides.backEdges as unknown;

  if (value === "mask" || value === "both" || value === "through" || value === "off") {
    return value;
  }

  if (value === true) {
    return overrides.seeThrough === true ? "both" : "mask";
  }

  return "off";
}

function normalizeOffset(value: unknown): LatticeOffset {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<LatticeOffset>;

  return {
    roll: normalizeOffsetAngle(candidate.roll),
    pitch: normalizeOffsetAngle(candidate.pitch),
    yaw: normalizeOffsetAngle(candidate.yaw),
  };
}

function normalizeOffsetAngle(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(360, Math.max(0, value)) : 0;
}

function normalizeDashLength(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(DASH_LENGTH_MAX, Math.max(0, value))
    : 0;
}

// Documents written before frequency subdivision stored a face count. Those
// counts are all 20 * m^2, so the frequency is recoverable exactly.
function frequencyFromFaceCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 20) {
    return undefined;
  }

  return clampFrequency(Math.sqrt(value / 20));
}



function normalizeAngle(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isMatrix3(value: unknown): value is Matrix3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 3 &&
        row.every((entry) => typeof entry === "number" && Number.isFinite(entry)),
    )
  );
}

type LegacyPaintSource = {
  colorMode?: unknown;
  color?: unknown;
  alpha?: unknown;
  lattice?: unknown;
  latticeResolution?: unknown;
  lineWidth?: unknown;
};

function normalizeLatticeFrom(candidate: LegacyPaintSource, paint: BackgroundLayer): LatticeLayer | undefined {
  if (candidate.lattice) {
    return createLattice(candidate.lattice as Partial<LatticeLayer>);
  }

  const legacyFrequency = frequencyFromFaceCount(candidate.latticeResolution);

  if (legacyFrequency === undefined) {
    return undefined;
  }

  return createLattice({
    colorMode: paint.colorMode,
    color: paint.color,
    alpha: paint.alpha,
    frequency: legacyFrequency,
    lineWidth: normalizeLineWidth(candidate.lineWidth),
  });
}

function normalizeCover(value: unknown): CoverLayer {
  const candidate = (value && typeof value === "object" ? value : {}) as LegacyPaintSource;
  const paint = normalizePaint(
    { colorMode: candidate.colorMode, color: normalizeColor(candidate.color, "#000000"), alpha: candidate.alpha },
    "#000000",
  );

  return { ...paint, lattice: normalizeLatticeFrom(candidate, paint) };
}

function normalizeBase(value: unknown): SphereLayer {
  const candidate = (value && typeof value === "object" ? value : {}) as LegacyPaintSource;
  const paint = normalizePaint(
    { colorMode: candidate.colorMode, color: normalizeColor(candidate.color, "#ffffff"), alpha: candidate.alpha },
    "#ffffff",
  );

  return { ...paint, lattice: normalizeLatticeFrom(candidate, paint) };
}

// Older documents stored a rotation per layer and an array of covers. The single
// remaining cover keeps its own orientation, so that matrix becomes the one
// rotation the whole logo now shares.
function normalizeRotationFrom(parsed: Record<string, unknown>, legacyCover: unknown): Matrix3 {
  if (isMatrix3(parsed.rotation)) {
    return normalizeRotation(parsed.rotation);
  }

  const candidate = (legacyCover && typeof legacyCover === "object" ? legacyCover : {}) as Record<string, unknown>;

  if (isMatrix3(candidate.rotation)) {
    return normalizeRotation(candidate.rotation);
  }

  if (candidate.roll !== undefined || candidate.pitch !== undefined || candidate.yaw !== undefined) {
    return normalizeRotation(
      legacyEulerToMatrix(
        normalizeAngle(candidate.roll),
        normalizeAngle(candidate.pitch),
        normalizeAngle(candidate.yaw),
      ),
    );
  }

  return identityRotation();
}

export function loadLogoState(): LogoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultLogoState();
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const legacyCover = Array.isArray(parsed.covers) ? parsed.covers[0] : undefined;
    const coverSource = parsed.cover ?? legacyCover;

    return {
      background: createBackground(parsed.background as Partial<BackgroundLayer>),
      base: normalizeBase(parsed.base),
      cover: normalizeCover(coverSource),
      border: parsed.border ? createBorder(parsed.border as Partial<BorderLayer>) : undefined,
      rotation: normalizeRotationFrom(parsed, legacyCover),
    };
  } catch {
    return defaultLogoState();
  }
}

export function saveLogoState(state: LogoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
