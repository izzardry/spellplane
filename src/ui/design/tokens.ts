/**
 * The design system's tokens (PLAN Milestone 7, Principles: "One design system. Colour, type scale, spacing, radius,
 * elevation, icons and motion all come from shared tokens"; Owner decisions after the first design round: "All three
 * looks are kept, as the three themes of the redesign … Graphite … gets depth"). Values are taken from
 * docs/design/m7-directions.html (A Kitchen Table, B Graphite, C Codex); the HUD structure they dress is
 * docs/design/m7-hud-proposal.md. Added by M7-C; M7-P2 builds the components on them and may tune values, never the
 * shape without a contracts change.
 *
 * Looks change materials and mood, never layout or controls (PLAN Milestone 7, Principles): sizes and spacing are shared
 * (LAYOUT), each look sets colour, type, radius, elevation, motion and sound (LookTokens). Safari: no token uses
 * backdrop-filter or blur (PLAN Milestone 7, A0: CSS blur over the WebGL canvas is a measured cost); elevation is plain
 * box-shadow, motion animates transform and opacity only.
 */
import { DEFAULT_LOOK, type LookId, type SoundCue } from '../../themes/types';
// [M8-P1] The bundled paper grain (scripts/make-grain.mjs: 160 px, seeded, about 5 % ink).
import GRAIN_URL from './grain.png';

/** Colour roles of a look (docs/design/m7-directions.html, the `--t-*` variables of each direction). CSS colours. Added by M7-C. */
export interface ColourTokens {
  /** Behind the table (the walnut frame, the charcoal room, the midnight desk). */
  frame: string;
  /** The table surface (playmat, slate, leather): what cards lie on; the 3D theme's surface matches it. */
  mat: string;
  /** HUD panels (plates, tracker, buttons). */
  panel: string;
  /** A panel lifted above another (menus over panels, the selection strip): Graphite's depth comes from this step. */
  panelRaised: string;
  /** A quieter panel (ghost buttons, notes). */
  ghost: string;
  /** Panel border (a CSS colour; components draw 1 px). */
  border: string;
  /** Hairlines and separators. */
  line: string;
  /** Body text on panels. */
  ink: string;
  /** Secondary text on panels. */
  muted: string;
  /** The primary action's fill: the one filled button on screen. */
  accent: string;
  accentInk: string;
  /** The primary button's lower edge or rim (Kitchen's pressed-paper edge, Codex's gilt rim, Graphite's darker mint). */
  accentEdge: string;
  /** A selected step or toggle (the turn tracker's current step). */
  on: string;
  onInk: string;
  /** Selected cards' outline (a theme's CardDressing.selected follows it). */
  selection: string;
  /** Counter chips and icon wells. */
  chip: string;
  /** Pile count badges. */
  badge: string;
  badgeInk: string;
  /** Tooltips. */
  tip: string;
  tipInk: string;
  /** Coach marks. */
  coach: string;
  coachInk: string;
  /** Keyboard focus ring (visible on every control; DESIGN "Input and interaction design", Accessibility). */
  focus: string;
  /** Destructive and loss (never the same hue as `accent`; always with a word or icon, never by hue alone). */
  danger: string;
  warning: string;
  success: string;
  /** Scrim behind dialogs and inspect; an opaque-ish colour, never a blur. */
  overlay: string;
  /** The two seat colours the directions show (seat 0 and 1); the eight seat colours stay the theme's (ThemeTokens.colours.seats). */
  seatA: string;
  seatB: string;
  /** Look-specific ornament colour: Codex's gilt, Kitchen's brass, Graphite's mint hairline. */
  ornament: string;
  /** Over the arena still behind the shell (visual.md 2.3). Added by M8-P1 for M8-C. */
  veil: string;
}

/** Type of a look (docs/design/m7-directions.html, Type samples). Sizes are LAYOUT.type; a look sets families, weights and label style. Added by M7-C. */
export interface TypeTokens {
  /** Body and controls. */
  body: string;
  /** Headings, brand and the primary button where the look says so (Codex: book serif small caps). */
  heading: string;
  /** Life totals and big numerals. */
  numeral: string;
  mono: string;
  /** Paragraphs: rules text, notes, help over two lines (visual.md 2.3). Added by M8-P1 for M8-C. */
  reading: string;
  weight: { regular: number; medium: number; bold: number; heavy: number };
  /** Heading weight (Kitchen 800, Graphite 650, Codex 600). */
  headingWeight: number;
  /** Life numeral weight (Kitchen 800, Graphite 600, Codex 500). */
  numeralWeight: number;
  /** Small labels: CSS text-transform and letter-spacing in em (Kitchen sentence case; Graphite caps .08em; Codex caps .12em). */
  labelCase: 'none' | 'uppercase';
  labelSpacingEm: number;
  /** Headings in small caps (Codex). */
  headingSmallCaps: boolean;
  /** Tabular numerals for life and counts. */
  tabularNums: boolean;
}

/**
 * Corner radii of a look in px (docs/design/m7-directions.html `--t-r`, `--t-rpill`, `--t-rplate`). Added by M7-C; M8-C
 * split `md` into `button` and `panel` (visual.md 2.3: "round buttons, 16 px sheets"); `--ds-radius-md` is still emitted
 * (the button radius) for components written before.
 */
export interface RadiusTokens {
  /** Small controls inside panels (chips, keys, steppers). */
  sm: number;
  /** Buttons. */
  button: number;
  /** Panels, tiles and sheets (cards and sheets derive from it: --ds-radius-card, --ds-radius-sheet). */
  panel: number;
  /** The turn tracker and pills. */
  pill: number;
  /** Player plates. */
  plate: number;
}

/** Elevation as CSS box-shadow values, 'none' for flat (docs/design/m7-directions.html `--t-sh`, `--t-pop`, `--t-primary-sh`, `--t-cardsh`). Never a blur filter. Added by M7-C. */
export interface ElevationTokens {
  /** Resting panels on the table (plates, tracker, buttons). */
  raised: string;
  /** Popovers, menus, the selection strip, coach marks. */
  pop: string;
  /** The primary button. */
  primary: string;
  /** Cards in the DOM (hand fan, pile viewer); the 3D card shadow is the theme's. */
  card: string;
  /** A card lifted in the DOM (hand hover, drag out of the hand). */
  cardLifted: string;
  /** Sheets and tiles (visual.md 2.3). Added by M8-P1 for M8-C. */
  sheet: string;
  /** Dialogs (visual.md 2.3). Added by M8-P1 for M8-C. */
  dialog: string;
  /** A pressed control (visual.md 2.4). Added by M8-P1 for M8-C. */
  pressed: string;
  /** Wells: fields, tracks, slots (visual.md 2.3). Added by M8-P1 for M8-C. */
  well: string;
  /** A pile of cards (visual.md 2.3). Added by M8-P1 for M8-C. */
  stack: string;
}

/** Static background textures of a look (visual.md 2.3): CSS images, never a filter at run time. Added by M8-P1 for M8-C. */
export interface TextureTokens {
  /** The page's halftone or linen (a CSS image, or 'none'). */
  page: string;
  /** Its tile size (CSS background-size). */
  pageSize: string;
  /** A dense dot texture for wells and slots. */
  dense: string;
  /** The grain on sheets and tiles. */
  grain: 'paper' | 'leather' | 'none';
}

/**
 * The booster foil of each look (visual.md 2.8 "Booster pack": black foil with silver lines in Plain and Graphite, kraft
 * with ink lines in Kitchen Table, navy with gilt lines in Codex): five gradient stops and the line colour, emitted as
 * --ds-foil-0 … --ds-foil-4 and --ds-foil-line. Added by M8-P1.
 */
export const FOILS: Readonly<Record<LookId, { stops: readonly [string, string, string, string, string]; line: string }>> = {
  plain: { stops: ['#1a1a1a', '#3a3a3a', '#141414', '#4a4a4a', '#101010'], line: '#d9d9d9' },
  kitchen: { stops: ['#a07a4b', '#c39d6c', '#b08a5a', '#cfa977', '#94703f'], line: '#2b2118' },
  graphite: { stops: ['#15181c', '#353b45', '#111316', '#424955', '#0d0f12'], line: '#cfd6de' },
  codex: { stops: ['#141a2b', '#2b3552', '#171e33', '#34406a', '#0f1422'], line: '#c8a75e' },
};

/** The mana identity colours, the same in every look (visual.md 2.3). Added by M8-P1 for M8-C. */
export const MANA_COLOURS = { W: '#f1ecd2', U: '#2f6fb5', B: '#2b2b2b', R: '#c8432f', G: '#2f7d4f', C: '#bdbdbd' } as const;

/** CSS easing curves of a look (PLAN Milestone 7, A9 Sound and motion: "Easing, durations"). Added by M7-C. */
export interface EasingTokens {
  /** Most UI transitions. */
  standard: string;
  /** Things arriving (popovers, the strip, toasts). */
  enter: string;
  /** Things leaving. */
  exit: string;
  /** A small overshoot for playful arrivals (Kitchen), equal to `enter` where the look has none (Graphite, Codex). */
  bounce: string;
}

/** Motion of a look: durations in ms and easings (PLAN Milestone 7, A9; DESIGN "Specification: geometry, layout and motion", Motion). All 0 under reduced motion. Added by M7-C. */
export interface MotionTokens {
  duration: { fast: number; base: number; slow: number; deliberate: number };
  easing: EasingTokens;
}

/** Sound of a look (PLAN Milestone 7, Owner decisions: "every common move has a short animation and sound"; A9 "the theme mood"). The sources are the theme's SoundSet. Added by M7-C. */
export interface SoundTokens {
  /** Master gain the look's cues play at, 0..1 (ui/sound.ts SOUND_GAIN is the ceiling). */
  gain: number;
  /** The cues the look plays (others stay silent even when its set has them). */
  cues: readonly SoundCue[];
  /** Plays under Settings.sound 'theme' (SoundSet.onByDefault for the look's theme). */
  onByDefault: boolean;
}

/** One look's tokens (PLAN Milestone 7, Owner decisions; docs/design/m7-directions.html). Added by M7-C. */
export interface LookTokens {
  id: LookId;
  label: string;
  /** One line describing the mood (the directions page's lede). */
  mood: string;
  /** Light or dark HUD (CSS color-scheme): Kitchen light panels on a light mat, Graphite and Codex dark. */
  scheme: 'light' | 'dark';
  colour: ColourTokens;
  type: TypeTokens;
  radius: RadiusTokens;
  elevation: ElevationTokens;
  motion: MotionTokens;
  sound: SoundTokens;
  /** Added by M8-P1 for M8-C (visual.md 2.3). */
  texture: TextureTokens;
}

/**
 * Sizes and spacing shared by every look (PLAN Milestone 7, Principles: "Themes change materials and mood, not layout or
 * controls"; docs/design/m7-directions.html mock base: buttons 40, primary 52, talk 52, tracker 44, avatar 52; touch
 * targets 44 pt). px. Added by M7-C.
 */
export const LAYOUT = {
  // M8-C (visual.md 2.3, "Shared by every look", re-valued): xxxl and huge are new.
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 },
  type: { label: 11, small: 12, body: 14, control: 14, title: 18, heading: 24, display: 36, life: 48, brand: 36 },
  lineHeight: { tight: 1.15, body: 1.35 },
  // M8-C: the kit's four heights xs 28, sm 36, md 44, lg 56 (visual.md V4); the legacy keys map onto them.
  control: { xs: 28, sm: 36, md: 44, lg: 56, height: 44, primary: 56, talk: 56, tracker: 44, touch: 44, stripAction: 36, stepper: 28, avatar: 56, avatarSmall: 36 },
  /** HUD edge inset from the window. */
  edge: 16,
  /** Stacking order of the HUD layers (critique, Start page 4: "Nothing defines what may cover what"). */
  z: { table: 0, plates: 10, strip: 20, hand: 30, toolbar: 40, drawer: 50, popover: 60, toast: 70, dialog: 80, coach: 90 },
} as const;

/** Every card-feel and table cue (themes/types.ts SoundCue), for looks that play them all. */
const ALL_CUES: readonly SoundCue[] = ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick', 'draw', 'untap', 'play', 'toGraveyard', 'toExile', 'toHand', 'attach', 'clip', 'pickup', 'drop', 'snap'];

const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Avenir Next", "Segoe UI", system-ui, sans-serif';
const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const FIRA = '"Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)';

/**
 * Plain (visual.md 2.3, complete; the `:root` block of mock.html): Ztyle on paper, grey-scale chrome, one monospace
 * face, pills and circles, depth from layered paper and pressed controls. The default look. Added by M8-P1 for M8-C; M8-P1 tunes.
 */
const PLAIN: LookTokens = {
  id: 'plain',
  label: 'Plain',
  mood: 'Ztyle on paper: grey-scale chrome, one monospace face, depth from layered paper and pressed controls.',
  scheme: 'light',
  colour: {
    frame: '#e3e3e3',
    mat: '#f2f2f2',
    panel: '#fcfcfc',
    panelRaised: '#ffffff',
    ghost: 'rgba(252, 252, 252, 0.92)',
    border: 'rgba(13, 13, 13, 0.12)',
    line: 'rgba(13, 13, 13, 0.08)',
    ink: '#0d0d0d',
    muted: '#666666',
    accent: '#0d0d0d',
    accentInk: '#fafafa',
    accentEdge: '#000000',
    on: '#0d0d0d',
    onInk: '#fafafa',
    selection: '#0d0d0d',
    chip: '#ebebeb',
    badge: '#0d0d0d',
    badgeInk: '#fafafa',
    tip: '#0d0d0d',
    tipInk: '#fafafa',
    coach: '#ffffff',
    coachInk: '#0d0d0d',
    focus: '#0d0d0d',
    danger: '#c81e1e',
    warning: '#8a5a00',
    success: '#0f7a36',
    overlay: 'rgba(242, 242, 242, 0.82)',
    seatA: '#2f6f9f',
    seatB: '#8a4f7d',
    ornament: '#bdbdbd',
    veil: 'rgba(242, 242, 242, 0.58)',
  },
  type: {
    body: FIRA,
    heading: FIRA,
    numeral: FIRA,
    mono: FIRA,
    reading: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    weight: { regular: 400, medium: 500, bold: 600, heavy: 700 },
    headingWeight: 500,
    numeralWeight: 500,
    labelCase: 'uppercase',
    labelSpacingEm: 0.05,
    headingSmallCaps: false,
    tabularNums: true,
  },
  radius: { sm: 8, button: 9999, panel: 16, pill: 9999, plate: 9999 },
  elevation: {
    raised: 'inset 0 1px 0 #fff, 0 0 0 1px rgba(13, 13, 13, 0.08), 0 1px 1px rgba(13, 13, 13, 0.12), 0 3px 6px rgba(13, 13, 13, 0.07), 0 10px 20px -6px rgba(13, 13, 13, 0.14)',
    pop: '0 0 0 1px rgba(13, 13, 13, 0.08), 0 2px 4px rgba(13, 13, 13, 0.08), 0 12px 24px -4px rgba(13, 13, 13, 0.16), 0 32px 48px -12px rgba(13, 13, 13, 0.2)',
    primary: 'inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 1px 1px rgba(0, 0, 0, 0.4), 0 4px 8px rgba(13, 13, 13, 0.2), 0 12px 24px -6px rgba(13, 13, 13, 0.32)',
    card: '0 0 0 1px rgba(13, 13, 13, 0.1), 0 1px 1px rgba(13, 13, 13, 0.16), 0 4px 8px -2px rgba(13, 13, 13, 0.16)',
    cardLifted: '0 0 0 1px rgba(13, 13, 13, 0.1), 0 4px 6px rgba(13, 13, 13, 0.1), 0 18px 32px -6px rgba(13, 13, 13, 0.28)',
    sheet: 'inset 0 1px 0 #fff, 0 0 0 1px rgba(13, 13, 13, 0.06), 0 1px 0 rgba(13, 13, 13, 0.1), 0 2px 4px rgba(13, 13, 13, 0.04), 0 14px 28px -10px rgba(13, 13, 13, 0.14)',
    dialog: '0 0 0 1px rgba(13, 13, 13, 0.08), 0 8px 16px rgba(13, 13, 13, 0.1), 0 40px 80px -16px rgba(13, 13, 13, 0.3)',
    pressed: 'inset 0 2px 4px rgba(13, 13, 13, 0.16), inset 0 0 0 1px rgba(13, 13, 13, 0.1)',
    well: 'inset 0 1px 2px rgba(13, 13, 13, 0.12), inset 0 0 0 1px rgba(13, 13, 13, 0.05), 0 1px 0 #fff',
    stack: '0 1px 0 #fcfcfc, 0 2px 0 #cfcfcf, 0 3px 0 #fcfcfc, 0 4px 0 #cfcfcf, 0 5px 0 #fcfcfc, 0 6px 0 #c4c4c4, 0 14px 22px -6px rgba(13, 13, 13, 0.22)',
  },
  motion: {
    duration: { fast: 150, base: 200, slow: 300, deliberate: 500 },
    easing: { standard: EASE_OUT, enter: EASE_OUT, exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: EASE_OUT },
  },
  sound: { gain: 0.4, cues: ALL_CUES, onByDefault: true },
  texture: {
    page: 'radial-gradient(circle, rgba(13, 13, 13, 0.055) 1px, transparent 1.3px)',
    pageSize: '8px 8px',
    dense: 'radial-gradient(circle, rgba(13, 13, 13, 0.16) 1px, transparent 1.3px)',
    grain: 'paper',
  },
};

/** A Kitchen Table (docs/design/m7-directions.html, Direction A): oatmeal playmat on walnut, cream paper chips, rounded type, brick red for the next action. */
const KITCHEN: LookTokens = {
  id: 'kitchen',
  label: 'Kitchen Table',
  mood: 'Warm and tactile: an oatmeal playmat on walnut, cream paper chips, rounded friendly type.',
  scheme: 'light',
  colour: {
    frame: '#5b3f2c',
    mat: '#d9ccb2',
    panel: '#f7f1e5',
    panelRaised: '#fffaf0',
    ghost: 'rgba(247, 241, 229, 0.86)',
    border: 'rgba(80, 60, 40, 0.14)',
    line: '#d6c8ae',
    ink: '#2b2118',
    muted: '#6f604e',
    accent: '#b94f2c',
    accentInk: '#fff8ef',
    accentEdge: '#8e3a1f',
    on: '#2b2118',
    onInk: '#f7f1e5',
    selection: '#b08a3e',
    chip: '#efe4cf',
    badge: '#2b2118',
    badgeInk: '#f7f1e5',
    tip: '#2b2118',
    tipInk: '#f7f1e5',
    coach: '#fff9ec',
    coachInk: '#2b2118',
    focus: '#2f6f9f',
    danger: '#9e2a2b',
    warning: '#8a5a00',
    success: '#3d6b35',
    overlay: 'rgba(43, 33, 24, 0.55)',
    seatA: '#2f6f9f',
    seatB: '#8a4f7d',
    ornament: '#b08a3e',
    veil: 'rgba(217, 204, 178, 0.6)', // M8-C (visual.md 2.3)
  },
  type: {
    body: ROUNDED,
    heading: ROUNDED,
    numeral: ROUNDED,
    mono: MONO,
    reading: ROUNDED,
    weight: { regular: 400, medium: 500, bold: 700, heavy: 800 },
    headingWeight: 800,
    numeralWeight: 800,
    labelCase: 'none',
    labelSpacingEm: 0,
    headingSmallCaps: false,
    tabularNums: true,
  },
  radius: { sm: 8, button: 14, panel: 14, pill: 22, plate: 40 },
  elevation: {
    raised: '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 2px 0 rgba(70, 48, 30, 0.12), 0 6px 14px rgba(70, 48, 30, 0.16)',
    pop: '0 10px 24px rgba(60, 40, 24, 0.26)',
    primary: '0 3px 0 #8e3a1f, 0 8px 18px rgba(140, 60, 30, 0.32)',
    card: '0 1px 1px rgba(40, 25, 10, 0.3), 0 4px 10px rgba(40, 25, 10, 0.22)',
    cardLifted: '0 2px 2px rgba(40, 25, 10, 0.25), 0 14px 28px rgba(40, 25, 10, 0.3)',
    // M8-C (visual.md 2.3, the new tokens in the other looks).
    sheet: 'inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(80, 60, 40, 0.1), 0 2px 0 rgba(70, 48, 30, 0.1), 0 14px 28px -10px rgba(70, 48, 30, 0.22)',
    dialog: '0 24px 60px -12px rgba(60, 40, 24, 0.42)',
    pressed: 'inset 0 2px 4px rgba(70, 48, 30, 0.22)',
    well: 'inset 0 1px 2px rgba(70, 48, 30, 0.18), 0 1px 0 rgba(255, 255, 255, 0.7)',
    stack: '0 2px 0 #e6dcc6, 0 3px 0 #b9a98a, 0 5px 0 #e6dcc6, 0 6px 0 #b9a98a, 0 14px 22px -6px rgba(60, 40, 24, 0.3)',
  },
  motion: {
    duration: { fast: 120, base: 200, slow: 320, deliberate: 480 },
    easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', enter: 'cubic-bezier(0, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: 'cubic-bezier(0.34, 1.4, 0.64, 1)' },
  },
  sound: { gain: 0.8, cues: ALL_CUES, onByDefault: true },
  texture: {
    page: 'repeating-linear-gradient(0deg, rgba(43, 33, 24, 0.05) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(43, 33, 24, 0.05) 0 1px, transparent 1px 3px)',
    pageSize: '3px 3px',
    dense: 'radial-gradient(circle, rgba(43, 33, 24, 0.18) 1px, transparent 1.3px)',
    grain: 'paper',
  },
};

/**
 * B Graphite (docs/design/m7-directions.html, Direction B) with the depth the owner asked for ("B is a bit too flat"):
 * layered surfaces (panelRaised), soft shadows instead of `--t-sh: none`, still flat fills and the cheapest to draw.
 */
const GRAPHITE: LookTokens = {
  id: 'graphite',
  label: 'Graphite',
  mood: 'Modern and minimal: a cool charcoal surface, layered hairline panels, one mint accent, precise type.',
  scheme: 'dark',
  colour: {
    frame: '#101317',
    mat: '#16191e',
    panel: '#20242b',
    panelRaised: '#272c34',
    ghost: '#1c2026',
    border: '#323843',
    line: '#323843',
    ink: '#e9ecf0',
    muted: '#9aa3ae',
    accent: '#3fd2a3',
    accentInk: '#06261c',
    accentEdge: '#249a76',
    on: '#e9ecf0',
    onInk: '#16191e',
    selection: '#3fd2a3',
    chip: '#2b3039',
    badge: '#e9ecf0',
    badgeInk: '#16191e',
    tip: '#e9ecf0',
    tipInk: '#16191e',
    coach: '#e9ecf0',
    coachInk: '#16191e',
    focus: '#8fc4ff',
    danger: '#ff6b6b',
    warning: '#f2c14e',
    success: '#3fd2a3',
    overlay: 'rgba(8, 10, 13, 0.72)',
    seatA: '#5aa2ff',
    seatB: '#ff9466',
    ornament: '#3fd2a3',
    veil: 'rgba(22, 25, 30, 0.66)', // M8-C (visual.md 2.3)
  },
  type: {
    body: SYSTEM,
    heading: SYSTEM,
    numeral: SYSTEM,
    mono: MONO,
    reading: SYSTEM,
    weight: { regular: 400, medium: 500, bold: 600, heavy: 700 },
    headingWeight: 650,
    numeralWeight: 600,
    labelCase: 'uppercase',
    labelSpacingEm: 0.08,
    headingSmallCaps: false,
    tabularNums: true,
  },
  radius: { sm: 6, button: 10, panel: 10, pill: 10, plate: 12 },
  elevation: {
    raised: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.28)',
    pop: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 2px 6px rgba(0, 0, 0, 0.4), 0 12px 28px rgba(0, 0, 0, 0.45)',
    primary: '0 2px 0 #249a76, 0 8px 18px rgba(63, 210, 163, 0.18)',
    card: '0 2px 6px rgba(0, 0, 0, 0.5)',
    cardLifted: '0 4px 8px rgba(0, 0, 0, 0.45), 0 16px 32px rgba(0, 0, 0, 0.5)',
    sheet: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 0 1px #323843, 0 2px 4px rgba(0, 0, 0, 0.4), 0 16px 32px -12px rgba(0, 0, 0, 0.5)',
    dialog: '0 0 0 1px #3a414d, 0 30px 70px -10px rgba(0, 0, 0, 0.7)',
    pressed: 'inset 0 2px 4px rgba(0, 0, 0, 0.5)',
    well: 'inset 0 1px 2px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.04)',
    stack: '0 2px 0 #2b3039, 0 3px 0 #0e1114, 0 5px 0 #2b3039, 0 6px 0 #0e1114, 0 14px 22px -6px rgba(0, 0, 0, 0.6)',
  },
  motion: {
    duration: { fast: 100, base: 180, slow: 280, deliberate: 420 },
    easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', enter: 'cubic-bezier(0, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: 'cubic-bezier(0, 0, 0.2, 1)' },
  },
  sound: { gain: 0.5, cues: ALL_CUES, onByDefault: true },
  texture: {
    page: 'radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1.3px)',
    pageSize: '8px 8px',
    dense: 'radial-gradient(circle, rgba(255, 255, 255, 0.14) 1px, transparent 1.3px)',
    grain: 'none',
  },
};

/** C Codex (docs/design/m7-directions.html, Direction C): midnight-blue leather, gilt hairlines, serif small caps, a vermilion seal for the next action. */
const CODEX: LookTokens = {
  id: 'codex',
  label: 'Codex',
  mood: 'Restrained fantasy: midnight-blue leather, gilt hairlines, serif small caps, a vermilion seal for the next action.',
  scheme: 'dark',
  colour: {
    frame: '#141a29',
    mat: '#1b2235',
    panel: '#242c42',
    panelRaised: '#2b344d',
    ghost: 'rgba(36, 44, 66, 0.92)',
    border: 'rgba(200, 167, 94, 0.55)',
    line: 'rgba(200, 167, 94, 0.35)',
    ink: '#efe6d2',
    muted: '#a99f8c',
    accent: '#b8432f',
    accentInk: '#fbeee0',
    accentEdge: '#e0b46a',
    on: '#c8a75e',
    onInk: '#1b2235',
    selection: '#e0c27a',
    chip: '#313a55',
    badge: '#c8a75e',
    badgeInk: '#1b2235',
    tip: '#efe6d2',
    tipInk: '#1b2235',
    coach: '#efe6d2',
    coachInk: '#1b2235',
    focus: '#e0c27a',
    danger: '#e57a68',
    warning: '#e0b46a',
    success: '#8fbf8a',
    overlay: 'rgba(10, 13, 22, 0.74)',
    seatA: '#7fb0e0',
    seatB: '#e0a070',
    ornament: '#c8a75e',
    veil: 'rgba(27, 34, 53, 0.66)', // M8-C (visual.md 2.3)
  },
  type: {
    body: SYSTEM,
    heading: BOOK,
    numeral: BOOK,
    mono: MONO,
    reading: SYSTEM,
    weight: { regular: 400, medium: 500, bold: 600, heavy: 700 },
    headingWeight: 600,
    numeralWeight: 500,
    labelCase: 'uppercase',
    labelSpacingEm: 0.12,
    headingSmallCaps: true,
    tabularNums: true,
  },
  radius: { sm: 4, button: 6, panel: 6, pill: 6, plate: 6 },
  elevation: {
    raised: '0 4px 12px rgba(0, 0, 0, 0.35)',
    pop: '0 12px 30px rgba(0, 0, 0, 0.5)',
    primary: '0 0 0 3px rgba(184, 67, 47, 0.25), 0 6px 16px rgba(0, 0, 0, 0.4)',
    card: '0 3px 10px rgba(0, 0, 0, 0.5)',
    cardLifted: '0 6px 12px rgba(0, 0, 0, 0.45), 0 18px 36px rgba(0, 0, 0, 0.55)',
    sheet: 'inset 0 0 0 1px rgba(200, 167, 94, 0.18), 0 0 0 1px rgba(200, 167, 94, 0.55), 0 6px 16px rgba(0, 0, 0, 0.4)',
    dialog: '0 0 0 1px rgba(200, 167, 94, 0.55), 0 30px 70px -10px rgba(0, 0, 0, 0.7)',
    pressed: 'inset 0 2px 5px rgba(0, 0, 0, 0.5)',
    well: 'inset 0 1px 3px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(200, 167, 94, 0.12)',
    stack: '0 2px 0 #313a55, 0 3px 0 #10141f, 0 5px 0 #313a55, 0 6px 0 #10141f, 0 14px 22px -6px rgba(0, 0, 0, 0.6)',
  },
  motion: {
    duration: { fast: 140, base: 220, slow: 360, deliberate: 520 },
    easing: { standard: 'cubic-bezier(0.3, 0, 0.1, 1)', enter: 'cubic-bezier(0.1, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: 'cubic-bezier(0.1, 0, 0.2, 1)' },
  },
  sound: { gain: 0.7, cues: ALL_CUES, onByDefault: true },
  texture: {
    page: 'none',
    pageSize: 'auto',
    dense: 'radial-gradient(circle, rgba(200, 167, 94, 0.14) 1px, transparent 1.3px)',
    grain: 'leather',
  },
};

/** The three looks' tokens (PLAN Milestone 7, Owner decisions after the first design round). Added by M7-C. */
export const LOOKS: Readonly<Record<LookId, LookTokens>> = { plain: PLAIN, kitchen: KITCHEN, graphite: GRAPHITE, codex: CODEX };

/** A look's tokens; an unknown id gets the default look's (Settings.look is a string). Added by M7-C. */
export function lookTokens(id: LookId): LookTokens {
  return LOOKS[id] ?? LOOKS[DEFAULT_LOOK];
}

/** A look's motion with reduced motion applied: every duration 0 (DESIGN "Specification: geometry, layout and motion": "With reduced motion, all of these are cuts"). Added by M7-C. */
export function motionTokens(look: LookTokens, reduced: boolean): MotionTokens {
  if (!reduced) return look.motion;
  return { duration: { fast: 0, base: 0, slow: 0, deliberate: 0 }, easing: look.motion.easing };
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * The look's CSS custom properties for the HUD (PLAN Milestone 7, Principles: "Nothing is styled ad hoc"): --ds-<colour>
 * (e.g. --ds-panel-raised), --ds-font-body|heading|numeral|mono, --ds-weight-*, --ds-heading-weight,
 * --ds-numeral-weight, --ds-label-case, --ds-label-spacing, --ds-heading-variant, --ds-numeric, --ds-radius-*,
 * --ds-elevation-*, --ds-duration-*, --ds-ease-*, --ds-space-*, --ds-type-*, --ds-control-*, --ds-edge, and
 * `color-scheme`. Sizes are px, durations ms. Reduced motion zeroes the durations. Added by M7-C; M7-P2 applies them.
 */
export function designCssVars(look: LookTokens, reduced = false): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(look.colour)) vars[`--ds-${kebab(k)}`] = v;
  const t = look.type;
  vars['--ds-font-body'] = t.body;
  vars['--ds-font-heading'] = t.heading;
  vars['--ds-font-numeral'] = t.numeral;
  vars['--ds-font-mono'] = t.mono;
  vars['--ds-font-reading'] = t.reading;
  for (const [k, v] of Object.entries(t.weight)) vars[`--ds-weight-${k}`] = String(v);
  vars['--ds-heading-weight'] = String(t.headingWeight);
  vars['--ds-numeral-weight'] = String(t.numeralWeight);
  vars['--ds-label-case'] = t.labelCase;
  vars['--ds-label-spacing'] = `${t.labelSpacingEm}em`;
  vars['--ds-heading-variant'] = t.headingSmallCaps ? 'small-caps' : 'normal';
  vars['--ds-numeric'] = t.tabularNums ? 'tabular-nums' : 'normal';
  for (const [k, v] of Object.entries(look.radius)) vars[`--ds-radius-${k}`] = `${v}px`;
  // M8-C: the legacy name, and the two derived radii (visual.md 2.3).
  vars['--ds-radius-md'] = `${look.radius.button}px`;
  vars['--ds-radius-card'] = `${Math.max(look.radius.sm, look.radius.panel - 4)}px`;
  vars['--ds-radius-sheet'] = `${look.radius.panel + 4}px`;
  vars['--ds-texture-page'] = look.texture.page;
  vars['--ds-texture-page-size'] = look.texture.pageSize;
  vars['--ds-texture-dense'] = look.texture.dense;
  // [M8-P1] The grain tile on sheets and tiles (visual.md 2.4 rule 6); 'none' for a look without grain.
  vars['--ds-texture-grain'] = look.texture.grain === 'none' ? 'none' : `url("${GRAIN_URL}")`;
  for (const [k, v] of Object.entries(MANA_COLOURS)) vars[`--ds-mana-${k.toLowerCase()}`] = v;
  // [M8-P1] booster foil (visual.md 2.8).
  const foil = FOILS[look.id] ?? FOILS.plain;
  foil.stops.forEach((c, i) => (vars[`--ds-foil-${i}`] = c));
  vars['--ds-foil-line'] = foil.line;
  for (const [k, v] of Object.entries(look.elevation)) vars[`--ds-elevation-${kebab(k)}`] = v;
  const m = motionTokens(look, reduced);
  for (const [k, v] of Object.entries(m.duration)) vars[`--ds-duration-${k}`] = `${v}ms`;
  for (const [k, v] of Object.entries(m.easing)) vars[`--ds-ease-${k}`] = v;
  for (const [k, v] of Object.entries(LAYOUT.space)) vars[`--ds-space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(LAYOUT.type)) vars[`--ds-type-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(LAYOUT.control)) vars[`--ds-control-${kebab(k)}`] = `${v}px`;
  vars['--ds-edge'] = `${LAYOUT.edge}px`;
  vars['color-scheme'] = look.scheme;
  return vars;
}
