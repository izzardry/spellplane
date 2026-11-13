/**
 * The functional signals every theme must render distinguishably (DESIGN "Themes and rendering": "Functional signals
 * (tapped, selected, attacking, whose card, who is speaking) are defined once in the engine and every theme must render
 * all of them distinguishably; a theme checklist and a screenshot test per signal enforce this"; PLAN M4-P6 lists the
 * twelve). Added by M4-C. These twelve are also the "twelve gate states" of PLAN M4-P3..P5 and the M4-G matrix.
 *
 * For each signal this file says where it is drawn, what state makes it on or off, how a conformance check finds the
 * element on screen (through the debug hook or a DOM selector, never by guessing pixels), which theme fields style it,
 * and the threshold the controlled screenshot pair must pass. M4-P6 writes the checks (tests/e2e/signals.spec.ts).
 * Pure data and pure colour maths: no DOM, no Three.js.
 */
import type { LineKind } from '../core/types';

/** The twelve functional signals (PLAN M4-P6; DESIGN "Themes and rendering"). Added by M4-C. */
export type SignalId =
  | 'tapped'
  | 'selected'
  | 'hovered'
  | 'displaced'
  | 'attacking'
  | 'blocking'
  | 'faceDown'
  | 'foil'
  | 'seatColour'
  | 'speaking'
  | 'pendingConfirmation'
  | 'away';

/**
 * How a conformance check finds the screen region of a signal (DESIGN "Themes and rendering", screenshot test per
 * signal; CLAUDE.md: the debug hook locates things, screenshots are evidence). The region of a pair is the union of
 * the neutral and the signalled region, so a moved or rotated card is compared over the same pixels. Added by M4-C.
 *
 * - `card`: the card's `screen` rectangle from `__spellplane.cards()`, grown by `marginMm` (outlines, sheen, badges).
 * - `cardAndGhost`: the card plus its ghost outline at the home slot (`ghost` pose of the scene's debug card).
 * - `cardAndLine`: the card plus the bounding box of the drawn line of `lineKind` that starts at it (`__spellplane.drawnLines()`).
 * - `stackItem`: the stack entry's `screen` rectangle from `__spellplane.stack()` whose `pending` flag is the signal.
 * - `element`: a DOM element (`selector`, `{seat}` replaced by the seat id) whose `attribute` reads `on` or `off`.
 * - `seatLine`: a target line drawn by each seat colour in turn, compared with the table surface and with every other seat colour.
 */
export type SignalProbe =
  | { kind: 'card'; marginMm: number }
  | { kind: 'cardAndGhost'; marginMm: number }
  | { kind: 'cardAndLine'; lineKind: LineKind; marginMm: number }
  | { kind: 'stackItem'; marginMm: number }
  | { kind: 'element'; selector: string; attribute: string; on: string; off: string }
  | { kind: 'seatLine'; lineKind: LineKind };

/**
 * The difference a controlled screenshot pair must show (PLAN M4-P6: "differs from its neutral version by a measured
 * contrast threshold"): at least `changedFraction` of the region's pixels differ by more than `channelDelta` (0–255,
 * largest of the R, G and B differences). Added by M4-C.
 */
export interface SignalThreshold {
  channelDelta: number;
  changedFraction: number;
}

/** The default threshold: 2% of the region's pixels change by more than 24 of 255 in some channel (M4-C's choice, docs/DECISIONS.md). */
export const DEFAULT_SIGNAL_THRESHOLD: SignalThreshold = { channelDelta: 24, changedFraction: 0.02 };

/**
 * Seat-colour conformance (DESIGN "Themes and rendering", Tokens: seat colours "tuned per theme for contrast";
 * "Input and interaction design", Accessibility: seat colours are paired with a pattern and glyph). Each seat colour
 * reaches `surface` contrast (WCAG 1.4.11 non-text, 3:1) against the theme's table surface, and every two seat colours
 * are at least `pairwise` apart (Euclidean distance of sRGB channels in 0..1). Added by M4-C; M4-P6 tunes the colours.
 */
export const SEAT_CONTRAST = { surface: 3, pairwise: 0.15 } as const;

/** Where a signal is drawn (DESIGN "Camera and navigation", Screen-anchored layer: avatars and the prompt are DOM). Added by M4-C. */
export type SignalSurface = 'scene' | 'hud';

/** Where the signal's truth lives (DESIGN "Data model and protocol": shared state, local view state, presence). Added by M4-C. */
export type SignalSource = 'state' | 'view' | 'presence';

/** One functional signal and how it is checked (DESIGN "Themes and rendering"; PLAN M4-P6). Added by M4-C. */
export interface SignalSpec {
  id: SignalId;
  label: string;
  surface: SignalSurface;
  source: SignalSource;
  /** The neutral state of the controlled pair. */
  neutral: string;
  /** The signalled state of the pair; everything else is unchanged. */
  signalled: string;
  probe: SignalProbe;
  /** Theme fields that style it (paths into Theme), for the theme checklist. */
  styledBy: string[];
  /** True when the check runs once per seat colour (eight). */
  perSeat: boolean;
  threshold: SignalThreshold;
}

/** The twelve signals in the PLAN's order (PLAN M4-P6). Added by M4-C. */
export const SIGNALS: readonly SignalSpec[] = [
  {
    id: 'tapped',
    label: 'Tapped',
    surface: 'scene',
    source: 'state',
    neutral: 'an untapped card on the battlefield',
    signalled: 'the same card tapped (CardInstance.tapped)',
    probe: { kind: 'card', marginMm: 6 },
    styledBy: ['cardDressing.tappedBadge', 'motion.tapMs'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'selected',
    label: 'Selected',
    surface: 'scene',
    source: 'view',
    neutral: 'a card, nothing selected',
    signalled: 'the same card in ViewState.selection',
    probe: { kind: 'card', marginMm: 4 },
    styledBy: ['cardDressing.selected'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'hovered',
    label: 'Hovered',
    surface: 'scene',
    source: 'view',
    neutral: 'a card, nothing hovered',
    signalled: 'the same card as ViewState.hovered',
    probe: { kind: 'card', marginMm: 4 },
    styledBy: ['cardDressing.hover'],
    perSeat: false,
    threshold: { channelDelta: 24, changedFraction: 0.01 },
  },
  {
    id: 'displaced',
    label: 'Displaced',
    surface: 'scene',
    source: 'state',
    neutral: 'a card at its home slot',
    signalled: 'the same card moved temporarily (Alt-drag), with its ghost outline at the home slot',
    probe: { kind: 'cardAndGhost', marginMm: 4 },
    styledBy: ['cardDressing.ghost', 'cardDressing.displacedMarker'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'attacking',
    label: 'Attacking',
    surface: 'scene',
    source: 'state',
    neutral: 'an untapped creature on the battlefield',
    signalled: 'the same creature attacking an opponent (displaced forward, attack line to the avatar)',
    probe: { kind: 'cardAndLine', lineKind: 'attack', marginMm: 4 },
    styledBy: ["lineStyle('attack')"],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'blocking',
    label: 'Blocking',
    surface: 'scene',
    source: 'state',
    neutral: 'an attacker and an untouched creature of the defender',
    signalled: 'the defender’s creature blocking the attacker (moved in front of it, block line)',
    probe: { kind: 'cardAndLine', lineKind: 'block', marginMm: 4 },
    styledBy: ["lineStyle('block')"],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'faceDown',
    label: 'Face-down',
    surface: 'scene',
    source: 'state',
    neutral: 'a face-up card seen by an opponent',
    signalled: 'the same card face down (the neutral back)',
    probe: { kind: 'card', marginMm: 0 },
    styledBy: ['cardDressing.back', 'cardDressing.faceDownOwnerOpacity'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'foil',
    label: 'Foil',
    surface: 'scene',
    source: 'state',
    neutral: 'a non-foil printing, reduced motion on (static sheen)',
    signalled: 'the same printing foil (CardRef.foil)',
    // The sheen is a rim just outside the face (faces are never tinted), so the probe takes the outline's margin (M4-G).
    probe: { kind: 'card', marginMm: 4 },
    styledBy: ['cardDressing.foilSheen'],
    perSeat: false,
    threshold: { channelDelta: 16, changedFraction: 0.02 },
  },
  {
    id: 'seatColour',
    label: 'Seat colour',
    surface: 'scene',
    source: 'state',
    neutral: 'the table surface without the line',
    signalled: 'a target line drawn by a seat holding each seat colour in turn',
    probe: { kind: 'seatLine', lineKind: 'target' },
    styledBy: ['tokens.colours.seats', "lineStyle('target')"],
    perSeat: true,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'speaking',
    label: 'Speaking',
    surface: 'hud',
    source: 'presence',
    neutral: 'a player’s avatar, silent',
    signalled: 'the same avatar while the player speaks (speaking ring)',
    probe: { kind: 'element', selector: '[data-testid="avatar"][data-seat="{seat}"]', attribute: 'data-speaking', on: 'true', off: 'false' },
    styledBy: ['tokens.colours.seats', 'tokens.hud'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'pendingConfirmation',
    label: 'Pending confirmation',
    surface: 'scene',
    source: 'state',
    neutral: 'a stack item after every player passed',
    signalled: 'the same stack item while a confirmation round waits on it',
    probe: { kind: 'stackItem', marginMm: 4 },
    styledBy: ['cardDressing.pending'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
  {
    id: 'away',
    label: 'Away',
    surface: 'hud',
    source: 'state',
    neutral: 'a connected player’s avatar',
    signalled: 'the same avatar with Seat.away set',
    probe: { kind: 'element', selector: '[data-testid="avatar"][data-seat="{seat}"]', attribute: 'data-away', on: 'true', off: 'false' },
    styledBy: ['tokens.colours.muted', 'tokens.hud'],
    perSeat: false,
    threshold: DEFAULT_SIGNAL_THRESHOLD,
  },
];

/** The signal ids in order (PLAN M4-P6). Added by M4-C. */
export const SIGNAL_IDS: readonly SignalId[] = SIGNALS.map((s) => s.id);

/** sRGB channels 0..1 of a #rgb or #rrggbb colour (DESIGN "Themes and rendering", Tokens). Added by M4-C. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG relative luminance of a hex colour (DESIGN "Input and interaction design", Accessibility: AA contrast). Added by M4-C. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours, 1..21 (DESIGN "Input and interaction design", Accessibility). Added by M4-C. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Euclidean distance of two hex colours' sRGB channels in 0..1 (SEAT_CONTRAST.pairwise). Added by M4-C. */
export function colourDistance(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
