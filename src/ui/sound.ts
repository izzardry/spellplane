/**
 * The theme's sound set, played (DESIGN "Themes and rendering", What a theme package contains: "Sound: an optional set
 * (card slide, tap, shuffle, turn chime, prompt tick), off by default in Paper"; theme table, Dusk: "muted ambience").
 *
 * The viewer's `Settings.sound` decides: 'theme' plays a set the theme turns on by default (`SoundSet.onByDefault`), 'on'
 * plays any set, 'off' plays nothing. Cues come from new lines of the action log, at most one of each kind per batch, so
 * a burst of moves (a tidy, a mulligan) is one slide, not a rattle. Browsers only start audio after a user gesture, so
 * the audio context is made on the viewer's first press or key; until then nothing plays and nothing is queued. Every
 * call into the theme's sources is guarded: a sound that fails never reaches the game.
 *
 * M7-P4 (card feel; PLAN Milestone 7, Owner decisions: "every common move has a short animation and sound (draw,
 * shuffle, tap and untap, play, to graveyard, attach, clip)"): the log rings the feel cues (FeelCue), the table scene
 * rings the viewer's own pickup and snap (util/feel.ts), and each look has synthesised cues of its own
 * (ui/sound-feel.ts) at its token gain (ui/design/tokens.ts SoundTokens). A cue a set lacks falls back to the look's,
 * then to the plain cue it refines (a draw to a slide, an untap to a tap), so older sets keep sounding as before.
 */
import type { LogEntry, SeatId, TableState, ZoneId } from '../core/types';
import { registerDebug } from '../util/debug';
import { live, track, untrack } from '../util/lifecycle';
import { lookOfTheme } from '../themes/index';
import type { LookId, SoundCue, SoundSet, SoundSource, ThemeId } from '../themes/types';
import { feelCues, tableTheme } from '../util/feel';
import { LOOKS } from './design/tokens';
import { LOOK_FEEL_SOUNDS } from './sound-feel';

export type SoundMode = 'theme' | 'on' | 'off';

/** Labels of the viewer's choices, in the picker's order. */
export const SOUND_MODES: readonly { id: SoundMode; label: string }[] = [
  { id: 'theme', label: "As the theme suggests" },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

/** The order cues of one batch play in. */
const CUE_ORDER: readonly SoundCue[] = ['turnChime', 'promptTick', 'shuffle', 'draw', 'play', 'toGraveyard', 'toExile', 'toHand', 'slide', 'attach', 'clip', 'tap', 'untap'];

/** The plain cue a feel cue refines, played when neither the set nor the look has the feel cue (M7-P4). */
export const CUE_FALLBACK: Readonly<Partial<Record<SoundCue, SoundCue>>> = {
  draw: 'slide',
  play: 'slide',
  toGraveyard: 'slide',
  toExile: 'slide',
  toHand: 'slide',
  untap: 'tap',
  attach: 'tap',
  clip: 'tap',
};

/** The zone kind of a zone id (`graveyard:s0` → graveyard). */
const kindOf = (zone: string): string => zone.split(':')[0] ?? zone;

/** The level the player hands the theme's sources; each set keeps its own cues quieter than this (Dusk: muted). */
export const SOUND_GAIN = 0.8;

/** Whether `set` plays under the viewer's `mode`. */
export function soundOn(set: SoundSet | undefined, mode: SoundMode): boolean {
  if (!set || mode === 'off') return false;
  return mode === 'on' || set.onByDefault === true;
}

/** Read a stored setting; anything unknown counts as the default ('theme'). */
export function soundModeOf(v: unknown): SoundMode {
  return v === 'on' || v === 'off' ? v : 'theme';
}

/**
 * The cues new log lines ring, at most one of each, in CUE_ORDER: a card moved (slide), tapped (tap), a library
 * shuffled (shuffle), the turn passed (turn chime), and another seat asking the table (prompt tick); M7-P4's feel cues
 * for a draw, a card put on the stack (play), to a graveyard or exile, into a hand, untapped, attached and clipped.
 */
export function cuesFor(entries: readonly LogEntry[], me: SeatId | null): SoundCue[] {
  const rung = new Set<SoundCue>();
  for (const e of entries) {
    if (e.kind !== 'action') continue;
    const a = e.action;
    switch (a.type) {
      case 'move': {
        const k = kindOf(a.to);
        rung.add(k === 'graveyard' ? 'toGraveyard' : k === 'exile' ? 'toExile' : k === 'stack' ? 'play' : 'slide');
        break;
      }
      case 'toZone':
        rung.add(kindOf(a.to) === 'hand' ? 'toHand' : 'slide');
        break;
      case 'draw':
        rung.add('draw');
        break;
      case 'stackPush':
        rung.add('play');
        break;
      case 'moveTemp':
      case 'settle':
      case 'tidy':
        rung.add('slide');
        break;
      case 'tap':
        rung.add(a.tapped ? 'tap' : 'untap');
        break;
      case 'attach':
        rung.add('attach');
        break;
      // A clip snaps on with the theme's short click (M6-P1; owner decisions: "the clip snaps on with a short sound").
      case 'clipAdd':
        rung.add('clip');
        break;
      case 'shuffleDone':
        rung.add('shuffle');
        break;
      // A solo shuffle is a reorder of the whole zone; a few cards put back in order slide.
      case 'reorder':
        rung.add(a.count > 7 ? 'shuffle' : 'slide');
        break;
      case 'turnPass':
        rung.add('turnChime');
        break;
      case 'ask':
        if (a.by !== me) rung.add('promptTick');
        break;
      default:
        break;
    }
  }
  return CUE_ORDER.filter((c) => rung.has(c));
}

/**
 * The piles new log lines shuffled (M7-P5: the library riffles when it is shuffled, and a table opens with a shuffle):
 * a finished shuffle round (`shuffleDone`, its zone from the state's round) or a solo shuffle, which is a `reorder` of
 * the whole zone. A partial reorder (the top cards put back in a chosen order) is no shuffle.
 */
export function shuffledZones(entries: readonly LogEntry[], state: TableState): ZoneId[] {
  const out = new Set<ZoneId>();
  for (const e of entries) {
    if (e.kind !== 'action') continue;
    const a = e.action;
    if (a.type === 'shuffleDone') {
      const r = state.shuffles[a.sid];
      if (r && r.purpose === 'shuffle') out.add(r.zone);
    } else if (a.type === 'reorder' && a.count > 1 && a.count === (state.zones[a.zone]?.ids.length ?? -1)) out.add(a.zone);
  }
  return [...out];
}

/** The audio context the player hands the theme's sources (a fake in unit tests). */
export type SoundContext = AudioContext;

function browserContext(): SoundContext | null {
  try {
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

/**
 * The page's one audio context (m7-adjustments.md, M7-P4 change 2: "One shared AudioContext, created on the first
 * gesture, suspended when the table is disposed"). Players enter and leave tables many times per page load; browsers cap
 * live audio contexts, so the context is made once and kept, suspended while no table plays. A table's player counts
 * it under `audioContexts` (util/lifecycle.ts) while it holds it, so on Home the count is 0. Added by M7-P5.
 */
let pageContext: SoundContext | null = null;
let pageFactory: () => SoundContext | null = browserContext;

/** How many page contexts were made since load (the debug hook: one for the whole page). */
let pageContextsMade = 0;

/** The page's audio context, made on first use (after a user gesture); null where Web Audio is missing. */
export function pageAudioContext(): SoundContext | null {
  if (!pageContext || pageContext.state === 'closed') {
    pageContext = pageFactory();
    if (pageContext) pageContextsMade++;
  }
  return pageContext;
}

/** The audio part of the debug hook (M7-P5): the page context's state, how many were made, and how many tables hold one. */
export interface AudioDebug {
  state(): AudioContextState | null;
  made(): number;
  live(): number;
  /** Make the page context as a user gesture would (tests: Playwright's clicks do, this is for a page without one). */
  unlock(): void;
}

declare module '../util/debug' {
  interface DebugParts {
    audio: AudioDebug;
  }
}

registerDebug({
  audio: {
    state: () => pageContext?.state ?? null,
    made: () => pageContextsMade,
    live: () => live().audioContexts,
    unlock: () => void pageAudioContext(),
  },
});

/** Replace the page context's factory and forget the context (unit tests with a fake context). */
export function setPageAudioFactoryForTests(make: () => SoundContext | null): void {
  pageFactory = make;
  pageContext = null;
  pageHolders.clear();
  livePlayers.length = 0;
  cancelChimeSuspend();
}

/** Whether `ctx` is the page's shared context (it is suspended, never closed, when a table lets it go). */
const isPageContext = (ctx: SoundContext | null): boolean => ctx !== null && ctx === pageContext;

/**
 * The table players holding the page context now. Two can be alive at once (a route that keeps the old HUD for an
 * outro, a harness with two HUDs): the context is counted under `audioContexts` from the first holder and let go,
 * suspended, only when the last one leaves.
 */
const pageHolders = new Set<object>();
/** The players alive, oldest first: the newest one rings the scene's feel cues, so a cue plays once. */
const livePlayers: object[] = [];
/** A suspend scheduled after the match-found chime played with no table holding the context. */
let chimeSuspend: ReturnType<typeof setTimeout> | null = null;
/** How long the chime needs before the page context may be suspended again, ms (it ends within 0.6 s). */
const CHIME_SUSPEND_MS = 700;

function cancelChimeSuspend(): void {
  if (chimeSuspend !== null) clearTimeout(chimeSuspend);
  chimeSuspend = null;
}

/** Hold the page context for a table player: counted from the first holder. */
function holdPageContext(holder: object, ctx: SoundContext): void {
  cancelChimeSuspend();
  pageHolders.add(holder);
  track('audioContexts', ctx);
}

/** Let the page context go for a table player: the last holder untracks it and suspends it. */
function releasePageContext(holder: object, ctx: SoundContext): void {
  if (!pageHolders.delete(holder) || pageHolders.size > 0) return;
  untrack('audioContexts', ctx);
  // Also when it still reads 'suspended': a resume asked for by the first press may be pending (WebKit), and a
  // suspend queued after it wins.
  if (ctx.state !== 'closed') ctx.suspend().catch(() => undefined);
}

/**
 * A match was found (SoundCue 'matchFound'; visual.md 2.3): one short, bright two-note chime, synthesised (no file),
 * under 0.6 s, peaking at a third of the gain it is given. Used by any set without its own `matchFound`.
 */
export const MATCH_FOUND_CHIME: SoundSource = {
  play(ctx, gain) {
    const t0 = ctx.currentTime;
    const peak = Math.max(0.0001, Math.min(1, gain) / 3);
    const notes: readonly [number, number][] = [
      [784, 0],
      [1175, 0.11],
    ];
    for (const [freq, delay] of notes) {
      const at = t0 + delay;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.45);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    }
  },
};

/**
 * Play the match-found chime outside a table (Home, the queue; M8-P7 calls it): on the page's context, after a user
 * gesture made it possible; a failure stays silent. Returns whether a sound was scheduled. `mode` is the viewer's
 * `Settings.sound`: 'off' plays nothing.
 */
export function playMatchFound(mode: SoundMode = 'theme', set?: SoundSet): boolean {
  if (mode === 'off') return false;
  const ctx = pageAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    (set?.matchFound ?? MATCH_FOUND_CHIME).play(ctx, SOUND_GAIN);
    // Outside a table nothing else plays: once the chime is over, the audio thread stops again.
    if (pageHolders.size === 0) {
      cancelChimeSuspend();
      chimeSuspend = setTimeout(() => {
        chimeSuspend = null;
        if (pageHolders.size === 0 && ctx === pageContext && ctx.state === 'running') ctx.suspend().catch(() => undefined);
      }, CHIME_SUSPEND_MS);
    }
    return true;
  } catch {
    return false;
  }
}

/** Whether a string is a sound cue the player knows (cues from the scene arrive as plain strings, util/feel.ts). */
function isCue(c: string): c is SoundCue {
  return (CUE_ORDER as readonly string[]).includes(c) || c === 'pickup' || c === 'snap' || c === 'drop' || c === 'toLibrary' || c === 'matchFound';
}

/** Plays the current theme's set under the viewer's setting. */
export class ThemeSoundPlayer {
  private ctx: SoundContext | null = null;
  private set: SoundSet | undefined = undefined;
  private mode: SoundMode = 'theme';
  private ambience: { stop(): void } | null = null;
  private disposed = false;
  /** The look of the table's theme (util/feel.ts tableTheme), null for an M4 theme (M7-P4). */
  private look: LookId | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  /** The cues played last (newest last, at most 20): for tests and the debug view. */
  readonly played: SoundCue[] = [];

  constructor(
    private readonly makeContext: () => SoundContext | null = pageAudioContext,
    private readonly gain = SOUND_GAIN,
  ) {
    // The table scene says which look it draws and rings the viewer's own pickup and snap (util/feel.ts).
    this.setLookOf(tableTheme.value);
    livePlayers.push(this);
    this.unsubscribe.push(
      tableTheme.subscribe((id) => this.setLookOf(id)),
      feelCues.subscribe((c) => {
        // One player rings a cue: the newest alive (two alive at once would play it twice).
        if (isCue(c) && livePlayers[livePlayers.length - 1] === this) this.play([c]);
      }),
    );
  }

  /** Follow the table's theme: a look's theme brings the look's cues and gain (M7-P4). */
  setLookOf(themeId: string | null): void {
    const look = themeId ? lookOfTheme(themeId as ThemeId) : null;
    if (look === this.look) return;
    this.look = look;
    this.sync();
  }

  /** The set that decides whether sound plays: the theme's, else the look's own cues (on by default as its tokens say). */
  private playing(): SoundSet | undefined {
    if (this.set) return this.set;
    return this.look ? { ...LOOK_FEEL_SOUNDS[this.look], onByDefault: LOOKS[this.look].sound.onByDefault } : undefined;
  }

  /** The source of a cue: the theme's set, the look's synthesised cue, then the plain cue it refines. */
  private source(c: SoundCue): SoundSource | undefined {
    const look = this.look ? LOOK_FEEL_SOUNDS[this.look] : undefined;
    if (c === 'matchFound') return this.set?.matchFound ?? MATCH_FOUND_CHIME;
    const fb = CUE_FALLBACK[c];
    return this.set?.[c] ?? look?.[c] ?? (fb ? (this.set?.[fb] ?? look?.[fb]) : undefined);
  }

  /** Whether the current theme's set plays now. */
  enabled(): boolean {
    return !this.disposed && soundOn(this.playing(), this.mode);
  }

  /** Whether the room tone of the set is running. */
  ambient(): boolean {
    return this.ambience !== null;
  }

  /** A theme switch: the old set's ambience stops; the new one's starts if it plays. */
  setTheme(set: SoundSet | undefined): void {
    if (set === this.set) return;
    this.stopAmbience();
    this.set = set;
    this.sync();
  }

  setMode(mode: SoundMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.sync();
  }

  /** A user gesture happened: audio may start now (browsers' autoplay rule). */
  unlock(): void {
    if (!this.enabled()) return;
    if (!this.ctx) this.ctx = this.makeContext();
    if (!this.ctx) return;
    // Counted while a table holds it (contracts.md Part C): the page context from its first holder to its last.
    if (isPageContext(this.ctx)) holdPageContext(this, this.ctx);
    else track('audioContexts', this.ctx);
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    this.sync();
  }

  /** Play cues (from `cuesFor`); nothing before the first gesture or while the set is off. */
  play(cues: readonly SoundCue[]): void {
    if (!this.enabled() || !this.ctx) return;
    const tokens = this.look ? LOOKS[this.look].sound : null;
    // A look plays at its own gain under the player's ceiling, and only the cues its tokens list.
    const gain = tokens ? this.gain * Math.max(0, Math.min(1, tokens.gain)) : this.gain;
    for (const c of cues) {
      if (tokens && c !== 'matchFound' && !tokens.cues.includes(c)) continue;
      const src = this.source(c);
      if (!src) continue;
      try {
        src.play(this.ctx, gain);
        this.played.push(c);
        if (this.played.length > 20) this.played.shift();
      } catch {
        // A cue that fails stays silent.
      }
    }
  }

  dispose(): void {
    for (const u of this.unsubscribe.splice(0)) u();
    const at = livePlayers.indexOf(this);
    if (at >= 0) livePlayers.splice(at, 1);
    this.stopAmbience();
    this.disposed = true;
    const ctx = this.ctx;
    this.ctx = null;
    if (!ctx) return;
    // The page's context is kept for the next table, suspended once no table holds it; a context of its own (a
    // test's) is closed.
    if (isPageContext(ctx)) releasePageContext(this, ctx);
    else {
      untrack('audioContexts', ctx);
      ctx.close().catch(() => undefined);
    }
  }

  private sync(): void {
    if (!this.enabled()) {
      this.stopAmbience();
      return;
    }
    if (this.ctx && this.set?.ambience && !this.ambience) {
      try {
        this.ambience = this.set.ambience.start(this.ctx, this.gain);
      } catch {
        this.ambience = null;
      }
    }
  }

  private stopAmbience(): void {
    const a = this.ambience;
    this.ambience = null;
    try {
      a?.stop();
    } catch {
      // Already stopped.
    }
  }
}
