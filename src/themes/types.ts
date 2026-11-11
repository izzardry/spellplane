/**
 * Theme interface v1 (DESIGN "Specification: code interfaces", Theme; "Themes and rendering"; "Input and interaction
 * design", Accessibility). Paper implements it in M0 (M0-P3); M4-C extends it to v2 (lights, post-processing).
 * themes/ may import core, scene and util; it must not import games/, so table size arrives in SceneContext.
 */
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { LineKind } from '../core/types';
import type { MotionConstants } from '../core/geometry';
import type { TextureSource } from '../util/texture';

export type { LineKind, MotionConstants };
export { DEFAULT_MOTION } from '../core/geometry';

/** Theme ids (DESIGN "Themes and rendering"). */
export type ThemeId = 'paper' | 'dusk' | 'wyrm' | 'stonetable';

/** Line dash pattern paired with a seat colour so nothing depends on hue alone (DESIGN "Input and interaction design", Accessibility). */
export type SeatPattern = 'solid' | 'dash' | 'dot' | 'dash-dot' | 'long-dash' | 'dash-dot-dot' | 'double' | 'zigzag';

/** Avatar glyph paired with a seat colour (DESIGN "Input and interaction design", Accessibility). */
export type SeatGlyph = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon' | 'cross' | 'ring';

/** One of the eight seat colours with its accessible pattern and glyph (DESIGN "Themes and rendering", Tokens). */
export interface SeatColour {
  index: number;
  /** CSS colour. */
  colour: string;
  pattern: SeatPattern;
  glyph: SeatGlyph;
}

/** Design tokens, exposed to the HUD as CSS custom properties (DESIGN "Themes and rendering", Tokens). */
export interface ThemeTokens {
  colours: {
    bg: string;
    fg: string;
    muted: string;
    surface: string;
    border: string;
    accent: string;
    danger: string;
    warning: string;
    focus: string;
    /** Exactly eight, index = seat colour index. */
    seats: SeatColour[];
  };
  type: {
    family: string;
    mono: string;
    /** Base size in px. */
    size: number;
    small: number;
    large: number;
    weight: number;
    weightBold: number;
  };
  /** Radii in px. */
  radii: { sm: number; md: number; lg: number };
  /** Spacing scale in px. */
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
}

/** Outline style for hover, selection and similar signals (DESIGN "Themes and rendering", Card dressing). */
export interface HighlightStyle {
  colour: string;
  /** Outline width in mm on the table. */
  width: number;
  /** Additional lift in mm, 0 for none. */
  lift: number;
}

/** Card dressing: everything around a card face, never the face itself (DESIGN "Themes and rendering", Card dressing; "Card faces are never restyled"). */
export interface CardDressing {
  /** Sleeve or border colour, or null for a bare card. */
  sleeve: string | null;
  /** Card thickness in mm; 0 in flat themes. */
  thickness: number;
  /** Theme override of the neutral back; null uses the game definition's back. */
  back: TextureSource | null;
  hover: HighlightStyle;
  selected: HighlightStyle;
  /** Marker colour for tapped cards at far zoom (the rotation is the primary signal). */
  tappedBadge: string;
  displacedMarker: string;
  ghost: { colour: string; opacity: number; dashed: boolean };
  /** Opacity of the owner's dimmed view of their own face-down card. */
  faceDownOwnerOpacity: number;
  foilSheen: boolean;
}

/** How a line of one kind is drawn for one seat (DESIGN "Themes and rendering", Lines; "Combat and annotation"). */
export interface LineStyle {
  colour: string;
  /** Stroke width in CSS px (Paper: 1.5). */
  widthPx: number;
  /** Dash pattern in px, null for solid. */
  dash: number[] | null;
  geometry: 'stroke' | 'ribbon';
  glow: number;
  arrowhead: 'none' | 'triangle' | 'chevron' | 'dot';
  /** Thickness pulse duration on creation, ms (Paper's "glow"). */
  pulseMs: number;
}

/** A procedural sound (DESIGN "Themes and rendering", Sound). */
export interface SoundSource {
  play(ctx: AudioContext, gain: number): void;
}

/** Optional sound set, off by default in Paper (DESIGN "Themes and rendering", Sound). */
export interface SoundSet {
  slide?: SoundSource;
  tap?: SoundSource;
  shuffle?: SoundSource;
  turnChime?: SoundSource;
  promptTick?: SoundSource;
}

/** A quality level; a theme lists them best first and drops shadows and post-processing first (DESIGN "Themes and rendering", Renderer). */
export interface QualityLevel {
  id: 'high' | 'medium' | 'low';
  shadows: boolean;
  post: boolean;
  particles: boolean;
  /** Device pixel ratio cap. */
  pixelRatio: number;
}

/** What a theme builds into (DESIGN "Specification: code interfaces", Theme.build). */
export interface SceneContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Table size in mm for the current layout. */
  table: { w: number; d: number };
  quality: QualityLevel;
  reducedMotion: boolean;
}

/** A built theme living in a scene (DESIGN "Specification: code interfaces"). */
export interface ThemeInstance {
  update(dt: number): void;
  dispose(): void;
}

/** A theme package (DESIGN "Specification: code interfaces", Theme). */
export interface Theme {
  id: ThemeId;
  tokens: ThemeTokens;
  camera: { defaultRig: 'birdseye' | 'ego' };
  /** Creates table, lights, environment and post passes. */
  build(ctx: SceneContext): ThemeInstance;
  cardDressing: CardDressing;
  lineStyle(kind: LineKind, seat: SeatColour): LineStyle;
  motion: MotionConstants;
  sounds?: SoundSet;
  /** Ordered best first: what to drop first comes last. */
  quality: QualityLevel[];
}
