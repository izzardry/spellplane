/**
 * Plain, the fourth look's 3D table world and the default (docs/design/m8/m7-adjustments.md, M7-P1, "The Plain table
 * world": "the plain design with depth; Ztyle's page as a table"; docs/design/m8/visual.md 2.2: "Unlit materials, no
 * post-processing: Plain must be the cheapest look to draw"; owner, 20 Nov 2026: "the white design lacks depth and
 * tactileness"). Loaded lazily as its own chunk.
 *
 * - Table: a pale slab 8 mm thick with 16 mm corners, its top the look's `mat` (#f2f2f2, not pure white, so a white
 *   bordered card keeps an edge) with a halftone of 0.5 mm dots on a 4 mm grid at 5 % ink (textures.ts), its sides one
 *   step darker than the desk, a white hairline along its top edge (the lit rim of a board).
 * - Desk: a wide plane in the look's `frame` (#e3e3e3) with the same halftone at 3 %; the room behind it is the same
 *   colour, so first person sees desk to the horizon. The slab casts one wide soft shadow on it (30 mm, 12 % ink, baked).
 * - Light: none. Every material is unlit, so the table shows exactly its colours; no shadow maps, no post passes.
 * - Card shadows: the pipeline's contact shadows, short and soft.
 * - Marks: debossed wells under pile slots (a shade darker than the mat), quieter beds under command areas, white
 *   paper plaques with an ink hairline at named chairs carrying the seat's glyph.
 * - Selection: a double ring (a gap in the mat colour, then an ink ring), so it reads on a black card border and on
 *   the pale table.
 * - Sound: dry and light, paper on a desk; peaks at 0.3 of the gain.
 */
import * as THREE from 'three';
import { DEFAULT_CARD_FEEL } from '../../scene/types';
import { buildWorld, type WorldSpec } from '../kit/look';
import { shade } from '../kit/procedural';
import { soundSet } from '../kit/sounds';
import { type Parts, lineGeometry, loopSegments, roundedRectPoints } from '../kit/world';
import { PATTERN_DASH } from '../paper/index';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type MaterialSpec, type SeatColour, type Theme } from '../types';
import { DESK_HALFTONE, HALFTONE_TILE_MM, PLAIN_BACK, TABLE_HALFTONE } from './textures';

/** The table surface: the look's `mat` token. */
export const PLAIN_SURFACE = '#f2f2f2';
/** The desk around it, and the room: the look's `frame` token. */
export const PLAIN_SURROUND = '#e3e3e3';
/** Ink: text, the selection ring, shadows. */
export const PLAIN_INK = '#0d0d0d';

/** The slab: thickness and corner radius, mm. */
export const SLAB_MM = 8;
export const SLAB_RADIUS_MM = 16;
/** How far the desk plane reaches beyond the table, mm (past the horizon of every view). */
export const DESK_MM = 6000;

export const TABLE_SPEC: MaterialSpec = { model: 'unlit', colour: PLAIN_SURFACE, roughness: 1, metalness: 0, tileMm: HALFTONE_TILE_MM, maps: { albedo: { kind: 'procedural', source: TABLE_HALFTONE } } };
/** The slab's side: one step darker than the desk. */
export const SIDE_SPEC: MaterialSpec = { model: 'unlit', colour: shade(PLAIN_SURROUND, 0.9), roughness: 1, metalness: 0 };
export const DESK_SPEC: MaterialSpec = { model: 'unlit', colour: PLAIN_SURROUND, roughness: 1, metalness: 0, tileMm: HALFTONE_TILE_MM, maps: { albedo: { kind: 'procedural', source: DESK_HALFTONE } } };

/** The seat colours (as Kitchen Table's: clear on a pale table), each with its shape; cream ink on them. */
const SEATS: SeatColour[] = [
  { index: 0, colour: '#2f6f9f', pattern: 'solid', glyph: 'circle', ink: '#fafafa' },
  { index: 1, colour: '#8a4f7d', pattern: 'dash', glyph: 'square', ink: '#fafafa' },
  { index: 2, colour: '#3d6b35', pattern: 'dot', glyph: 'triangle', ink: '#fafafa' },
  { index: 3, colour: '#8a5a00', pattern: 'dash-dot', glyph: 'diamond', ink: '#fafafa' },
  { index: 4, colour: '#1f6f73', pattern: 'long-dash', glyph: 'star', ink: '#fafafa' },
  { index: 5, colour: '#6a4fb0', pattern: 'dash-dot-dot', glyph: 'hexagon', ink: '#fafafa' },
  { index: 6, colour: '#a33a5a', pattern: 'double', glyph: 'cross', ink: '#fafafa' },
  { index: 7, colour: '#5c5e14', pattern: 'zigzag', glyph: 'ring', ink: '#fafafa' },
];

/** A white hairline along the slab's top edge: the lit rim that gives the paper board its edge. */
function rim(parts: Parts, table: { w: number; d: number }): THREE.Object3D[] {
  const line = new THREE.LineSegments(
    parts.geometry(lineGeometry(loopSegments(roundedRectPoints(table.w - 1, table.d - 1, SLAB_RADIUS_MM - 0.5, 0, 0, 0, 12)), 0.02)),
    parts.own(new THREE.LineBasicMaterial({ color: '#ffffff', toneMapped: false })),
  );
  line.name = 'plain-rim';
  line.renderOrder = 1;
  return [line];
}

export const PLAIN_WORLD: Omit<WorldSpec, 'seats'> = {
  name: 'plain',
  surface: PLAIN_SURFACE,
  surround: PLAIN_SURROUND,
  slabs: [
    { name: 'desk', spec: DESK_SPEC, growMm: DESK_MM, radiusMm: 0, top: -SLAB_MM, depth: 1, bevel: 0 },
    { name: 'slab', spec: TABLE_SPEC, side: SIDE_SPEC, growMm: 0, radiusMm: SLAB_RADIUS_MM, top: 0, depth: SLAB_MM, bevel: 0.6 },
  ],
  // The slab's one wide, soft shadow on the desk.
  skirts: [{ growMm: 0, radiusMm: SLAB_RADIUS_MM, spreadMm: 30, opacity: 0.12, at: -SLAB_MM + 0.02, colour: PLAIN_INK }],
  marks: {
    top: 0,
    // Debossed wells: a shade darker than the mat.
    bed: { spec: { ...TABLE_SPEC, colour: shade(PLAIN_SURFACE, 0.94) }, padMm: 2, radiusMm: 3 },
    area: { spec: { ...TABLE_SPEC, colour: shade(PLAIN_SURFACE, 0.97) }, radiusMm: 3 },
    territory: null,
    plaque: { spec: { model: 'unlit', colour: '#fcfcfc', roughness: 1, metalness: 0 }, lengthMm: 128, heightMm: 46, baseMm: -SLAB_MM, outline: '#bdbdbd' },
    glyph: { sizeMm: 14, offsetMm: 44 },
  },
  ornament: rim,
};

function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    widthPx: kind === 'attack' || kind === 'block' ? 3 : 2,
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'stroke',
    glow: 0,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'chevron',
    pulseMs: 260,
    animation: 'none',
    ornament: 'plain',
  };
}

const MONO = '"Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The Plain theme. */
export const plain: Theme = {
  id: 'plain',
  label: 'Plain',
  tokens: {
    colours: {
      bg: '#fcfcfc',
      fg: PLAIN_INK,
      muted: '#666666',
      surface: PLAIN_SURFACE,
      // Hairlines: the look's border, as an opaque grey on the mat.
      border: '#a8a8a8',
      accent: PLAIN_INK,
      danger: '#c81e1e',
      warning: '#8a5a00',
      focus: PLAIN_INK,
      seats: SEATS,
    },
    type: { family: MONO, mono: MONO, size: 14, small: 12, large: 18, weight: 400, weightBold: 600 },
    radii: { sm: 6, md: 18, lg: 18 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    hud: {
      scheme: 'light',
      panel: '#fcfcfc',
      panelBorder: 'rgba(13, 13, 13, 0.12)',
      shadow: '0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 1px 2px rgba(13, 13, 13, 0.12), 0 6px 16px rgba(13, 13, 13, 0.08)',
      blur: 0,
      overlay: 'rgba(242, 242, 242, 0.82)',
    },
  },
  // Leaning in, like Kitchen Table: the table in depth, the slab's edge in view.
  camera: { defaultRig: 'birdseye', tilt: 0.55 },
  build: (ctx) => buildWorld(ctx, { ...PLAIN_WORLD, seats: SEATS }),
  cardDressing: {
    sleeve: '#151515',
    thickness: 0.6,
    back: PLAIN_BACK,
    hover: { colour: '#8c8c8c', width: 0.8, lift: 0, glow: 0 },
    // The double ring: 0.6 mm of mat, then 0.9 mm of ink (outer edge 1.5 mm from the card).
    selected: { colour: PLAIN_INK, width: 1.5, gap: 0.6, lift: 0, glow: 0 },
    tappedBadge: PLAIN_INK,
    displacedMarker: PLAIN_INK,
    ghost: { colour: '#666666', opacity: 0.5, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    sleeveMaterial: { model: 'unlit', colour: '#151515', roughness: 1, metalness: 0 },
    edge: '#2a2a2a',
    faceShade: 0,
    // Unlit: a held card lifts and casts its shadow but does not tilt (the geometry spec tilts only in lit themes).
    held: { lift: 12, tiltDeg: 0, shadow: true },
    // The thing to do next: a warm orange apart from ink, hover grey and every seat colour.
    pending: { colour: '#e0731a', width: 1.6, lift: 0, glow: 0 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  // Dry and light: paper on a desk, short decays; the loudest part peaks at 0.3 of the gain (kit/sounds.ts CUE_PEAK).
  sounds: soundSet({ hiss: 2400, knock: 260, paper: 3800, level: 1, chime: [659.25, 987.77], chimeWave: 'triangle', ring: 0.6 }, true),
  quality: [
    { id: 'high', shadows: true, post: false, particles: false, pixelRatio: 2, anisotropy: 8, msaa: 0 },
    { id: 'medium', shadows: false, post: false, particles: false, pixelRatio: 1.5, anisotropy: 4, msaa: 0 },
    { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1, msaa: 0 },
  ],
  lighting: { lit: false, lights: [], toneMapping: 'none', exposure: 1, background: PLAIN_SURROUND, fog: null },
  // Two-layer shadows in spirit: short and fairly dark at the card's edge, faded by 30 mm of lift.
  shadows: { enabled: true, map: null, contact: { opacity: 0.32, blurMm: 3, heightMm: 30 } },
  post: { bloom: null, vignette: null },
  feel: { settle: { ...DEFAULT_CARD_FEEL.settle, bounce: 0.12 } },
};
