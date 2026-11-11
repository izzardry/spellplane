/**
 * Paper: the default black-on-white theme (DESIGN "Themes and rendering"). Contract stub from M0-C with starting
 * tokens so the HUD can map CSS variables; implementer: M0-P3 (build, dressing, line styles, tuning).
 */
import { DEFAULT_MOTION, type SeatColour, type Theme } from '../types';

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

const todo = (): never => {
  throw new Error('not implemented: M0-P3');
};

/** The Paper theme (DESIGN "Themes and rendering"). */
export const paper: Theme = {
  id: 'paper',
  tokens: {
    colours: {
      bg: '#ffffff',
      fg: '#111111',
      muted: '#5f5f5f',
      surface: '#ffffff',
      border: '#d8d8d8',
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
  build: () => todo(),
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
  lineStyle: () => todo(),
  motion: DEFAULT_MOTION,
  quality: [{ id: 'high', shadows: false, post: false, particles: false, pixelRatio: 2 }],
};
