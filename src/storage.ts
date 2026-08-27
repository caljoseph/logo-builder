import type {
  BackgroundLayer,
  ColorMode,
  CoverLayer,
  LatticeLayer,
  LatticeResolution,
  LogoState,
  SphereLayer,
  StackItem,
} from "./types";
import { identityRotation, legacyEulerToMatrix, normalizeRotation, type Matrix3 } from "./rotation";

const STORAGE_KEY = "logoBuilder.state.v1";
const DEFAULT_LINE_WIDTH = 3;
const DEFAULT_DOT_SIZE = 4;
const LATTICE_RESOLUTIONS = new Set<LatticeResolution>([20, 80, 320, 1280, 5120]);

export function createBackground(overrides: Partial<BackgroundLayer> = {}): BackgroundLayer {
  return normalizePaint({ color: "#ffffff", alpha: 1, colorMode: "normal", ...overrides }, "#ffffff");
}

export function createLattice(overrides: Partial<LatticeLayer> = {}): LatticeLayer {
  const base = normalizePaint({ color: "#000000", alpha: 1, colorMode: "normal", ...overrides }, "#000000");

  return {
    ...base,
    resolution: normalizeLatticeResolution(overrides.resolution, 320),
    lineWidth: normalizeLineWidth(overrides.lineWidth),
    showIntersections: overrides.showIntersections === true,
    dotSize: normalizeDotSize(overrides.dotSize),
    rotation: isMatrix3(overrides.rotation) ? normalizeRotation(overrides.rotation) : identityRotation(),
    selected: overrides.selected === true,
  };
}

export function createCover(overrides: Partial<CoverLayer> = {}): CoverLayer {
  const paint = normalizePaint({ color: "#000000", alpha: 1, colorMode: "normal", ...overrides }, "#000000");

  return {
    id: crypto.randomUUID(),
    ...paint,
    rotation: isMatrix3(overrides.rotation) ? normalizeRotation(overrides.rotation) : identityRotation(),
    selected: overrides.selected === true,
    lattice: overrides.lattice ? createLattice(overrides.lattice) : undefined,
    ...pickDefined({ id: overrides.id }),
  };
}

export function createBase(overrides: Partial<SphereLayer> = {}): SphereLayer {
  const paint = normalizePaint({ color: "#ffffff", alpha: 1, colorMode: "normal", ...overrides }, "#ffffff");

  return {
    ...paint,
    rotation: isMatrix3(overrides.rotation) ? normalizeRotation(overrides.rotation) : identityRotation(),
    selected: overrides.selected === true,
    lattice: overrides.lattice ? createLattice(overrides.lattice) : undefined,
  };
}

export function createLatticeFromSource(source: BackgroundLayer | SphereLayer | CoverLayer): LatticeLayer {
  return createLattice({
    colorMode: source.colorMode,
    color: source.color,
    alpha: source.colorMode === "knockout" ? 1 : source.alpha,
    resolution: 320,
    lineWidth: DEFAULT_LINE_WIDTH,
    showIntersections: false,
    dotSize: DEFAULT_DOT_SIZE,
    rotation: identityRotation(),
    selected: true,
  });
}

export function defaultLogoState(): LogoState {
  const cover = createCover({ selected: true });

  return {
    background: createBackground(),
    base: createBase(),
    covers: [cover],
    stack: [{ kind: "cover", id: cover.id }],
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

function normalizeDotSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(12, Math.max(1, value))
    : DEFAULT_DOT_SIZE;
}

function normalizeLatticeResolution(value: unknown, fallback: LatticeResolution): LatticeResolution {
  return LATTICE_RESOLUTIONS.has(value as LatticeResolution) ? (value as LatticeResolution) : fallback;
}

function normalizeLegacyLatticeResolution(value: unknown): LatticeResolution | "none" {
  return LATTICE_RESOLUTIONS.has(value as LatticeResolution) ? (value as LatticeResolution) : "none";
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

function normalizeCover(value: unknown): CoverLayer | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CoverLayer> & {
    roll?: unknown;
    pitch?: unknown;
    yaw?: unknown;
    latticeResolution?: unknown;
    lineWidth?: unknown;
    latticeRotation?: unknown;
    latticeSelected?: unknown;
  };
  const rotation = isMatrix3(candidate.rotation)
    ? normalizeRotation(candidate.rotation)
    : legacyEulerToMatrix(
        normalizeAngle(candidate.roll),
        normalizeAngle(candidate.pitch),
        normalizeAngle(candidate.yaw),
      );
  const cover = createCover({
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : crypto.randomUUID(),
    colorMode: candidate.colorMode,
    color: normalizeColor(candidate.color, "#000000"),
    alpha: clampAlpha(candidate.alpha, 1),
    rotation,
    selected: candidate.selected === true,
    lattice: candidate.lattice ? createLattice(candidate.lattice) : undefined,
  });

  if (!cover.lattice) {
    const legacyResolution = normalizeLegacyLatticeResolution(candidate.latticeResolution);

    if (legacyResolution !== "none") {
      cover.lattice = createLattice({
        colorMode: cover.colorMode,
        color: cover.color,
        alpha: cover.alpha,
        resolution: legacyResolution,
        lineWidth: normalizeLineWidth(candidate.lineWidth),
        rotation: isMatrix3(candidate.latticeRotation)
          ? normalizeRotation(candidate.latticeRotation)
          : identityRotation(),
        selected: candidate.latticeSelected === true,
      });
    }
  }

  return cover;
}

function normalizeBase(value: unknown): SphereLayer {
  const candidate = value && typeof value === "object"
    ? (value as Partial<SphereLayer> & {
        latticeResolution?: unknown;
        lineWidth?: unknown;
        latticeRotation?: unknown;
        latticeSelected?: unknown;
      })
    : {};
  const base = createBase({
    colorMode: candidate.colorMode,
    color: normalizeColor(candidate.color, "#ffffff"),
    alpha: clampAlpha(candidate.alpha, 1),
    rotation: isMatrix3(candidate.rotation) ? normalizeRotation(candidate.rotation) : identityRotation(),
    selected: candidate.selected === true,
    lattice: candidate.lattice ? createLattice(candidate.lattice) : undefined,
  });

  if (!base.lattice) {
    const legacyResolution = normalizeLegacyLatticeResolution(candidate.latticeResolution);

    if (legacyResolution !== "none") {
      base.lattice = createLattice({
        colorMode: base.colorMode,
        color: base.color,
        alpha: base.alpha,
        resolution: legacyResolution,
        lineWidth: normalizeLineWidth(candidate.lineWidth),
        rotation: isMatrix3(candidate.latticeRotation)
          ? normalizeRotation(candidate.latticeRotation)
          : identityRotation(),
        selected: candidate.latticeSelected === true,
      });
    }
  }

  return base;
}

function normalizeStack(value: unknown, covers: CoverLayer[]): StackItem[] {
  const coverIds = new Set(covers.map((cover) => cover.id));
  const latticeIds = new Set(covers.filter((cover) => cover.lattice).map((cover) => cover.id));
  const seen = new Set<string>();
  const stack: StackItem[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const candidate = item as Partial<StackItem>;
      const key = `${candidate.kind}:${candidate.id}`;

      if (
        candidate.kind === "cover" &&
        typeof candidate.id === "string" &&
        coverIds.has(candidate.id) &&
        !seen.has(key)
      ) {
        stack.push({ kind: "cover", id: candidate.id });
        seen.add(key);
      }

      if (
        candidate.kind === "coverLattice" &&
        typeof candidate.id === "string" &&
        latticeIds.has(candidate.id) &&
        !seen.has(key)
      ) {
        stack.push({ kind: "coverLattice", id: candidate.id });
        seen.add(key);
      }
    }
  }

  for (const cover of covers) {
    const coverKey = `cover:${cover.id}`;
    const latticeKey = `coverLattice:${cover.id}`;

    if (!seen.has(coverKey)) {
      stack.push({ kind: "cover", id: cover.id });
      seen.add(coverKey);
    }

    if (cover.lattice && !seen.has(latticeKey)) {
      stack.push({ kind: "coverLattice", id: cover.id });
      seen.add(latticeKey);
    }
  }

  return stack;
}

export function loadLogoState(): LogoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultLogoState();
    }

    const parsed = JSON.parse(raw) as Partial<LogoState>;
    const covers = Array.isArray(parsed.covers)
      ? parsed.covers.map(normalizeCover).filter((cover): cover is CoverLayer => Boolean(cover))
      : [];
    const validCovers = covers.length > 0 ? covers : [createCover({ selected: true })];

    return {
      background: createBackground(parsed.background),
      base: normalizeBase(parsed.base),
      covers: validCovers,
      stack: normalizeStack(parsed.stack, validCovers),
    };
  } catch {
    return defaultLogoState();
  }
}

export function saveLogoState(state: LogoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pickDefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
