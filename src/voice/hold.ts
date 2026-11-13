/**
 * The Ctrl talk key's hold-alone rule (PLAN Milestone 5, owner decisions, Talk key: "The mic and dictation open only
 * after Ctrl has been held alone for about 200 ms. A key or click during that time makes it a shortcut (Ctrl+Z,
 * Ctrl+Enter, Ctrl+T, Ctrl+click), and no audio or caption is sent"). Contract: voice/types.ts HoldAloneGate,
 * TALK_HOLD_ALONE_MS. Contracts: M5-C. Implementer: M5-P7.
 *
 * A pure state machine with injected time (DECISIONS [M5-P7]):
 * - `down` starts 'pending' (a second down while held changes nothing: key repeat, or the other Ctrl key).
 * - `tick` turns 'pending' into 'talking' once the key was held alone for `holdMs`; the boundary counts as held.
 * - `other` (another key, a click, a wheel turn) while 'pending' makes it a 'shortcut' until the key is released. Once
 *   'talking' it stays 'talking': the mic is already open and a later key does not snatch it shut mid-sentence.
 * - `up` and `reset` return to 'idle'. A release before `holdMs` never talks, even if no tick came in between.
 */
import { TALK_HOLD_ALONE_MS, type HoldAloneGate, type HoldAloneState } from './types';

class Gate implements HoldAloneGate {
  private st: HoldAloneState = 'idle';
  private since = 0;
  private teamKey = false;

  constructor(private readonly holdMs: number) {}

  down(now: number, team: boolean): HoldAloneState {
    if (this.st !== 'idle') return this.st;
    this.st = 'pending';
    this.since = now;
    this.teamKey = team;
    return this.st;
  }

  other(now: number): HoldAloneState {
    // A key that arrives after the hold time but before the timer's tick still finds the mic due: it talks.
    this.tick(now);
    if (this.st === 'pending') this.st = 'shortcut';
    return this.st;
  }

  up(_now: number): HoldAloneState {
    this.st = 'idle';
    this.teamKey = false;
    return this.st;
  }

  tick(now: number): HoldAloneState {
    if (this.st === 'pending' && Number.isFinite(now) && now - this.since >= this.holdMs) this.st = 'talking';
    return this.st;
  }

  reset(): void {
    this.st = 'idle';
    this.teamKey = false;
  }

  state(): HoldAloneState {
    return this.st;
  }

  /** Whether Shift was held when the key went down (team talk). */
  team(): boolean {
    return this.teamKey;
  }
}

/** A hold-alone gate with its team flag (Shift at the key's down). */
export type HoldAloneGateWithTeam = HoldAloneGate & { team(): boolean };

/** Create the hold-alone gate (pure; time is injected). Implementer: M5-P7. Added by M5-C. */
export function createHoldAloneGate(holdMs: number = TALK_HOLD_ALONE_MS): HoldAloneGateWithTeam {
  const ms = Number.isFinite(holdMs) && holdMs >= 0 ? holdMs : TALK_HOLD_ALONE_MS;
  return new Gate(ms);
}
