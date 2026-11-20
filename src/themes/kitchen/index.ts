/**
 * A · Kitchen Table, the look's 3D table world (PLAN Milestone 7, Owner decisions after the first design round; PLAN
 * M7-P1: "linen playmat, walnut frame, warm light, soft short card shadows"; docs/design/m7-directions.html, Direction
 * A: "an oatmeal playmat on walnut, cream paper chips … The table surface is a light oatmeal linen, so black-bordered
 * cards sit on it with the most contrast of the three; the wood only frames the edges"). Loaded lazily as its own chunk.
 *
 * - Table: a linen playmat (woven albedo and normal map, kit/surfaces.ts) exactly over the layout's table, lying on a
 *   walnut board whose bevelled edge frames it and shows in first person; a baked soft skirt where the mat meets the
 *   wood (kit/look.ts).
 * - Light: a warm pendant lamp above the table, toward the viewer, its soft penumbra a gentle pool, and a warm sky and
 *   walnut-bounce fill; no shadow maps, no post-processing (Safari: PLAN Milestone 7, A0), no tone mapping, so the
 *   linen keeps the colour the tokens say.
 * - Card shadows: soft, short contact shadows (the pipeline's), longer and lighter as a card lifts.
 * - Marks: pile beds printed a shade darker into the linen, a quieter bed for the command area, and a cream paper chip
 *   at each named chair with the seat's glyph in its colour (kit/marks.ts).
 * - Cards: 0.6 mm boxes in dark brown sleeves, faces near-unlit (faceShade 0.02 ≤ CARD_FACE_MAX_SHADE), a brass
 *   selection and a brick-red pending outline, the look's own geometric back.
 * - Seat colours: deep, warm-friendly inks for the light linen (SEAT_CONTRAST), cream ink on them.
 * - Sound: cloth and wood (kit/sounds.ts).
 */
import { DEFAULT_CARD_FEEL } from '../../scene/types';
import { buildWorld, type WorldSpec } from '../kit/look';
import { shade } from '../kit/procedural';
import { soundSet } from '../kit/sounds';
import { PATTERN_DASH } from '../paper/index';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type MaterialSpec, type SeatColour, type Theme } from '../types';
import { KITCHEN_BACK, LINEN, LINEN_TILE_MM, WALNUT, WALNUT_TILE_MM } from './textures';

/**
 * The linen as the HUD and the contrast rules see it (tokens.colours.surface): the lamp-lit cloth on screen half-way
 * between the middle of the table and its corners (measured by tests/e2e/themes/looks.spec.ts).
 */
/** What frames the table on screen (the look's `frame` token; docs/design/m8/m7-adjustments.md, M7-P1). */
export const KITCHEN_SURROUND = '#5b3f2c';

export const KITCHEN_SURFACE = '#d9ccb2';

/** The room around the table (first person looks past the far edge). */
export const KITCHEN_BACKGROUND = '#2a1e16';

/** The linen's colour, multiplied by the woven grey of LINEN.albedo. */
export const LINEN_COLOUR = '#e6ecea';

/** The playmat. */
export const MAT: MaterialSpec = {
  model: 'standard',
  colour: LINEN_COLOUR,
  roughness: 0.94,
  metalness: 0,
  tileMm: LINEN_TILE_MM,
  normalScale: 0.55,
  maps: { albedo: { kind: 'procedural', source: LINEN.albedo }, normal: { kind: 'procedural', source: LINEN.normal } },
};

/** The walnut board (its colour is in the planks' albedo). */
export const BOARD: MaterialSpec = { model: 'standard', colour: '#ffffff', roughness: 0.5, metalness: 0, tileMm: WALNUT_TILE_MM, maps: { albedo: { kind: 'procedural', source: WALNUT } } };

/** Width of the walnut beyond the playmat on every side, mm: wider than the avatar spots outside each edge. */
export const BOARD_MM = 84;

/** Eight seat colours for the linen (SEAT_CONTRAST against KITCHEN_SURFACE), cream ink; pattern and glyph as in every theme. */
const SEATS: SeatColour[] = [
  { index: 0, colour: '#2f6f9f', pattern: 'solid', glyph: 'circle', ink: '#fff8ef' },
  { index: 1, colour: '#8a4f7d', pattern: 'dash', glyph: 'square', ink: '#fff8ef' },
  { index: 2, colour: '#3d6b35', pattern: 'dot', glyph: 'triangle', ink: '#fff8ef' },
  { index: 3, colour: '#8a5a00', pattern: 'dash-dot', glyph: 'diamond', ink: '#fff8ef' },
  { index: 4, colour: '#1f6f73', pattern: 'long-dash', glyph: 'star', ink: '#fff8ef' },
  { index: 5, colour: '#6a4fb0', pattern: 'dash-dot-dot', glyph: 'hexagon', ink: '#fff8ef' },
  { index: 6, colour: '#a33a5a', pattern: 'double', glyph: 'cross', ink: '#fff8ef' },
  { index: 7, colour: '#5c5e14', pattern: 'zigzag', glyph: 'ring', ink: '#fff8ef' },
];

/** The world: walnut board, linen playmat, the skirt where they meet, and the marks. */
export const KITCHEN_WORLD: Omit<WorldSpec, 'seats'> = {
  name: 'kitchen',
  surface: KITCHEN_SURFACE,
  surround: KITCHEN_SURROUND,
  slabs: [
    { name: 'board', spec: BOARD, growMm: BOARD_MM, radiusMm: 26, top: -1.6, depth: 38, bevel: 5 },
    { name: 'mat', spec: MAT, growMm: 0, radiusMm: 18, top: 0, depth: 1.6, bevel: 0.5 },
  ],
  skirts: [{ growMm: 0, radiusMm: 18, spreadMm: 6, opacity: 0.32, at: -1.58, colour: '#1e130b' }],
  marks: {
    top: 0,
    bed: { spec: { ...MAT, colour: shade(LINEN_COLOUR, 0.88) }, padMm: 3, radiusMm: 5 },
    area: { spec: { ...MAT, colour: shade(LINEN_COLOUR, 0.94) }, radiusMm: 10 },
    territory: null,
    plaque: { spec: { model: 'standard', colour: '#f7f1e5', roughness: 0.85, metalness: 0 }, lengthMm: 128, heightMm: 46, baseMm: -1.6, outline: null },
    glyph: { sizeMm: 15, offsetMm: 44 },
  },
};

function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    // Combat reads first (docs/design/m7-critique.md, Card handling 7: "the attack and block lines are thin").
    widthPx: kind === 'attack' || kind === 'block' ? 3.5 : 2.5,
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'stroke',
    glow: 0,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'triangle',
    pulseMs: 320,
    animation: 'none',
    ornament: 'plain',
  };
}

/** The Kitchen Table theme. */
export const kitchen: Theme = {
  id: 'kitchen',
  label: 'Kitchen Table',
  tokens: {
    colours: {
      bg: '#f7f1e5',
      fg: '#2b2118',
      // Zone labels on the linen and quiet HUD text on paper chips.
      muted: '#5f5140',
      surface: KITCHEN_SURFACE,
      // Zone hairlines: a walnut-brown stitch on the linen.
      border: '#8f7a5c',
      accent: '#b94f2c', // the look's accent token (M7-P2 tuned it for AA)
      danger: '#9e2a2b',
      warning: '#8a5a00',
      focus: '#2f6f9f',
      seats: SEATS,
    },
    type: { family: 'ui-rounded, "SF Pro Rounded", "Avenir Next", "Segoe UI", system-ui, sans-serif', mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', size: 14, small: 12, large: 18, weight: 500, weightBold: 800 },
    radii: { sm: 8, md: 14, lg: 22 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    hud: {
      scheme: 'light',
      panel: '#f7f1e5',
      panelBorder: '#cdbd9f',
      shadow: '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 2px 0 rgba(70, 48, 30, 0.12), 0 6px 14px rgba(70, 48, 30, 0.16)',
      blur: 0,
      overlay: 'rgba(43, 33, 24, 0.55)',
    },
  },
  // Leaning in: the table in depth, the near side large (PLAN Milestone 7, One continuous tilt; scene/types.ts TILT_PRESETS).
  camera: { defaultRig: 'birdseye', tilt: 0.55 },
  build: (ctx) => buildWorld(ctx, { ...KITCHEN_WORLD, seats: SEATS }),
  cardDressing: {
    sleeve: '#1d1712',
    thickness: 0.6,
    back: KITCHEN_BACK,
    hover: { colour: '#5b4a36', width: 0.8, lift: 0, glow: 0 },
    selected: { colour: '#b08a3e', width: 2, lift: 0, glow: 0 },
    tappedBadge: '#2b2118',
    displacedMarker: '#2b2118',
    ghost: { colour: '#5b4a36', opacity: 0.55, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    sleeveMaterial: { model: 'standard', colour: '#1d1712', roughness: 0.7, metalness: 0 },
    edge: '#2a221b',
    faceShade: 0.02,
    held: { lift: 12, tiltDeg: 4, shadow: true },
    // The brick red of "the thing to do next" (the look's primary colour), apart from every seat colour.
    pending: { colour: '#c0532f', width: 1.6, lift: 0, glow: 0 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  sounds: soundSet({ hiss: 1100, knock: 160, paper: 2600, level: 0.9, chime: [523.25, 659.25], chimeWave: 'sine', ring: 1 }, true),
  quality: [
    { id: 'high', shadows: true, post: false, particles: false, pixelRatio: 2, anisotropy: 8, msaa: 0 },
    { id: 'medium', shadows: false, post: false, particles: false, pixelRatio: 1.5, anisotropy: 4, msaa: 0 },
    { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1, msaa: 0 },
  ],
  lighting: {
    lit: true,
    lights: [
      // Warm sky light from the room, walnut-brown bounce from below.
      { kind: 'hemisphere', sky: '#fff1dc', ground: '#6b4a33', intensity: 1.45 },
      // The pendant lamp: warm (about 3000 K), high over the table and a little toward the viewer, a soft wide pool.
      { kind: 'spot', colour: '#ffe6c4', intensity: 2.2, position: [0, -350, 2400], target: [0, 60, 0], angleDeg: 46, penumbra: 1, decay: 0, distance: 0, castShadow: false },
    ],
    toneMapping: 'none',
    exposure: 1,
    background: KITCHEN_BACKGROUND,
    fog: null,
  },
  shadows: { enabled: true, map: null, contact: { opacity: 0.38, blurMm: 3.5, heightMm: 30 } },
  post: { bloom: null, vignette: null },
  // A little playful: a touch more settle bounce than the default.
  feel: { settle: { ...DEFAULT_CARD_FEEL.settle, bounce: 0.2 } },
};
