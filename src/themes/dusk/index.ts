/**
 * Dusk: moody, low-key (DESIGN "Themes and rendering", theme table): "Dark felt under a single warm lamp, soft contact
 * shadows, vignette"; lines and effects: "Soft bloom on lines, slow light falloff, muted ambience"; default camera:
 * "Bird's-eye, slightly tilted". Loaded lazily by themes/index.ts loadTheme as its own chunk. Implemented by M4-P3.
 *
 * - Table: dark green felt with a procedural nap and a dark wooden rail (themes/dusk/table.ts, textures.ts).
 * - Light: one warm spot lamp above the table, a little toward the viewer, with a soft wide penumbra, so the light
 *   falls off slowly toward the edges; a faint cool ambient keeps the far corners from going black. No shadow maps:
 *   soft contact shadows under the cards (the pipeline's, scene/cards.ts ContactShadows), ACES tone mapping.
 * - Post: a soft bloom whose threshold sits above everything on the table (felt, rail, zone hairlines, labels) and
 *   below every seat colour, so the lines glow and the table does not (DUSK_BLOOM_THRESHOLD; the pipeline draws the
 *   lines into the bloomed image, decision M4-P2); a vignette.
 * - Cards: 0.6 mm boxes in dark matte sleeves with a little gloss, faces near-unlit (faceShade 0.02 ≤
 *   CARD_FACE_MAX_SHADE), Dusk's own geometric back, warm brass hover and selection outlines.
 * - Seat colours: light pastels tuned for the dark felt (SEAT_CONTRAST), each brighter than the bloom threshold.
 * - HUD: dark tokens (scheme 'dark', translucent panels, warm accent).
 * - Sound: a muted procedural set with a quiet room tone (themes/dusk/sounds.ts).
 */
import { PATTERN_DASH } from '../paper/index';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type SeatColour, type Theme } from '../types';
import { DUSK_SOUNDS } from './sounds';
import { buildDusk } from './table';
import { DUSK_BACK } from './textures';

/**
 * The felt as the HUD and the contrast rules see it (tokens.colours.surface): the lamp-lit cloth's colour on screen
 * half-way between the middle of the table and its corners (measured by tests/e2e/themes/dusk/look.spec.ts).
 */
export const DUSK_SURFACE = '#1d3520';

/** The room around the table. */
export const DUSK_BACKGROUND = '#09080c';

/**
 * Bloom threshold: three's LuminosityHighPassShader compares the linear luminance of the world image (Rec. 709
 * weights, the same as WCAG relative luminance of a colour) with it. It sits above the lit felt, the rail, the zone
 * hairlines and the zone labels (muted), and below every seat colour, so only lines (and ghost outlines) glow.
 */
export const DUSK_BLOOM_THRESHOLD = 0.34;

/**
 * Vignette (three's VignetteShader mixes toward 1 − darkness): a darkness above 1 pushes colours below zero before
 * tone mapping, which ACES turns into grey and coloured fringes, so Dusk stays at 1 (black at the far corners).
 */
export const DUSK_VIGNETTE = { darkness: 1, offset: 1 } as const;

/** Eight seat colours for the dark felt (SEAT_CONTRAST): light pastels, dark ink on them; pattern and glyph as in every theme. */
const SEATS: SeatColour[] = [
  { index: 0, colour: '#6fb3ff', pattern: 'solid', glyph: 'circle', ink: '#0d1016', glow: '#8cc4ff' },
  { index: 1, colour: '#ff8a7a', pattern: 'dash', glyph: 'square', ink: '#0d1016', glow: '#ffa294' },
  { index: 2, colour: '#7fe0a0', pattern: 'dot', glyph: 'triangle', ink: '#0d1016', glow: '#9cebb6' },
  { index: 3, colour: '#c8a8ff', pattern: 'dash-dot', glyph: 'diamond', ink: '#0d1016', glow: '#d8c0ff' },
  { index: 4, colour: '#ffc266', pattern: 'long-dash', glyph: 'star', ink: '#0d1016', glow: '#ffd28a' },
  { index: 5, colour: '#5fe0e6', pattern: 'dash-dot-dot', glyph: 'hexagon', ink: '#0d1016', glow: '#86eaee' },
  { index: 6, colour: '#ff9ee0', pattern: 'double', glyph: 'cross', ink: '#0d1016', glow: '#ffb8e8' },
  { index: 7, colour: '#d4ea6e', pattern: 'zigzag', glyph: 'ring', ink: '#0d1016', glow: '#e2f292' },
];

/** Lines: seat-coloured strokes, a little wider than Paper's, glowing softly through the bloom; marks dashed. */
function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    // 3 px: the bloom samples the image at half resolution, so a thinner stroke would fall under its threshold.
    widthPx: 3,
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'stroke',
    glow: 0.6,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'triangle',
    // A slower, softer pulse than Paper's on creation ("slow light falloff").
    pulseMs: 450,
    animation: 'none',
    ornament: 'plain',
  };
}

/** The Dusk theme (DESIGN "Themes and rendering"). */
export const dusk: Theme = {
  id: 'dusk',
  label: 'Dusk',
  tokens: {
    colours: {
      bg: '#121116',
      fg: '#ece6da',
      // Zone labels and quiet HUD text: 4.5:1 on the felt, a green-grey just under the bloom threshold.
      muted: '#8a9e8f',
      surface: DUSK_SURFACE,
      // Zone hairlines: 3:1 against the felt (WCAG 1.4.11), under the bloom threshold so they stay crisp.
      border: '#728379',
      accent: '#e9b872',
      danger: '#ff7b6e',
      warning: '#ffc266',
      focus: '#ffd28a',
      seats: SEATS,
    },
    type: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", mono: 'ui-monospace, monospace', size: 14, small: 12, large: 18, weight: 400, weightBold: 600 },
    radii: { sm: 3, md: 6, lg: 10 },
    spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
    hud: {
      scheme: 'dark',
      panel: 'rgba(20, 18, 24, 0.9)',
      panelBorder: '#3b3642',
      shadow: '0 6px 24px rgba(0, 0, 0, 0.55)',
      blur: 8,
      overlay: 'rgba(7, 6, 9, 0.9)',
    },
  },
  camera: { defaultRig: 'birdseye', birdseyeTiltDeg: 10 },
  build: buildDusk,
  cardDressing: {
    sleeve: '#1d1b24',
    thickness: 0.6,
    back: DUSK_BACK,
    hover: { colour: '#f0dcb4', width: 0.7, lift: 0, glow: 0.3 },
    selected: { colour: '#ffd28a', width: 1.4, lift: 0, glow: 0.6 },
    tappedBadge: '#f0dcb4',
    displacedMarker: '#f0dcb4',
    ghost: { colour: '#e8dcc4', opacity: 0.45, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    // Matte sleeves: a glossy or clear-coated top would mirror the lamp into a highlight far above the bloom threshold.
    sleeveMaterial: { model: 'standard', colour: '#1d1b24', roughness: 0.62, metalness: 0 },
    edge: '#25222c',
    faceShade: 0.02,
    held: { lift: 12, tiltDeg: 4, shadow: true },
    pending: { colour: '#ffb35c', width: 1.4, lift: 0, glow: 0.6 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  sounds: DUSK_SOUNDS,
  quality: [
    { id: 'high', shadows: true, post: true, particles: false, pixelRatio: 2, anisotropy: 8, msaa: 4 },
    { id: 'medium', shadows: false, post: true, particles: false, pixelRatio: 2, anisotropy: 4, msaa: 0 },
    { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 2, msaa: 0 },
  ],
  lighting: {
    lit: true,
    lights: [
      // Faint cool fill, so the corners outside the lamp's pool stay readable.
      { kind: 'ambient', colour: '#4a4660', intensity: 0.5 },
      // The lamp: warm (about 2700 K), high above the table and a little toward the viewer, with a soft, wide edge.
      { kind: 'spot', colour: '#ffd2a0', intensity: 4.2, position: [0, -220, 1700], target: [0, 40, 0], angleDeg: 45, penumbra: 1, decay: 0, distance: 0, castShadow: false },
    ],
    toneMapping: 'aces',
    exposure: 1.05,
    background: DUSK_BACKGROUND,
    fog: null,
  },
  shadows: { enabled: true, map: null, contact: { opacity: 0.6, blurMm: 5, heightMm: 40 } },
  post: { bloom: { strength: 0.45, radius: 0.3, threshold: DUSK_BLOOM_THRESHOLD }, vignette: { darkness: DUSK_VIGNETTE.darkness, offset: DUSK_VIGNETTE.offset } },
};
