/**
 * Theme interface v2 (DESIGN "Specification: code interfaces", Theme; "Themes and rendering"; "Input and interaction
 * design", Accessibility). Paper implemented v1 in M0 (M0-P3); M4-C extends it additively to v2: light rig, shadow and
 * post-processing settings, richer card dressing, line animation, sound default, camera defaults, quality details and
 * HUD tokens. Every theme is data plus one `build`; the functional signals it must render are in themes/signals.ts.
 * themes/ may import core, scene and util; it must not import games/, so table size arrives in SceneContext.
 *
 * Who fills what in M4 (PLAN Milestone 4): M4-P2 builds the lit pipeline that reads `lighting`, `shadows`, `post`,
 * `quality` and the card dressing's material fields; M4-P1 reads `camera`; M4-P3..P5 are Dusk, Wyrm and Stonetable;
 * M4-P6 maps `tokens` (including `hud`) to CSS custom properties and tunes the seat colours per theme.
 */
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { LineKind } from '../core/types';
import type { MotionConstants } from '../core/geometry';
import type { TextureSource } from '../util/texture';
import type { CameraRig, EgoRigParams, MaterialLibrary, PostPipeline } from '../scene/types';

export type { LineKind, MotionConstants };
export { DEFAULT_MOTION } from '../core/geometry';

/** Theme ids (DESIGN "Themes and rendering"). */
export type ThemeId = 'paper' | 'dusk' | 'wyrm' | 'stonetable';

/** Line dash pattern paired with a seat colour so nothing depends on hue alone (DESIGN "Input and interaction design", Accessibility). */
export type SeatPattern = 'solid' | 'dash' | 'dot' | 'dash-dot' | 'long-dash' | 'dash-dot-dot' | 'double' | 'zigzag';

/** Avatar glyph paired with a seat colour (DESIGN "Input and interaction design", Accessibility). */
export type SeatGlyph = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon' | 'cross' | 'ring';

/**
 * One of the eight seat colours with its accessible pattern and glyph (DESIGN "Themes and rendering", Tokens: "the eight
 * seat colours, tuned per theme for contrast"). The index, pattern and glyph are the same in every theme (a seat keeps
 * its identity across themes); only the colours are tuned (M4-P6, themes/signals.ts SEAT_CONTRAST).
 */
export interface SeatColour {
  index: number;
  /** CSS colour (hex #rrggbb), at least SEAT_CONTRAST.surface against the theme's table surface. */
  colour: string;
  pattern: SeatPattern;
  glyph: SeatGlyph;
  /** v2 (M4-C): text colour readable on `colour` (seat chips, caption bubbles); absent means the theme's `bg`. */
  ink?: string;
  /** v2 (M4-C): emissive or glow tint for lines and rings in lit themes (bloom); absent means `colour`. */
  glow?: string;
}

/**
 * HUD tokens beyond the base colours (DESIGN "Themes and rendering", Tokens: "Exposed to the HUD as CSS custom
 * properties"). v2 (M4-C). tokensToCssVars maps them to `--sp-hud-*` and `color-scheme`; M4-P6 owns the mapping.
 */
export interface HudTokens {
  /** 'dark' for Dusk, Wyrm and Stonetable: native form controls and scrollbars follow it. */
  scheme: 'light' | 'dark';
  /** Panel background (log, chat, menus), may be translucent. */
  panel: string;
  panelBorder: string;
  /** CSS box-shadow of floating panels, 'none' in Paper. */
  shadow: string;
  /** Backdrop blur behind translucent panels in px, 0 for none. */
  blur: number;
  /** Scrim behind the inspect view and pile viewer. */
  overlay: string;
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
  /** v2 (M4-C): panel and scheme tokens; absent means Paper's light defaults. */
  hud?: HudTokens;
}

/** Outline style for hover, selection and similar signals (DESIGN "Themes and rendering", Card dressing). */
export interface HighlightStyle {
  colour: string;
  /** Outline width in mm on the table. */
  width: number;
  /** Additional lift in mm, 0 for none. */
  lift: number;
  /** v2 (M4-C): emissive strength 0..1 that the bloom pass picks up in lit themes; absent or 0 for none. */
  glow?: number;
}

/**
 * A physically based or unlit surface description, turned into a three.js material by the scene's MaterialLibrary
 * (DESIGN "Themes and rendering", Table and Card dressing: sleeves and tables "receive light and shadow"; Assets: CC0
 * PBR materials or procedural). v2 (M4-C). Never used for a card face (see CardDressing.faceShade).
 */
export interface MaterialSpec {
  /** 'unlit' ignores lights (Paper); 'standard' is MeshStandardMaterial; 'physical' adds clearcoat and sheen. */
  model: 'unlit' | 'standard' | 'physical';
  /** Base colour (CSS). */
  colour: string;
  roughness: number;
  metalness: number;
  /** Albedo, normal, roughness and ambient-occlusion maps, procedural (drawn on a canvas) or a CC0 file listed in docs/ASSETS.md. */
  maps?: { albedo?: MaterialMap; normal?: MaterialMap; roughness?: MaterialMap; ao?: MaterialMap };
  /** Normal map strength, default 1. */
  normalScale?: number;
  /** Emissive colour and intensity (ember seams, runes). */
  emissive?: { colour: string; intensity: number };
  /** 'physical' only: clearcoat 0..1 (glossy sleeves). */
  clearcoat?: number;
  /** Texture repeat in mm per tile, so a slab keeps its scale on every table size. */
  tileMm?: number;
}

/** A map for a MaterialSpec: a procedural canvas texture or a bundled CC0 file URL (DESIGN "Themes and rendering", Assets). v2 (M4-C). */
export type MaterialMap = { kind: 'procedural'; source: TextureSource } | { kind: 'file'; url: string; licence: 'CC0' };

/** Card dressing: everything around a card face, never the face itself (DESIGN "Themes and rendering", Card dressing; "Card faces are never restyled"). */
export interface CardDressing {
  /** Sleeve or border colour, or null for a bare card. */
  sleeve: string | null;
  /** Card thickness in mm; 0 in flat themes (DESIGN geometry table: 0.6 in themes with thickness). */
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
  /** v2 (M4-C): sleeve and edge material in lit themes; null renders the sleeve colour unlit. */
  sleeveMaterial: MaterialSpec | null;
  /** v2 (M4-C): colour of the card's edges when `thickness` > 0 (the box sides). */
  edge: string;
  /**
   * v2 (M4-C): how much light may shade the printed face, 0 (unlit, Paper) to CARD_FACE_MAX_SHADE. The face material is
   * near-unlit in every theme so its average colour stays within 3% of the source (PLAN M4-P2; Scryfall's no-recolour rule).
   */
  faceShade: number;
  /** v2 (M4-C): lift in mm while a card is held (DESIGN geometry table: 12) and its tilt toward the drag in degrees (4 in lit themes, 0 in Paper). */
  held: { lift: number; tiltDeg: number; shadow: boolean };
  /** v2 (M4-C): treatment of the card a stack item or prompt is waiting on (pending confirmation, DESIGN "Turn flow and confirmation"). */
  pending: HighlightStyle;
}

/** The most light may darken or tint a printed card face (PLAN M4-P2: average colour within 3% of the source). v2 (M4-C). */
export const CARD_FACE_MAX_SHADE = 0.03;

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
  /** v2 (M4-C): ongoing animation along the line ('flow' moves the dash or texture toward the target); absent means 'none'. Reduced motion stops it. */
  animation?: 'none' | 'flow' | 'flicker' | 'pulse';
  /** v2 (M4-C): ornament drawn along a ribbon (Wyrm embers, Stonetable runes); absent means 'plain'. */
  ornament?: 'plain' | 'embers' | 'runes';
}

/** A procedural sound (DESIGN "Themes and rendering", Sound). */
export interface SoundSource {
  play(ctx: AudioContext, gain: number): void;
}

/** A looping background sound (DESIGN "Themes and rendering": Dusk's "muted ambience"). v2 (M4-C). */
export interface AmbientSoundSource {
  /** Start the loop; the handle stops it. */
  start(ctx: AudioContext, gain: number): { stop(): void };
}

/** The sound cues a set may provide (DESIGN "Themes and rendering", Sound). v2 (M4-C). */
export type SoundCue = 'slide' | 'tap' | 'shuffle' | 'turnChime' | 'promptTick';

/** Optional sound set, off by default in Paper (DESIGN "Themes and rendering", Sound). */
export interface SoundSet {
  slide?: SoundSource;
  tap?: SoundSource;
  shuffle?: SoundSource;
  turnChime?: SoundSource;
  promptTick?: SoundSource;
  /** v2 (M4-C). */
  ambience?: AmbientSoundSource;
  /** v2 (M4-C): whether the set plays until the viewer turns it off (Settings.sound 'theme'); Paper has no set. */
  onByDefault?: boolean;
}

/** Quality level id; Settings.quality stores the viewer's choice (DESIGN "Themes and rendering", Renderer). v2 (M4-C). */
export type QualityId = 'high' | 'medium' | 'low';

/** A quality level; a theme lists them best first and drops shadows and post-processing first (DESIGN "Themes and rendering", Renderer). */
export interface QualityLevel {
  id: QualityId;
  shadows: boolean;
  post: boolean;
  particles: boolean;
  /** Device pixel ratio cap. */
  pixelRatio: number;
  /** v2 (M4-C): shadow map size in px when shadows are on; absent uses ShadowSettings.mapSize. */
  shadowMapSize?: number;
  /** v2 (M4-C): anisotropic filtering samples for card textures, clamped to the GPU's maximum; absent means 1 (off). */
  anisotropy?: number;
  /** v2 (M4-C): MSAA samples of the post-processing render target; absent means 0. */
  msaa?: number;
}

/**
 * A light in the theme's rig (DESIGN "Themes and rendering", Lighting and post-processing: "light rig"). Positions are
 * mm in the viewer's frame: x right, y away from the viewer, z up from the table, origin at the table centre, so a lamp
 * stays over the viewer's table edge whichever seat they hold. v2 (M4-C).
 */
export type LightSpec =
  | { kind: 'ambient'; colour: string; intensity: number }
  | { kind: 'hemisphere'; sky: string; ground: string; intensity: number }
  | { kind: 'directional'; colour: string; intensity: number; position: [number, number, number]; target?: [number, number, number]; castShadow: boolean }
  | {
      kind: 'spot';
      colour: string;
      intensity: number;
      position: [number, number, number];
      target?: [number, number, number];
      angleDeg: number;
      penumbra: number;
      decay: number;
      /** mm; 0 = infinite. */
      distance: number;
      castShadow: boolean;
      /** Torch-like flicker: relative intensity amplitude and frequency; reduced motion turns it off. */
      flicker?: { amplitude: number; hz: number };
    }
  | {
      kind: 'point';
      colour: string;
      intensity: number;
      position: [number, number, number];
      decay: number;
      distance: number;
      castShadow: boolean;
      flicker?: { amplitude: number; hz: number };
    };

/** Lighting and tone settings (DESIGN "Themes and rendering", Lighting and post-processing: "light rig … tone mapping"). v2 (M4-C). */
export interface LightingSettings {
  /** False for Paper: no lights, unlit materials everywhere (DESIGN: "The minimal theme is that scene with unlit materials"). */
  lit: boolean;
  lights: LightSpec[];
  toneMapping: 'none' | 'aces' | 'agx' | 'neutral';
  exposure: number;
  /** Scene background colour behind the table. */
  background: string;
  /** Distance fog in mm, null for none. */
  fog: { colour: string; near: number; far: number } | null;
}

/** Shadow settings (DESIGN "Themes and rendering", Lighting and post-processing: "shadow settings"; Defaults: "whether shadows are on"). v2 (M4-C). */
export interface ShadowSettings {
  /** Default on or off; the quality level can still drop them. */
  enabled: boolean;
  /** Shadow-map shadows from lights with castShadow. */
  map: { type: 'basic' | 'pcf' | 'pcfSoft' | 'vsm'; mapSize: number; bias: number; normalBias: number; radius: number } | null;
  /** Soft contact shadows under cards (Dusk), a blurred depth pass; null for none. */
  contact: { opacity: number; blurMm: number; heightMm: number } | null;
}

/** Post-processing settings (DESIGN "Themes and rendering", Lighting and post-processing: bloom, vignette). v2 (M4-C). Built from three's examples/jsm passes. */
export interface PostSettings {
  /** UnrealBloomPass parameters; null for none. */
  bloom: { strength: number; radius: number; threshold: number } | null;
  /** Vignette darkness 0..1 and offset (three's VignetteShader); null for none. */
  vignette: { darkness: number; offset: number } | null;
  /** Theme-specific passes (Wyrm's heat shimmer) are added by the theme's build through SceneContext.post. */
}

/** Camera defaults of a theme (DESIGN "Themes and rendering", Defaults: "preferred camera rig"; theme table, Default camera). */
export interface CameraDefaults {
  defaultRig: CameraRig;
  /** v2 (M4-C): bird's-eye tilt from straight down in degrees (Dusk: "slightly tilted"); absent means 0. */
  birdseyeTiltDeg?: number;
  /** v2 (M4-C): overrides of the ego rig's parameters (DESIGN "Specification: geometry", Camera rigs, as defaults). */
  ego?: Partial<EgoRigParams>;
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
  /** v2 (M4-C): the post-processing pipeline to add theme passes to; set by the table scene from M4-P2 on, absent before. */
  post?: PostPipeline;
  /** v2 (M4-C): turns MaterialSpecs into shared three.js materials; set from M4-P2 on. */
  materials?: MaterialLibrary;
  /** v2 (M4-C): the viewer's seat angle in degrees, to place LightSpecs given in the viewer's frame; absent means 0. */
  viewerAngle?: number;
}

/** A built theme living in a scene (DESIGN "Specification: code interfaces"). */
export interface ThemeInstance {
  update(dt: number): void;
  dispose(): void;
  /** v2 (M4-C): apply another quality level without a rebuild (shadows, particles, post); absent means the scene rebuilds the theme. */
  setQuality?(quality: QualityLevel): void;
  /** v2 (M4-C): the stack lane's centre in table mm moved (Wyrm's heat shimmer follows it). */
  setStackFocus?(at: { x: number; y: number } | null): void;
}

/** A theme package (DESIGN "Specification: code interfaces", Theme). */
export interface Theme {
  id: ThemeId;
  /** v2 (M4-C): name shown in the theme picker. */
  label: string;
  tokens: ThemeTokens;
  camera: CameraDefaults;
  /** Creates table, lights, environment and post passes. */
  build(ctx: SceneContext): ThemeInstance;
  cardDressing: CardDressing;
  lineStyle(kind: LineKind, seat: SeatColour): LineStyle;
  motion: MotionConstants;
  sounds?: SoundSet;
  /** Ordered best first: what to drop first comes last. */
  quality: QualityLevel[];
  /** v2 (M4-C): light rig and tone mapping. */
  lighting: LightingSettings;
  /** v2 (M4-C). */
  shadows: ShadowSettings;
  /** v2 (M4-C). */
  post: PostSettings;
}

/** The order in which a lower quality level drops features (DESIGN "Themes and rendering", Renderer: "drops shadows and post-processing first"). v2 (M4-C). */
export const QUALITY_DROP_ORDER = ['shadows', 'post', 'particles', 'pixelRatio'] as const;

/**
 * The theme's quality level for a viewer's setting (DESIGN "Themes and rendering", Renderer): the level with that id,
 * else the best level not better than it, else the theme's lowest. Pure; used by the scene (M4-P2) and the picker (M4-P6).
 */
export function qualityLevel(theme: Pick<Theme, 'quality'>, id: QualityId): QualityLevel {
  const rank: Record<QualityId, number> = { high: 0, medium: 1, low: 2 };
  const levels = theme.quality;
  const exact = levels.find((l) => l.id === id);
  if (exact) return exact;
  const lower = levels.find((l) => rank[l.id] >= rank[id]);
  const last = levels[levels.length - 1];
  if (!lower && !last) throw new Error('theme has no quality levels');
  return (lower ?? last)!;
}
