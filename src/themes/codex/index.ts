/**
 * C · Codex, the look's 3D table world (PLAN M7-P1: "midnight blue, gilt hairlines and diamond corners, restrained; no
 * particles or glow"; docs/design/m7-directions.html, Direction C: "A spellbook on a library desk, not a dragon's lair.
 * The table is a deep midnight-blue, faintly tooled with a geometric knot pattern and framed by a thin gilt line with
 * diamond corners … No particles, no glow"). Loaded lazily as its own chunk.
 *
 * - Table: midnight leather tooled with a lattice (kit/surfaces.ts) over the layout's table and a 6 mm margin, set on a
 *   dark ebony desk whose bevelled edge frames it in first person; a baked soft skirt where leather meets wood; a gilt
 *   hairline at the leather's edge, and gilt diamonds at the table's corners (with the scene's own hairline at the
 *   table edge, a double rule).
 * - Light: a warm reading lamp over the table, a little to the viewer's left, its penumbra a soft pool; a dim
 *   moonlit-blue fill. No shadow maps, no post-processing, no tone mapping, no flicker.
 * - Marks: pile beds a shade darker in the leather, a quieter command bed, leather plaques edged in gilt at named
 *   chairs with the seat's glyph in its colour.
 * - Cards: 0.6 mm boxes in ink-blue sleeves, faces near-unlit, a light-gilt selection, a vermilion pending outline (the
 *   look's seal).
 * - Seat colours: light, slightly muted colours for the navy, dark ink on them.
 * - Sound: leather and parchment, a soft bell (kit/sounds.ts).
 */
import * as THREE from 'three';
import { DEFAULT_CARD_FEEL } from '../../scene/types';
import { buildWorld, type WorldSpec } from '../kit/look';
import { shade } from '../kit/procedural';
import { soundSet } from '../kit/sounds';
import { lineGeometry, loopSegments, merge, roundedRectPoints, type Parts } from '../kit/world';
import { PATTERN_DASH } from '../paper/index';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type MaterialSpec, type SeatColour, type Theme } from '../types';
import { CODEX_BACK, EBONY, EBONY_TILE_MM, LEATHER, LEATHER_TILE_MM } from './textures';

/** The leather as the HUD and the contrast rules see it (tokens.colours.surface), measured half-way out (tests/e2e/themes/looks.spec.ts). */
/** What frames the table on screen (the look's `frame` token; docs/design/m8/m7-adjustments.md, M7-P1). */
export const CODEX_SURROUND = '#141a29';

export const CODEX_SURFACE = '#1b2235';

export const CODEX_BACKGROUND = '#0b0e17';

/** The gilt of hairlines and diamonds (docs/design/m7-directions.html: gilt hairline #c8a75e). */
export const GILT = '#c8a75e';

/** The leather (its colour is in the albedo; this tints it). */
/** The leather's colour under the warm lamp, multiplied by LEATHER.albedo: tuned so the table reads as the `mat` token from above. */
export const LEATHER_COLOUR = '#a1c9ff';

export const LEATHER_SPEC: MaterialSpec = {
  model: 'standard',
  colour: LEATHER_COLOUR,
  roughness: 0.8,
  metalness: 0,
  tileMm: LEATHER_TILE_MM,
  normalScale: 0.7,
  maps: { albedo: { kind: 'procedural', source: LEATHER.albedo }, normal: { kind: 'procedural', source: LEATHER.normal } },
};

/** The ebony's own colour: under the warm lamp it reads browner and, from above, brighter than the navy `frame` token (the looks spec states how far). */
export const DESK_COLOUR = '#ffffff';
export const DESK: MaterialSpec = { model: 'standard', colour: DESK_COLOUR, roughness: 0.42, metalness: 0, tileMm: EBONY_TILE_MM, maps: { albedo: { kind: 'procedural', source: EBONY } } };

/** The gilt of the corner diamonds: a warm, slightly metallic leaf that catches the lamp. */
export const GILT_SPEC: MaterialSpec = { model: 'standard', colour: GILT, roughness: 0.35, metalness: 0.3 };

/** The leather's margin beyond the layout's table, and the desk beyond that, mm. */
export const LEATHER_MARGIN_MM = 6;
export const DESK_MM = 72;
/** Size of the corner diamonds (tip to tip), mm. */
export const DIAMOND_MM = 16;

const SEATS: SeatColour[] = [
  { index: 0, colour: '#7fb0e0', pattern: 'solid', glyph: 'circle', ink: '#141a29' },
  { index: 1, colour: '#e0a070', pattern: 'dash', glyph: 'square', ink: '#141a29' },
  { index: 2, colour: '#9fd0a0', pattern: 'dot', glyph: 'triangle', ink: '#141a29' },
  { index: 3, colour: '#c4a8e8', pattern: 'dash-dot', glyph: 'diamond', ink: '#141a29' },
  { index: 4, colour: '#e8e0a0', pattern: 'long-dash', glyph: 'star', ink: '#141a29' },
  { index: 5, colour: '#6fcfcf', pattern: 'dash-dot-dot', glyph: 'hexagon', ink: '#141a29' },
  { index: 6, colour: '#f0a0c0', pattern: 'double', glyph: 'cross', ink: '#141a29' },
  { index: 7, colour: '#c0c870', pattern: 'zigzag', glyph: 'ring', ink: '#141a29' },
];

/** A diamond's outline (tip to tip `s`) at (x, y). */
function diamondPoints(x: number, y: number, s: number): THREE.Vector2[] {
  const r = s / 2;
  return [new THREE.Vector2(x, y - r), new THREE.Vector2(x + r, y), new THREE.Vector2(x, y + r), new THREE.Vector2(x - r, y)];
}

/** The gilt rule at the leather's edge and a gilt diamond with an ink-blue heart at each corner of the table. */
function ornament(parts: Parts, table: { w: number; d: number }): THREE.Object3D[] {
  const rule = new THREE.LineSegments(
    parts.geometry(lineGeometry(loopSegments(roundedRectPoints(table.w + 2 * LEATHER_MARGIN_MM - 2, table.d + 2 * LEATHER_MARGIN_MM - 2, 2)), 0.03)),
    parts.own(new THREE.LineBasicMaterial({ color: GILT, toneMapped: false })),
  );
  rule.name = 'codex-rule';
  rule.renderOrder = 1;
  const corners = [
    [-table.w / 2, -table.d / 2],
    [table.w / 2, -table.d / 2],
    [table.w / 2, table.d / 2],
    [-table.w / 2, table.d / 2],
  ] as const;
  const shapes = (s: number, colour: string, h: number) =>
    corners.map(([x, y]) => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(diamondPoints(x, y, s)));
      g.rotateX(-Math.PI / 2);
      g.translate(0, h, 0);
      const c = new THREE.Color(colour);
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
      return g;
    });
  const geo = merge([...shapes(DIAMOND_MM, '#ffffff', 0.02), ...shapes(DIAMOND_MM * 0.6, '#1b2235', 0.04)]);
  const material = parts.overlay(GILT_SPEC, 3) as THREE.MeshStandardMaterial;
  material.vertexColors = true;
  const diamonds = new THREE.Mesh(parts.geometry(geo!), material);
  diamonds.name = 'codex-diamonds';
  diamonds.renderOrder = 3;
  return [rule, diamonds];
}

export const CODEX_WORLD: Omit<WorldSpec, 'seats'> = {
  name: 'codex',
  surface: CODEX_SURFACE,
  surround: CODEX_SURROUND,
  slabs: [
    { name: 'desk', spec: DESK, growMm: DESK_MM, radiusMm: 4, top: -2, depth: 42, bevel: 3 },
    { name: 'leather', spec: LEATHER_SPEC, growMm: LEATHER_MARGIN_MM, radiusMm: 3, top: 0, depth: 2, bevel: 0.6 },
  ],
  skirts: [{ growMm: LEATHER_MARGIN_MM, radiusMm: 3, spreadMm: 7, opacity: 0.5, at: -1.98, colour: '#000000' }],
  marks: {
    top: 0,
    bed: { spec: { ...LEATHER_SPEC, colour: shade(LEATHER_COLOUR, 0.74) }, padMm: 3, radiusMm: 2 },
    area: { spec: { ...LEATHER_SPEC, colour: shade(LEATHER_COLOUR, 0.86) }, radiusMm: 3 },
    territory: null,
    plaque: { spec: LEATHER_SPEC, lengthMm: 128, heightMm: 44, baseMm: -2, outline: GILT },
    glyph: { sizeMm: 14, offsetMm: 44 },
  },
  ornament,
};

function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    widthPx: kind === 'attack' || kind === 'block' ? 3.2 : 2.2,
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'stroke',
    // Restrained: no glow (PLAN M7-P1: "no particles or glow").
    glow: 0,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'triangle',
    pulseMs: 360,
    animation: 'none',
    ornament: 'plain',
  };
}

/** The Codex theme. */
export const codex: Theme = {
  id: 'codex',
  label: 'Codex',
  tokens: {
    colours: {
      bg: '#141a29',
      fg: '#efe6d2',
      muted: '#a99f8c',
      surface: CODEX_SURFACE,
      // Zone hairlines: gilt, muted to sit quietly on the leather.
      border: '#8a7444',
      accent: '#b8432f',
      danger: '#ff7a66',
      warning: '#e0b46a',
      focus: '#e0c27a',
      seats: SEATS,
    },
    type: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', size: 14, small: 12, large: 18, weight: 400, weightBold: 600 },
    radii: { sm: 3, md: 6, lg: 6 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    hud: {
      scheme: 'dark',
      panel: '#242c42',
      panelBorder: '#7a6842',
      shadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
      blur: 0,
      overlay: 'rgba(10, 13, 22, 0.8)',
    },
  },
  camera: { defaultRig: 'birdseye', tilt: 0.5 },
  build: (ctx) => buildWorld(ctx, { ...CODEX_WORLD, seats: SEATS }),
  cardDressing: {
    sleeve: '#141a29',
    thickness: 0.6,
    back: CODEX_BACK,
    hover: { colour: '#a99f8c', width: 0.8, lift: 0, glow: 0 },
    selected: { colour: '#e0c27a', width: 2, lift: 0, glow: 0 },
    tappedBadge: '#efe6d2',
    displacedMarker: '#efe6d2',
    ghost: { colour: '#d8ccb0', opacity: 0.5, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    sleeveMaterial: { model: 'standard', colour: '#161c2b', roughness: 0.6, metalness: 0 },
    edge: '#1f2638',
    faceShade: 0.02,
    held: { lift: 12, tiltDeg: 4, shadow: true },
    // The vermilion seal: the look's one warm accent.
    pending: { colour: '#e0654c', width: 1.6, lift: 0, glow: 0 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  sounds: soundSet({ hiss: 800, knock: 120, paper: 2200, level: 0.8, chime: [392, 587.33], chimeWave: 'sine', ring: 1.4 }, true),
  quality: [
    { id: 'high', shadows: true, post: false, particles: false, pixelRatio: 2, anisotropy: 8, msaa: 0 },
    { id: 'medium', shadows: false, post: false, particles: false, pixelRatio: 1.5, anisotropy: 4, msaa: 0 },
    { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1, msaa: 0 },
  ],
  lighting: {
    lit: true,
    lights: [
      { kind: 'hemisphere', sky: '#9fb0e0', ground: '#10141f', intensity: 1.3 },
      { kind: 'spot', colour: '#ffdcae', intensity: 2.4, position: [-200, -450, 2300], target: [0, 40, 0], angleDeg: 48, penumbra: 1, decay: 0, distance: 0, castShadow: false },
    ],
    toneMapping: 'none',
    exposure: 1,
    background: CODEX_BACKGROUND,
    fog: null,
  },
  shadows: { enabled: true, map: null, contact: { opacity: 0.5, blurMm: 4, heightMm: 34 } },
  post: { bloom: null, vignette: null },
  // Weighty: a slower lift and a small settle.
  feel: { liftMs: 150, settle: { ...DEFAULT_CARD_FEEL.settle, bounce: 0.1 } },
};
