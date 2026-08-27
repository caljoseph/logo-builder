import type { Matrix3 } from "./rotation";

export type ColorMode = "normal" | "knockout";

export type LatticeResolution = 20 | 80 | 320 | 1280 | 5120;

export type PaintStyle = {
  colorMode: ColorMode;
  color: string;
  alpha: number;
};

export type BackgroundLayer = PaintStyle;

export type LatticeLayer = PaintStyle & {
  resolution: LatticeResolution;
  lineWidth: number;
  showIntersections: boolean;
  dotSize: number;
  rotation: Matrix3;
  selected: boolean;
};

export type SphereLayer = PaintStyle & {
  rotation: Matrix3;
  selected: boolean;
  lattice?: LatticeLayer;
};

export type CoverLayer = PaintStyle & {
  id: string;
  rotation: Matrix3;
  selected: boolean;
  lattice?: LatticeLayer;
};

export type StackItem =
  | { kind: "cover"; id: string }
  | { kind: "coverLattice"; id: string };

export type LogoState = {
  background: BackgroundLayer;
  base: SphereLayer;
  covers: CoverLayer[];
  stack: StackItem[];
};

export type EditableLayer =
  | { kind: "background" }
  | { kind: "base" }
  | { kind: "baseLattice" }
  | { kind: "cover"; id: string }
  | { kind: "coverLattice"; id: string };
