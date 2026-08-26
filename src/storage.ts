import type { CoverLayer, LogoState } from "./types";
import { identityRotation, legacyEulerToMatrix, normalizeRotation, type Matrix3 } from "./rotation";

const STORAGE_KEY = "logoBuilder.state.v1";

export function createCover(overrides: Partial<CoverLayer> = {}): CoverLayer {
  return {
    id: crypto.randomUUID(),
    color: "#000000",
    alpha: 1,
    rotation: identityRotation(),
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

  const candidate = value as Partial<CoverLayer>;
  const legacyCandidate = value as { roll?: unknown; pitch?: unknown; yaw?: unknown };
  const rotation = isMatrix3(candidate.rotation)
    ? normalizeRotation(candidate.rotation)
    : legacyEulerToMatrix(
        normalizeAngle(legacyCandidate.roll),
        normalizeAngle(legacyCandidate.pitch),
        normalizeAngle(legacyCandidate.yaw),
      );

  return createCover({
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : crypto.randomUUID(),
    color: normalizeColor(candidate.color, "#000000"),
    alpha: clampAlpha(candidate.alpha, 1),
    rotation,
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
