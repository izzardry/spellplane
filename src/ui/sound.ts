/**
 * The theme's sound set, played (DESIGN "Themes and rendering", What a theme package contains: "Sound: an optional set
 * (card slide, tap, shuffle, turn chime, prompt tick), off by default in Paper"; theme table, Dusk: "muted ambience").
 *
 * The viewer's `Settings.sound` decides: 'theme' plays a set the theme turns on by default (`SoundSet.onByDefault`), 'on'
 * plays any set, 'off' plays nothing. Cues come from new lines of the action log, at most one of each kind per batch, so
 * a burst of moves (a tidy, a mulligan) is one slide, not a rattle. Browsers only start audio after a user gesture, so
 * the audio context is made on the viewer's first press or key; until then nothing plays and nothing is queued. Every
 * call into the theme's sources is guarded: a sound that fails never reaches the game.
 */
import type { LogEntry, SeatId } from '../core/types';
import type { SoundCue, SoundSet } from '../themes/types';

export type SoundMode = 'theme' | 'on' | 'off';

/** Labels of the viewer's choices, in the picker's order. */
export const SOUND_MODES: readonly { id: SoundMode; label: string }[] = [
  { id: 'theme', label: "As the theme suggests" },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

/** The order cues of one batch play in. */
const CUE_ORDER: readonly SoundCue[] = ['turnChime', 'promptTick', 'shuffle', 'slide', 'tap'];

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
 * The cues new log lines ring, at most one of each, in CUE_ORDER: a card moved (slide), tapped or untapped (tap), a
 * library shuffled (shuffle), the turn passed (turn chime), and another seat asking the table (prompt tick).
 */
export function cuesFor(entries: readonly LogEntry[], me: SeatId | null): SoundCue[] {
  const rung = new Set<SoundCue>();
  for (const e of entries) {
    if (e.kind !== 'action') continue;
    const a = e.action;
    switch (a.type) {
      case 'move':
      case 'moveTemp':
      case 'settle':
      case 'toZone':
      case 'draw':
      case 'tidy':
        rung.add('slide');
        break;
      case 'tap':
        rung.add('tap');
        break;
      case 'shuffleDone':
        rung.add('shuffle');
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

/** Plays the current theme's set under the viewer's setting. */
export class ThemeSoundPlayer {
  private ctx: SoundContext | null = null;
  private set: SoundSet | undefined = undefined;
  private mode: SoundMode = 'theme';
  private ambience: { stop(): void } | null = null;
  private disposed = false;
  /** The cues played last (newest last, at most 20): for tests and the debug view. */
  readonly played: SoundCue[] = [];

  constructor(
    private readonly makeContext: () => SoundContext | null = browserContext,
    private readonly gain = SOUND_GAIN,
  ) {}

  /** Whether the current theme's set plays now. */
  enabled(): boolean {
    return !this.disposed && soundOn(this.set, this.mode);
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
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    this.sync();
  }

  /** Play cues (from `cuesFor`); nothing before the first gesture or while the set is off. */
  play(cues: readonly SoundCue[]): void {
    if (!this.enabled() || !this.ctx || !this.set) return;
    for (const c of cues) {
      const src = this.set[c];
      if (!src) continue;
      try {
        src.play(this.ctx, this.gain);
        this.played.push(c);
        if (this.played.length > 20) this.played.shift();
      } catch {
        // A cue that fails stays silent.
      }
    }
  }

  dispose(): void {
    this.stopAmbience();
    this.disposed = true;
    const ctx = this.ctx;
    this.ctx = null;
    ctx?.close().catch(() => undefined);
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
