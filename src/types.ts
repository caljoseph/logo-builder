import type { Matrix3 } from "./rotation";

export type SphereLayer = {
  color: string;
  alpha: number;
};

export type CoverLayer = {
  id: string;
  color: string;
  alpha: number;
  rotation: Matrix3;
  selected: boolean;
};

export type LogoState = {
  base: SphereLayer;
  covers: CoverLayer[];
};

export type EditableLayer =
  | { kind: "base" }
  | { kind: "cover"; id: string };
