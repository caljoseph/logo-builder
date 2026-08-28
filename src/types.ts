import type { Matrix3 } from "./rotation";

export type ColorMode = "normal" | "knockout";

// Geodesic frequency: each icosahedron edge is cut into this many parts, giving
// 20 * frequency^2 faces. Every whole value is valid, so density is finer than
// the powers-of-two that recursive subdivision alone can reach.
export type LatticeResolution = number;

export type PaintStyle = {
  colorMode: ColorMode;
  color: string;
  alpha: number;
};

export type BackgroundLayer = PaintStyle;

export type LatticeLayer = PaintStyle & {
  frequency: LatticeResolution;
  lineWidth: number;
  // When set, the parent layer's fill is erased everywhere the lattice draws,
  // so the layer only paints the negative space between the lines and nothing
  // of that fill shows through them.
  cutFill: boolean;
  // Stroke the silhouette of the region the lattice is clipped to, at its own
  // width so a heavy outline can sit around fine interior lines.
  outline: boolean;
  outlineWidth: number;
  // Where the faint far-side edges are allowed to draw:
  // - off: not at all.
  // - mask: inside the lattice's own mask only.
  // - both: across the whole ball.
  // - through: only outside the mask, so the far side shows in the bare half
  //   while the lattice half stays clean.
  backEdges: BackEdgeMode;
  // Dash the lines. 0 leaves them solid.
  dashLength: number;
  // Spins the lattice mesh inside its mask. Composed on top of the logo's own
  // rotation, so dragging still moves everything together while this turns the
  // lines within a cover that stays put.
  offset: LatticeOffset;
};

export type BackEdgeMode = "off" | "mask" | "both" | "through";

export type LatticeOffset = {
  roll: number;
  pitch: number;
  yaw: number;
};

export type SphereLayer = PaintStyle & {
  lattice?: LatticeLayer;
};

export type BorderLayer = PaintStyle & {
  width: number;
};

export type CoverLayer = PaintStyle & {
  lattice?: LatticeLayer;
};

export type LogoState = {
  background: BackgroundLayer;
  base: SphereLayer;
  cover: CoverLayer;
  // A plain circle stroked around the whole ball.
  border?: BorderLayer;
  rotation: Matrix3;
};

export type EditableLayer =
  | { kind: "background" }
  | { kind: "base" }
  | { kind: "baseLattice" }
  | { kind: "cover" }
  | { kind: "coverLattice" }
  | { kind: "border" };
