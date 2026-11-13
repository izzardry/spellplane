/**
 * Wyrm: dragon-themed (DESIGN "Themes and rendering", theme table): an obsidian slab with a geometric scale relief and
 * ember-lit seams, fiery line glow, drifting ember particles, a heat shimmer on the stack; ego camera by default.
 * Implemented by M4-P4. Loaded lazily by themes/index.ts loadTheme (its own chunk).
 *
 * Everything is procedural (DESIGN Assets: "embers, fog, glow and rune effects are shaders"; ornament is geometric):
 * the slab's maps are computed (scales.ts), the embers and the shimmer are shaders (embers.ts, shimmer.ts), the card
 * back is drawn on a canvas (back.ts). No file is bundled, so docs/ASSETS.md lists these modules.
 *
 * Card faces keep their printed colours (DESIGN "Card faces are never restyled"): the faces are drawn by the scene's
 * near-unlit face material after post-processing, so neither the warm light, the bloom, the vignette nor the shimmer
 * reaches them; Wyrm shades them by at most 2% from the key light's angle.
 *
 * Quality (DESIGN Renderer: "drops shadows and post-processing first"): high has everything; medium drops shadow maps
 * and the shimmer (a full-screen pass) but keeps bloom, vignette and embers; low drops post-processing and the embers.
 */
import * as THREE from 'three';
import { PATTERN_DASH } from '../paper/index';
import { DEFAULT_MOTION, type LineKind, type LineStyle, type QualityId, type QualityLevel, type SceneContext, type SeatColour, type Theme, type ThemeInstance } from '../types';
import { WYRM_BACK } from './back';
import { trackWyrm, type WyrmDebugInstance } from './debug';
import { createEmbers } from './embers';
import { DEFAULT_SCALE_OPTIONS } from './scales';
import { createShimmer, SHIMMER_PASS_ID } from './shimmer';
import { advanceSeamClock, createSlab } from './slab';

/** The table surface as the HUD and the conformance checks see it: the slab's average obsidian. */
export const WYRM_SURFACE = '#17100e';

/** Ember orange of the seams and of the HUD accent. */
export const EMBER = '#ff7a2a';

/** Mix two hex colours (t = 0 → a). */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Seat colours tuned for the dark slab (DESIGN Tokens: "the eight seat colours, tuned per theme for contrast";
 * themes/signals.ts SEAT_CONTRAST): bright enough for 3:1 against the obsidian, apart from each other and from the
 * ember orange of the seams, with Paper's patterns and glyphs. Their glow leans toward the fire.
 */
const SEAT_BASE: Omit<SeatColour, 'glow' | 'ink'>[] = [
  { index: 0, colour: '#4da3ff', pattern: 'solid', glyph: 'circle' },
  { index: 1, colour: '#ff5d73', pattern: 'dash', glyph: 'square' },
  { index: 2, colour: '#56d364', pattern: 'dot', glyph: 'triangle' },
  { index: 3, colour: '#b48cff', pattern: 'dash-dot', glyph: 'diamond' },
  { index: 4, colour: '#ffd23f', pattern: 'long-dash', glyph: 'star' },
  { index: 5, colour: '#2fd8d0', pattern: 'dash-dot-dot', glyph: 'hexagon' },
  { index: 6, colour: '#ff8fd8', pattern: 'double', glyph: 'cross' },
  { index: 7, colour: '#c9d1d9', pattern: 'zigzag', glyph: 'ring' },
];

const INK = '#120a08';

export const WYRM_SEATS: SeatColour[] = SEAT_BASE.map((s) => ({ ...s, ink: INK, glow: mixHex(s.colour, EMBER, 0.2) }));

/** Which effects each quality level keeps beyond the level's own flags (the shimmer is a full-screen pass). */
export const WYRM_EFFECTS: Readonly<Record<QualityId, { shimmer: boolean }>> = { high: { shimmer: true }, medium: { shimmer: false }, low: { shimmer: false } };

/** Whether a level and the motion setting allow the heat shimmer. */
export function shimmerAllowed(level: QualityLevel, reducedMotion: boolean): boolean {
  return level.post && WYRM_EFFECTS[level.id].shimmer && !reducedMotion;
}

function buildWyrm(ctx: SceneContext): ThemeInstance {
  const slab = createSlab(ctx.table, { anisotropy: ctx.quality.anisotropy ?? 1, renderer: ctx.renderer });
  ctx.scene.add(slab.object);
  const embers = createEmbers(ctx.table, { reducedMotion: ctx.reducedMotion });
  ctx.scene.add(embers.object);
  let level = ctx.quality;
  embers.setEnabled(level.particles);
  const post = ctx.post ?? null;
  const shimmer = post ? createShimmer({ allowed: shimmerAllowed(level, ctx.reducedMotion) }) : null;
  let inChain = false;
  let time = 0;
  const buffer = new THREE.Vector2();

  const setInChain = (on: boolean) => {
    if (!post || !shimmer || on === inChain) return;
    if (on) post.addPass(SHIMMER_PASS_ID, shimmer.pass);
    else post.removePass(SHIMMER_PASS_ID);
    inChain = on;
  };

  const report = (): WyrmDebugInstance => {
    let region: { x: number; y: number; rx: number; ry: number } | null = null;
    const r = shimmer?.region;
    if (r && typeof ctx.renderer.domElement?.getBoundingClientRect === 'function') {
      const b = ctx.renderer.domElement.getBoundingClientRect();
      region = { x: b.left + r.centre[0] * b.width, y: b.top + (1 - r.centre[1]) * b.height, rx: r.radius[0] * b.width, ry: r.radius[1] * b.height };
    }
    return {
      quality: level.id,
      reducedMotion: ctx.reducedMotion,
      post: post !== null,
      embers: { count: embers.count, visible: embers.object.visible, time: embers.time },
      shimmer: shimmer
        ? { allowed: shimmer.allowed, strength: shimmer.strength, target: shimmer.target, focus: shimmer.focus, inChain, region: inChain ? region : null, time: (shimmer.pass.uniforms as { uTime: { value: number } }).uTime.value }
        : null,
      slab: { tileMm: DEFAULT_SCALE_OPTIONS.tileMm, textures: slab.textures.length, anisotropy: slab.anisotropy },
    };
  };
  const untrack = trackWyrm(report);

  return {
    update(dt) {
      if (!ctx.reducedMotion) time = advanceSeamClock(time, dt / 1000);
      slab.update(time);
      ctx.renderer.getDrawingBufferSize(buffer);
      embers.update(dt, buffer.y);
      if (shimmer) setInChain(shimmer.update(dt, ctx.camera, { w: buffer.x, h: buffer.y }, ctx.renderer.getPixelRatio()));
    },
    setQuality(next) {
      level = next;
      slab.setAnisotropy(next.anisotropy ?? 1);
      embers.setEnabled(next.particles);
      if (shimmer) {
        shimmer.setAllowed(shimmerAllowed(next, ctx.reducedMotion));
        // Off at once: the next frame must not run a pass the level dropped.
        if (!shimmer.allowed) setInChain(false);
      }
    },
    setStackFocus(at) {
      shimmer?.setFocus(at);
    },
    dispose() {
      untrack();
      setInChain(false);
      shimmer?.dispose();
      embers.dispose();
      slab.dispose();
    },
  };
}

function lineStyle(kind: LineKind, seat: SeatColour): LineStyle {
  return {
    colour: seat.colour,
    widthPx: 2.5,
    // As in Paper: persistent marks always dashed, otherwise the seat's pattern, so nothing depends on hue alone.
    dash: kind === 'mark' ? (PATTERN_DASH[seat.pattern] ?? [6, 4]) : PATTERN_DASH[seat.pattern],
    geometry: 'ribbon',
    // Fiery glow: the bloom picks the lines up; marks glow less than live lines.
    glow: kind === 'mark' ? 0.5 : 1,
    arrowhead: kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'chevron',
    pulseMs: 300,
    animation: kind === 'mark' ? 'none' : 'flicker',
    ornament: kind === 'mark' ? 'plain' : 'embers',
  };
}

/** The Wyrm theme (DESIGN "Themes and rendering"). */
export const wyrm: Theme = {
  id: 'wyrm',
  label: 'Wyrm',
  tokens: {
    colours: {
      bg: '#120a08',
      fg: '#f4e7dc',
      muted: '#b9a294',
      surface: WYRM_SURFACE,
      // Zone hairlines must find their drop targets on the dark slab: 3:1 at least (WCAG 1.4.11 non-text contrast).
      border: '#9a7262',
      accent: EMBER,
      danger: '#ff6b5b',
      warning: '#ffb547',
      focus: '#ffd166',
      seats: WYRM_SEATS,
    },
    type: { family: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", mono: 'ui-monospace, monospace', size: 14, small: 12, large: 18, weight: 400, weightBold: 700 },
    radii: { sm: 2, md: 4, lg: 8 },
    spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
    hud: {
      scheme: 'dark',
      panel: 'rgba(24, 14, 11, 0.9)',
      panelBorder: '#5c3a2c',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 12px rgba(255, 106, 32, 0.12)',
      blur: 6,
      overlay: 'rgba(10, 5, 4, 0.92)',
    },
  },
  camera: { defaultRig: 'ego' },
  build: buildWyrm,
  cardDressing: {
    sleeve: '#2e1a14',
    thickness: 0.6,
    back: WYRM_BACK,
    hover: { colour: '#ffb347', width: 0.8, lift: 0, glow: 0.6 },
    selected: { colour: '#ffd166', width: 1.4, lift: 0, glow: 0.8 },
    tappedBadge: '#ffb347',
    displacedMarker: '#ffd166',
    ghost: { colour: '#ffb36b', opacity: 0.5, dashed: true },
    faceDownOwnerOpacity: 0.5,
    foilSheen: true,
    // Dark lacquered sleeves; the printed face is drawn separately and never lit beyond faceShade.
    sleeveMaterial: { model: 'physical', colour: '#2e1a14', roughness: 0.45, metalness: 0.1, clearcoat: 0.5 },
    edge: '#d8c8b4',
    faceShade: 0.02,
    held: { lift: 12, tiltDeg: 4, shadow: true },
    pending: { colour: '#ff6a20', width: 1.4, lift: 0, glow: 1 },
  },
  lineStyle,
  motion: DEFAULT_MOTION,
  quality: [
    { id: 'high', shadows: true, post: true, particles: true, pixelRatio: 2, shadowMapSize: 2048, anisotropy: 8, msaa: 4 },
    { id: 'medium', shadows: false, post: true, particles: true, pixelRatio: 2, anisotropy: 4, msaa: 0 },
    { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1, msaa: 0 },
  ],
  lighting: {
    lit: true,
    lights: [
      { kind: 'hemisphere', sky: '#4a3430', ground: '#140806', intensity: 0.7 },
      // Key light from behind the viewer's left shoulder: casts the card shadows and shades faces by at most faceShade.
      { kind: 'directional', colour: '#ffd9b8', intensity: 1.6, position: [-600, -1000, 1600], castShadow: true },
      // Low rim light from the far side: grazes the scale relief so it reads.
      { kind: 'directional', colour: '#ff7a3a', intensity: 0.9, position: [500, 1400, 260], castShadow: false },
    ],
    toneMapping: 'neutral',
    exposure: 1.05,
    background: '#0a0504',
    fog: null,
  },
  shadows: {
    enabled: true,
    map: { type: 'pcfSoft', mapSize: 2048, bias: -0.0005, normalBias: 0.5, radius: 3 },
    contact: { opacity: 0.55, blurMm: 4, heightMm: 30 },
  },
  post: { bloom: { strength: 0.9, radius: 0.55, threshold: 0.22 }, vignette: { darkness: 0.95, offset: 1.0 } },
};
