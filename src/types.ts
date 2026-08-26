import type { Matrix3 } from "./rotation";

export type LatticeResolution = "none" | 20 | 80 | 320 | 1280 | 5120;

export type SphereLayer = {
  color: string;
  alpha: number;
  latticeResolution: LatticeResolution;
  lineWidth: number;
  latticeRotation: Matrix3;
  latticeSelected: boolean;
};

export type CoverLayer = {
  id: string;
  color: string;
  alpha: number;
  rotation: Matrix3;
  selected: boolean;
  latticeResolution: LatticeResolution;
  lineWidth: number;
  latticeRotation: Matrix3;
  latticeSelected: boolean;
};

export type LogoState = {
  base: SphereLayer;
  covers: CoverLayer[];
};

export type EditableLayer =
  | { kind: "base" }
  | { kind: "cover"; id: string };
