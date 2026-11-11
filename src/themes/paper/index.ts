/**
 * Paper: the default black-on-white theme (DESIGN "Themes and rendering"). Flat white table plane, no lighting, no
 * shadows; zones are hairline outlines with small caps labels (drawn by the scene from the layout, in the theme's
 * border and muted colours); lines are crisp 1.5 px strokes in seat colours that "glow" only by a brief thickness
 * pulse; bird's-eye camera; no sound.
 */
import * as THREE from 'three';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type SceneContext, type SeatColour, type SeatPattern, type Theme, type ThemeInstance } from '../types';

const SEATS: SeatColour[] = [
  { index: 0, colour: '#1f6fd1', pattern: 'solid', glyph: 'circle' },
  { index: 1, colour: '#d1495b', pattern: 'dash', glyph: 'square' },
  { index: 2, colour: '#2a8f55', pattern: 'dot', glyph: 'triangle' },
  { index: 3, colour: '#8a4fd1', pattern: 'dash-dot', glyph: 'diamond' },
  { index: 4, colour: '#c06c00', pattern: 'long-dash', glyph: 'star' },
  { index: 5, colour: '#0f7f8f', pattern: 'dash-dot-dot', glyph: 'hexagon' },
  { index: 6, colour: '#b0408f', pattern: 'double', glyph: 'cross' },
  { index: 7, colour: '#6b6b1f', pattern: 'zigzag', glyph: 'ring' },
];

/** Dash pattern in px for a seat pattern (null = solid), so lines never depend on hue alone. */
export const PATTERN_DASH: Record<SeatPattern, number[] | null> = {
  solid: null,
  dash: [8, 5],
  dot: [2, 4],
  'dash-dot': [8, 4, 2, 4],
  'long-dash': [14, 5],
  'dash-dot-dot': [8, 3, 2, 3, 2, 3],
  double: [12, 2, 2, 2],
  zigzag: [5, 2, 5, 6],
};

/** The page around the table: a faint warm grey so the white table reads as a sheet of paper. */
export const PAPER_SURROUND = '#f1f1ee';

function buildPaper(ctx: SceneContext): ThemeInstance {
  const previousBackground = ctx.scene.background;
  ctx.scene.background = new THREE.Color(PAPER_SURROUND);
  const geometry = new THREE.PlaneGeometry(ctx.table.w, ctx.table.d);
  const material = new THREE.MeshBasicMaterial({ color: paper.tokens.colours.surface, toneMapped: false });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = 'paper-table';
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 0;
  ctx.scene.add(plane);
  return {
    update() {
      // Paper is static: no lights, no particles, no post-processing.
    },
    dispose() {
      ctx.scene.remove(plane);
      geometry.dispose();
      material.dispose();
      ctx.scene.background = previousBackground;
    },
  };
}

function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    widthPx: 1.5,
    // Persistent marks are always dashed so they read apart from targeting lines; otherwise the seat's pattern.
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'stroke',
    glow: 0,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'triangle',
    pulseMs: 300,
  };
}

/** The Paper theme (DESIGN "Themes and rendering"). */
export const paper: Theme = {
  id: 'paper',
  tokens: {
    colours: {
      bg: '#ffffff',
      fg: '#111111',
      muted: '#5f5f5f',
      surface: '#ffffff',
      // Zone hairlines must find their drop targets: at least 3:1 against the table (WCAG 1.4.11 non-text contrast).
      border: '#8c8c8c',
      accent: '#111111',
      danger: '#b3261e',
      warning: '#8a5a00',
      focus: '#1f6fd1',
      seats: SEATS,
    },
    type: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", mono: 'ui-monospace, monospace', size: 14, small: 12, large: 18, weight: 400, weightBold: 600 },
    radii: { sm: 2, md: 4, lg: 8 },
    spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
  },
  camera: { defaultRig: 'birdseye' },
  build: buildPaper,
  cardDressing: {
    sleeve: null,
    thickness: 0,
    back: null,
    hover: { colour: '#111111', width: 0.6, lift: 0 },
    selected: { colour: '#1f6fd1', width: 1.2, lift: 0 },
    tappedBadge: '#111111',
    displacedMarker: '#111111',
    ghost: { colour: '#111111', opacity: 0.25, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  quality: [{ id: 'high', shadows: false, post: false, particles: false, pixelRatio: 2 }],
};
