/**
 * B · Graphite, the look's 3D table world (PLAN Milestone 7, Owner decisions after the first design round: Graphite is
 * "a bit too flat": it "gets depth (layered surfaces, soft shadows, a subtle material grain) while staying the calm,
 * cheap-to-draw look"; PLAN M7-P1: "cool charcoal with a faint dot grid and hairline territories, but with depth";
 * docs/design/m7-directions.html, Direction B: "A precise instrument that gets out of the way … the cards — the only
 * bright, saturated things on screen — carry all the colour"). Loaded lazily as its own chunk.
 *
 * - Table: a charcoal slate slab with a fine grain and a faint dot grid (kit/surfaces.ts), its top the table, standing
 *   12 mm proud of a darker plinth that frames it; a baked soft shadow of the slab on the plinth; each territory a
 *   slightly lighter layer, pile slots recessed a shade darker, raised panel tabs at named chairs (kit/marks.ts).
 * - Light: a cool sky fill, a cool key from the viewer's upper left that catches the slab's chamfer and the grain at a
 *   grazing first-person view, and a soft overhead pool; no shadow maps, no post-processing, no tone mapping.
 * - Card shadows: contact shadows a little darker than Kitchen's, for depth on the dark slate.
 * - Cards: 0.6 mm boxes in near-black sleeves, faces near-unlit, a mint selection, a near-white pending outline.
 * - Seat colours: light, clear colours for the charcoal, dark ink on them.
 * - Sound: crisp and short (kit/sounds.ts).
 */
import { DEFAULT_CARD_FEEL } from '../../scene/types';
import { buildWorld, type WorldSpec } from '../kit/look';
import { shade } from '../kit/procedural';
import { soundSet } from '../kit/sounds';
import { PATTERN_DASH } from '../paper/index';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type MaterialSpec, type SeatColour, type Theme } from '../types';
import { GRAPHITE_BACK, PLINTH, SLATE, SLATE_TILE_MM } from './textures';

/** The slate as the HUD and the contrast rules see it (tokens.colours.surface), measured half-way out (tests/e2e/themes/looks.spec.ts). */
/** What frames the table on screen (the look's `frame` token; docs/design/m8/m7-adjustments.md, M7-P1). */
export const GRAPHITE_SURROUND = '#101317';

export const GRAPHITE_SURFACE = '#16191e';

export const GRAPHITE_BACKGROUND = '#0b0d10';

/** The slate's colour, multiplied by the grain of SLATE.albedo. */
export const SLATE_COLOUR = '#0e1117';

export const SLAB: MaterialSpec = {
  model: 'standard',
  colour: SLATE_COLOUR,
  roughness: 0.62,
  metalness: 0,
  tileMm: SLATE_TILE_MM,
  normalScale: 0.6,
  maps: { albedo: { kind: 'procedural', source: SLATE.albedo }, normal: { kind: 'procedural', source: SLATE.normal } },
};

/** The plinth's colour: its sheen under the lights keeps it a little above the `frame` token from above (the looks spec states how far). */
export const PLINTH_COLOUR = '#15181d';
export const PLINTH_SPEC: MaterialSpec = {
  model: 'standard',
  colour: PLINTH_COLOUR,
  roughness: 0.72,
  metalness: 0,
  tileMm: 160,
  normalScale: 0.5,
  maps: { albedo: { kind: 'procedural', source: PLINTH.albedo }, normal: { kind: 'procedural', source: PLINTH.normal } },
};

/** How far the plinth reaches beyond the slab, mm, and how far below the table its top lies. */
export const PLINTH_MM = 84;
export const PLINTH_DROP_MM = 12;

const SEATS: SeatColour[] = [
  { index: 0, colour: '#5aa2ff', pattern: 'solid', glyph: 'circle', ink: '#0d1014' },
  { index: 1, colour: '#ff9466', pattern: 'dash', glyph: 'square', ink: '#0d1014' },
  { index: 2, colour: '#7bd88f', pattern: 'dot', glyph: 'triangle', ink: '#0d1014' },
  { index: 3, colour: '#b9a2ff', pattern: 'dash-dot', glyph: 'diamond', ink: '#0d1014' },
  { index: 4, colour: '#f2c14e', pattern: 'long-dash', glyph: 'star', ink: '#0d1014' },
  { index: 5, colour: '#5ad1e6', pattern: 'dash-dot-dot', glyph: 'hexagon', ink: '#0d1014' },
  { index: 6, colour: '#ff8fc8', pattern: 'double', glyph: 'cross', ink: '#0d1014' },
  { index: 7, colour: '#c6e06a', pattern: 'zigzag', glyph: 'ring', ink: '#0d1014' },
];

export const GRAPHITE_WORLD: Omit<WorldSpec, 'seats'> = {
  name: 'graphite',
  surface: GRAPHITE_SURFACE,
  surround: GRAPHITE_SURROUND,
  slabs: [
    { name: 'plinth', spec: PLINTH_SPEC, growMm: PLINTH_MM, radiusMm: 10, top: -PLINTH_DROP_MM, depth: 30, bevel: 2.5 },
    { name: 'slab', spec: SLAB, growMm: 0, radiusMm: 4, top: 0, depth: PLINTH_DROP_MM + 6, bevel: 1.6 },
  ],
  // The slab's soft shadow on the plinth: depth without a shadow map.
  skirts: [{ growMm: 0, radiusMm: 4, spreadMm: 22, opacity: 0.62, at: -PLINTH_DROP_MM + 0.02, colour: '#000000' }],
  marks: {
    top: 0,
    bed: { spec: { ...SLAB, colour: shade(SLATE_COLOUR, 0.62) }, padMm: 3, radiusMm: 4 },
    area: { spec: { ...SLAB, colour: shade(SLATE_COLOUR, 0.82) }, radiusMm: 6 },
    territory: { spec: { ...SLAB, colour: shade(SLATE_COLOUR, 1.14) }, radiusMm: 3, insetMm: 0 },
    plaque: { spec: { model: 'standard', colour: '#20242b', roughness: 0.5, metalness: 0 }, lengthMm: 128, heightMm: 46, baseMm: -PLINTH_DROP_MM, outline: '#3a414d' },
    glyph: { sizeMm: 14, offsetMm: 44 },
  },
};

function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    widthPx: kind === 'attack' || kind === 'block' ? 3 : 2,
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'stroke',
    glow: 0,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'chevron',
    pulseMs: 240,
    animation: 'none',
    ornament: 'plain',
  };
}

/** The Graphite theme. */
export const graphite: Theme = {
  id: 'graphite',
  label: 'Graphite',
  tokens: {
    colours: {
      bg: '#16191e',
      fg: '#e9ecf0',
      muted: '#9aa3ae',
      surface: GRAPHITE_SURFACE,
      // Hairline territories and pile slots: quiet, but visible on the slate and its lighter layers.
      border: '#434b58',
      accent: '#3fd2a3',
      danger: '#ff6b6b',
      warning: '#f2c14e',
      focus: '#8fc4ff',
      seats: SEATS,
    },
    type: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', size: 14, small: 11, large: 17, weight: 400, weightBold: 600 },
    radii: { sm: 6, md: 10, lg: 12 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    hud: {
      scheme: 'dark',
      panel: '#20242b',
      panelBorder: '#323843',
      shadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.28)',
      blur: 0,
      overlay: 'rgba(8, 10, 13, 0.72)',
    },
  },
  // Nearly straight down: the precise instrument (still in depth, the slab's edge and plinth show).
  camera: { defaultRig: 'birdseye', tilt: 0.8 },
  build: (ctx) => buildWorld(ctx, { ...GRAPHITE_WORLD, seats: SEATS }),
  cardDressing: {
    sleeve: '#0d0f12',
    thickness: 0.6,
    back: GRAPHITE_BACK,
    hover: { colour: '#9aa3ae', width: 0.8, lift: 0, glow: 0 },
    selected: { colour: '#3fd2a3', width: 2, lift: 0, glow: 0 },
    tappedBadge: '#e9ecf0',
    displacedMarker: '#e9ecf0',
    ghost: { colour: '#c4ccd6', opacity: 0.5, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    sleeveMaterial: { model: 'standard', colour: '#111418', roughness: 0.5, metalness: 0 },
    edge: '#1a1d22',
    faceShade: 0.02,
    held: { lift: 12, tiltDeg: 4, shadow: true },
    pending: { colour: '#f4f6f8', width: 1.6, lift: 0, glow: 0 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  sounds: soundSet({ hiss: 1900, knock: 220, paper: 3400, level: 0.7, chime: [880, 1318.51], chimeWave: 'sine', ring: 0.7 }, true),
  quality: [
    { id: 'high', shadows: true, post: false, particles: false, pixelRatio: 2, anisotropy: 8, msaa: 0 },
    { id: 'medium', shadows: false, post: false, particles: false, pixelRatio: 1.5, anisotropy: 4, msaa: 0 },
    { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1, msaa: 0 },
  ],
  lighting: {
    lit: true,
    lights: [
      { kind: 'hemisphere', sky: '#e3e9f3', ground: '#0c0e11', intensity: 1.5 },
      // The key: cool white from the viewer's upper left, low enough to rake the grain and light the slab's chamfer.
      { kind: 'directional', colour: '#f4f7ff', intensity: 1.1, position: [-700, -900, 1500], target: [0, 0, 0], castShadow: false },
      // A soft overhead pool, so the middle of the table is a little brighter than its corners.
      { kind: 'spot', colour: '#ffffff', intensity: 0.9, position: [0, -200, 2600], target: [0, 0, 0], angleDeg: 50, penumbra: 1, decay: 0, distance: 0, castShadow: false },
    ],
    toneMapping: 'none',
    exposure: 1,
    background: GRAPHITE_BACKGROUND,
    fog: null,
  },
  shadows: { enabled: true, map: null, contact: { opacity: 0.55, blurMm: 4.5, heightMm: 36 } },
  post: { bloom: null, vignette: null },
  // Precise: less sway and bounce than the default.
  feel: { sway: { ...DEFAULT_CARD_FEEL.sway, maxDeg: 5 }, settle: { ...DEFAULT_CARD_FEEL.settle, bounce: 0.08 } },
};
