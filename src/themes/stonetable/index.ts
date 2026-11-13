/**
 * Stonetable: physically rendered 3D (DESIGN "Themes and rendering", theme table): a carved stone slab with PBR
 * materials, a torch-like key light, real shadows, cards with thickness and a slight lift when held, glowing runes for
 * lines, dust motes in the light; ego camera by default. Loaded lazily by themes/index.ts loadTheme. M4-P5.
 *
 * - Table and effects: table.ts (slab, rune band, motes), stone.ts (procedural stone maps), runes.ts (rune band and
 *   card back), motes.ts; light rig and tone: rig.ts; sound set: sounds.ts. All assets are procedural (docs/ASSETS.md).
 * - Card faces are never restyled: faces are near-unlit (faceShade well under CARD_FACE_MAX_SHADE) and drawn after the
 *   post-processing chain (scene/post.ts), so torchlight, tone mapping, bloom and vignette never reach a printed face.
 * - Seat colours are bright "rune light" tones tuned against the dark stone (themes/signals.ts SEAT_CONTRAST) and keep
 *   Paper's patterns and glyphs, so no seat depends on hue alone.
 */
import { DEFAULT_MOTION, type LineKind, type LineStyle, type QualityLevel, type SeatColour, type Theme } from '../types';
import { PATTERN_DASH } from '../paper/index';
import { STONETABLE_LIGHTING } from './rig';
import { STONE_BACK } from './runes';
import { STONETABLE_SOUNDS } from './sounds';
import { buildStonetable } from './table';

/** The stone's nominal colour: the average of the slab's albedo (stone.ts), as the HUD and the card shader see it. */
export const STONE_SURFACE = '#5d5b56';

/** HUD page background and panels: the dark hall around the slab. */
const BG = '#14120f';
const INK = '#14120f';

const SEATS: SeatColour[] = [
  { index: 0, colour: '#6ec3ff', pattern: 'solid', glyph: 'circle', ink: INK },
  { index: 1, colour: '#ff9484', pattern: 'dash', glyph: 'square', ink: INK },
  { index: 2, colour: '#7fe08f', pattern: 'dot', glyph: 'triangle', ink: INK },
  { index: 3, colour: '#c9a2ff', pattern: 'dash-dot', glyph: 'diamond', ink: INK },
  { index: 4, colour: '#ffc04d', pattern: 'long-dash', glyph: 'star', ink: INK },
  { index: 5, colour: '#4fe3d6', pattern: 'dash-dot-dot', glyph: 'hexagon', ink: INK },
  { index: 6, colour: '#ff8fd6', pattern: 'double', glyph: 'cross', ink: INK },
  { index: 7, colour: '#d9e07a', pattern: 'zigzag', glyph: 'ring', ink: INK },
];

/**
 * Lines are glowing runes (DESIGN theme table, Stonetable: "Glowing runes for lines"): a ribbon in the seat's colour,
 * thicker than Paper's stroke, glowing under the bloom, flowing toward the target, with the seat's dash pattern and a
 * chevron head. `ornament: 'runes'` asks the line layer for rune marks along the ribbon (drawn as the plain glowing
 * ribbon until the scene's line layer draws ornaments; docs/DECISIONS.md M4-P5).
 */
function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    widthPx: kind === 'mark' ? 2 : 2.5,
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'ribbon',
    glow: kind === 'mark' ? 0.5 : 0.85,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'chevron',
    pulseMs: 450,
    animation: kind === 'mark' ? 'none' : 'flow',
    ornament: 'runes',
  };
}

/** Best first; shadows go first, then post-processing, then the motes, then the pixel ratio (QUALITY_DROP_ORDER). */
const QUALITY: QualityLevel[] = [
  { id: 'high', shadows: true, post: true, particles: true, pixelRatio: 2, shadowMapSize: 2048, anisotropy: 8, msaa: 4 },
  { id: 'medium', shadows: false, post: true, particles: true, pixelRatio: 2, anisotropy: 4, msaa: 2 },
  { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 2, msaa: 0 },
];

/** The Stonetable theme (DESIGN "Themes and rendering"). */
export const stonetable: Theme = {
  id: 'stonetable',
  label: 'Stonetable',
  tokens: {
    colours: {
      bg: BG,
      fg: '#efe7d6',
      muted: '#bdb39d',
      surface: STONE_SURFACE,
      // Chalked zone lines on the stone: at least 3:1 against it (WCAG 1.4.11), like Paper's hairlines.
      border: '#cfc5ae',
      accent: '#8fe0ff',
      danger: '#ff7a68',
      warning: '#ffbe55',
      focus: '#8fe0ff',
      seats: SEATS,
    },
    type: { family: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", mono: 'ui-monospace, monospace', size: 14, small: 12, large: 18, weight: 400, weightBold: 700 },
    radii: { sm: 2, md: 4, lg: 6 },
    spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
    hud: {
      scheme: 'dark',
      panel: 'rgba(26, 23, 19, 0.94)',
      panelBorder: '#5e5547',
      shadow: '0 6px 24px rgba(0, 0, 0, 0.55)',
      blur: 6,
      overlay: 'rgba(10, 9, 7, 0.9)',
    },
  },
  camera: { defaultRig: 'ego' },
  build: buildStonetable,
  cardDressing: {
    sleeve: '#1c1a17',
    thickness: 0.6,
    back: STONE_BACK,
    hover: { colour: '#f3dca4', width: 0.9, lift: 0, glow: 0.4 },
    selected: { colour: '#8fe0ff', width: 1.6, lift: 0, glow: 0.8 },
    tappedBadge: '#f3dca4',
    displacedMarker: '#f3dca4',
    ghost: { colour: '#efe7d6', opacity: 0.5, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    // A matte black sleeve that takes the torchlight, cream card-stock edges.
    sleeveMaterial: { model: 'physical', colour: '#1c1a17', roughness: 0.55, metalness: 0, clearcoat: 0.35 },
    edge: '#d9d0bd',
    // Well under CARD_FACE_MAX_SHADE: the torch may darken a face by at most 2%, never tint it.
    faceShade: 0.02,
    held: { lift: 12, tiltDeg: 4, shadow: true },
    pending: { colour: '#ffbe55', width: 1.6, lift: 0, glow: 0.7 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  sounds: STONETABLE_SOUNDS,
  quality: QUALITY,
  lighting: STONETABLE_LIGHTING,
  shadows: {
    enabled: true,
    map: { type: 'pcf', mapSize: 2048, bias: -0.0004, normalBias: 0.4, radius: 3 },
    contact: { opacity: 0.4, blurMm: 3, heightMm: 30 },
  },
  post: { bloom: { strength: 0.55, radius: 0.45, threshold: 0.42 }, vignette: { darkness: 1.2, offset: 1.0 } },
};
