/**
 * Geometry, camera and motion constants (DESIGN "Specification: geometry, layout and motion").
 * Millimetres in table space unless the name says otherwise. Theme-independent defaults; a theme's
 * MotionConstants (themes/types.ts) start from DEFAULT_MOTION.
 */

/** Card and placement constants in mm (DESIGN "Specification: geometry, layout and motion", constants table). */
export const GEOMETRY = {
  card: { w: 63, h: 88, cornerRadius: 3, thickness: 0.6 },
  gap: 6,
  snapRadius: 12,
  cascadeOffset: 14,
  attachTuck: { x: 10, y: 10 },
  squaredStep: 0.4,
  squaredStepCap: 20,
  attackDisplacement: 110,
  blockerDistance: 96,
  blockerSpacing: 69,
  dragLift: 12,
  dragTiltDeg: 4,
  stackLane: { w: 200, d: 320, cascadeOffset: 22 },
  pileColumnGap: 12,
} as const;

/**
 * Paperclip constants (PLAN Milestone 6, owner decisions, Paperclips: "A small paperclip object (about 12 × 32 mm)";
 * "press and hold the left button without moving for 600 ms where two or more cards overlap; a ring fills from 200 ms
 * on"). `w` × `h` mm in table space; `holdMs` and `ringFromMs` from the press; `holdSlopPx` the CSS px a held pointer
 * may wander and still count as not moving (the scene's drag threshold); `minCards` the fewest cards a clip holds.
 * Added by M6-C; M6-P1 may tune `holdSlopPx` only.
 */
export const CLIP = { w: 12, h: 32, holdMs: 600, ringFromMs: 200, holdSlopPx: 4, minCards: 2 } as const;

/**
 * Tuck (attach) drop rule 3a (DESIGN "Specification: geometry, layout and motion", Drop resolution 3a; PLAN Milestone 6,
 * owner decisions, Tuck): the dragged card's bottom edge lies within the upper `band` of another card and they overlap
 * horizontally by at least `minOverlap` of the dragged card's width; it then tucks behind at GEOMETRY.attachTuck per
 * attachment. Mirrors rule 3 (cascade) with the band at the top. Added by M6-C; scene/snap.ts (M6-P1) applies it.
 */
export const TUCK_RULE = { band: 1 / 3, minOverlap: 0.5 } as const;

/**
 * Camera rig constants (DESIGN "Specification: geometry, layout and motion", Camera rigs). The ego seat is pulled back
 * and raised from the spec's 260 behind the edge and 620 up to 900 and 860 (PLAN Milestone 5, owner decisions: "Ego
 * framing shows your own piles": the own pile column and the whole battlefield row on screen at the default ego view at
 * 1440 × 900 and on an iPad landscape viewport), keeping the spec's field of view, pitch and pitch limits (M5-P7;
 * DECISIONS [M5-P7]).
 */
export const CAMERA = {
  birdseye: { fovDeg: 6 },
  ego: { fovDeg: 45, behindEdge: 900, height: 860, pitchDeg: 35, minPitchDeg: 25, maxPitchDeg: 60 },
  blendMs: 400,
  fitMargin: 0.05,
  /** Closest zoom: one card fills this fraction of the viewport height. */
  maxCardViewportFraction: 0.8,
} as const;

/** Motion constants (DESIGN "Specification: geometry, layout and motion", Motion; "Combat and annotation", Ping). */
export interface MotionConstants {
  spring: { stiffness: number; damping: number; mass: number };
  tapMs: number;
  flipMs: number;
  settleMs: number;
  settleStaggerMs: number;
  remoteMoveMs: number;
  panInertiaMs: number;
  cameraBlendMs: number;
  pingFadeMs: number;
}

/** Default motion, used by Paper (DESIGN "Specification: geometry, layout and motion", Motion). With reduced motion all are cuts. */
export const DEFAULT_MOTION: MotionConstants = {
  spring: { stiffness: 320, damping: 36, mass: 1 },
  tapMs: 120,
  flipMs: 220,
  settleMs: 260,
  settleStaggerMs: 20,
  remoteMoveMs: 180,
  panInertiaMs: 325,
  cameraBlendMs: 400,
  pingFadeMs: 2000,
};

/** Screen-layer proportions (DESIGN "Specification: geometry, layout and motion", Screen layer). */
export const SCREEN_LAYER = {
  handCardViewportFraction: 0.22,
  handWidthFraction: 0.8,
  handHoverViewportFraction: 0.45,
  inspectViewportFraction: 0.85,
  captionMaxWidthPx: 280,
  captionMaxLines: 3,
} as const;
