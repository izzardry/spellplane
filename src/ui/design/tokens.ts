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

/** Corner radii of a look in px (docs/design/m7-directions.html `--t-r`, `--t-rpill`, `--t-rplate`). Added by M7-C. */
export interface RadiusTokens {
  /** Small controls inside panels (chips, keys, steppers). */
  sm: number;
  /** Buttons, panels, the selection strip. */
  md: number;
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
}

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
}

/**
 * Sizes and spacing shared by every look (PLAN Milestone 7, Principles: "Themes change materials and mood, not layout or
 * controls"; docs/design/m7-directions.html mock base: buttons 40, primary 52, talk 52, tracker 44, avatar 52; touch
 * targets 44 pt). px. Added by M7-C.
 */
export const LAYOUT = {
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  type: { label: 11, small: 12, body: 14, control: 15, title: 17, heading: 20, display: 34, life: 48, brand: 56 },
  lineHeight: { tight: 1.15, body: 1.35 },
  control: { height: 40, primary: 52, talk: 52, tracker: 44, touch: 44, stripAction: 34, stepper: 30, avatar: 52, avatarSmall: 38 },
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
  },
  type: {
    body: ROUNDED,
    heading: ROUNDED,
    numeral: ROUNDED,
    mono: MONO,
    weight: { regular: 400, medium: 500, bold: 700, heavy: 800 },
    headingWeight: 800,
    numeralWeight: 800,
    labelCase: 'none',
    labelSpacingEm: 0,
    headingSmallCaps: false,
    tabularNums: true,
  },
  radius: { sm: 8, md: 14, pill: 22, plate: 40 },
  elevation: {
    raised: '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 2px 0 rgba(70, 48, 30, 0.12), 0 6px 14px rgba(70, 48, 30, 0.16)',
    pop: '0 10px 24px rgba(60, 40, 24, 0.26)',
    primary: '0 3px 0 #8e3a1f, 0 8px 18px rgba(140, 60, 30, 0.32)',
    card: '0 1px 1px rgba(40, 25, 10, 0.3), 0 4px 10px rgba(40, 25, 10, 0.22)',
    cardLifted: '0 2px 2px rgba(40, 25, 10, 0.25), 0 14px 28px rgba(40, 25, 10, 0.3)',
  },
  motion: {
    duration: { fast: 120, base: 200, slow: 320, deliberate: 480 },
    easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', enter: 'cubic-bezier(0, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: 'cubic-bezier(0.34, 1.4, 0.64, 1)' },
  },
  sound: { gain: 0.8, cues: ALL_CUES, onByDefault: true },
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
  },
  type: {
    body: SYSTEM,
    heading: SYSTEM,
    numeral: SYSTEM,
    mono: MONO,
    weight: { regular: 400, medium: 500, bold: 600, heavy: 700 },
    headingWeight: 650,
    numeralWeight: 600,
    labelCase: 'uppercase',
    labelSpacingEm: 0.08,
    headingSmallCaps: false,
    tabularNums: true,
  },
  radius: { sm: 6, md: 10, pill: 10, plate: 12 },
  elevation: {
    raised: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.28)',
    pop: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 2px 6px rgba(0, 0, 0, 0.4), 0 12px 28px rgba(0, 0, 0, 0.45)',
    primary: '0 2px 0 #249a76, 0 8px 18px rgba(63, 210, 163, 0.18)',
    card: '0 2px 6px rgba(0, 0, 0, 0.5)',
    cardLifted: '0 4px 8px rgba(0, 0, 0, 0.45), 0 16px 32px rgba(0, 0, 0, 0.5)',
  },
  motion: {
    duration: { fast: 100, base: 180, slow: 280, deliberate: 420 },
    easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', enter: 'cubic-bezier(0, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: 'cubic-bezier(0, 0, 0.2, 1)' },
  },
  sound: { gain: 0.5, cues: ALL_CUES, onByDefault: true },
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
  },
  type: {
    body: SYSTEM,
    heading: BOOK,
    numeral: BOOK,
    mono: MONO,
    weight: { regular: 400, medium: 500, bold: 600, heavy: 700 },
    headingWeight: 600,
    numeralWeight: 500,
    labelCase: 'uppercase',
    labelSpacingEm: 0.12,
    headingSmallCaps: true,
    tabularNums: true,
  },
  radius: { sm: 4, md: 6, pill: 6, plate: 6 },
  elevation: {
    raised: '0 4px 12px rgba(0, 0, 0, 0.35)',
    pop: '0 12px 30px rgba(0, 0, 0, 0.5)',
    primary: '0 0 0 3px rgba(184, 67, 47, 0.25), 0 6px 16px rgba(0, 0, 0, 0.4)',
    card: '0 3px 10px rgba(0, 0, 0, 0.5)',
    cardLifted: '0 6px 12px rgba(0, 0, 0, 0.45), 0 18px 36px rgba(0, 0, 0, 0.55)',
  },
  motion: {
    duration: { fast: 140, base: 220, slow: 360, deliberate: 520 },
    easing: { standard: 'cubic-bezier(0.3, 0, 0.1, 1)', enter: 'cubic-bezier(0.1, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)', bounce: 'cubic-bezier(0.1, 0, 0.2, 1)' },
  },
  sound: { gain: 0.7, cues: ALL_CUES, onByDefault: true },
};

/** The three looks' tokens (PLAN Milestone 7, Owner decisions after the first design round). Added by M7-C. */
export const LOOKS: Readonly<Record<LookId, LookTokens>> = { kitchen: KITCHEN, graphite: GRAPHITE, codex: CODEX };

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
  for (const [k, v] of Object.entries(t.weight)) vars[`--ds-weight-${k}`] = String(v);
  vars['--ds-heading-weight'] = String(t.headingWeight);
  vars['--ds-numeral-weight'] = String(t.numeralWeight);
  vars['--ds-label-case'] = t.labelCase;
  vars['--ds-label-spacing'] = `${t.labelSpacingEm}em`;
  vars['--ds-heading-variant'] = t.headingSmallCaps ? 'small-caps' : 'normal';
  vars['--ds-numeric'] = t.tabularNums ? 'tabular-nums' : 'normal';
  for (const [k, v] of Object.entries(look.radius)) vars[`--ds-radius-${k}`] = `${v}px`;
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
