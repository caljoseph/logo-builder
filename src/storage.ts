import type { CoverLayer, LogoState } from "./types";

const STORAGE_KEY = "logoBuilder.state.v1";

export function createCover(overrides: Partial<CoverLayer> = {}): CoverLayer {
  return {
    id: crypto.randomUUID(),
    color: "#000000",
    alpha: 1,
    roll: 0,
    pitch: 0,
    yaw: 0,
    selected: false,
    ...overrides,
  };
}

export function defaultLogoState(): LogoState {
  return {
    base: { color: "#ffffff", alpha: 1 },
    covers: [createCover({ selected: true })],
  };
}

function clampAlpha(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeAngle(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeCover(value: unknown): CoverLayer | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CoverLayer>;

  return createCover({
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : crypto.randomUUID(),
    color: normalizeColor(candidate.color, "#000000"),
    alpha: clampAlpha(candidate.alpha, 1),
    roll: normalizeAngle(candidate.roll),
    pitch: normalizeAngle(candidate.pitch),
    yaw: normalizeAngle(candidate.yaw),
    selected: candidate.selected === true,
  });
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

    return {
      base: {
        color: normalizeColor(parsed.base?.color, "#ffffff"),
        alpha: clampAlpha(parsed.base?.alpha, 1),
      },
      covers: covers.length > 0 ? covers : [createCover({ selected: true })],
    };
  } catch {
    return defaultLogoState();
  }
}

export function saveLogoState(state: LogoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
