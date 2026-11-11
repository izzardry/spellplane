/**
 * The confirmation prompt's view model and countdown (DESIGN "Turn flow and confirmation", Confirmation rounds;
 * "Specification: network protocol and secrecy", Timers: each client animates its own countdown from the moment it
 * applied the action that started it; only the sequencer's clock decides). Pure apart from the `now` it is given.
 */
import { blockingHolder, hasPassed, participants, roundPassed, timerStartSeq, waitingOn } from '../../core/reducer/confirm';
import type { ConfirmRound, SeatId, StackItem, TableState } from '../../core/types';

/**
 * What this seat sees of the open round:
 * - 'respond': it has not answered; it gets OK and Hold.
 * - 'holding': it holds the floor; it gets Release.
 * - 'watching': it asked, already passed, or does not answer (an empty chair, a spectator); it sees who the round
 *   is waiting for.
 */
export type PromptMode = 'respond' | 'holding' | 'watching';

export interface PromptModel {
  round: ConfirmRound;
  mode: PromptMode;
  /** The stack item the round is about, if it is still there. */
  item: StackItem | null;
  /** Seats that answer the round (everyone seated but the asker), in seat order. */
  participants: SeatId[];
  /** Seats the round still waits for (silent or holding), in seat order. */
  waitingOn: SeatId[];
  /** The seat holding the floor while it stops the timers, else null. */
  holder: SeatId | null;
  /** Everyone passed: Resolve is fully lit. */
  allPassed: boolean;
  /** Whether a countdown runs: a timer is set, nobody holds, someone is still silent. */
  timerRunning: boolean;
  /** Identity of the countdown: changes when a round starts or a release restarts it. */
  timerKey: string;
}

/** The prompt for `me`, or null when there is no round. */
export function promptModel(state: TableState, me: SeatId | null): PromptModel | null {
  const round = state.confirm;
  if (!round) return null;
  const holder = blockingHolder(state);
  const waiting = waitingOn(state);
  const seats = participants(state, round);
  const answers = me !== null && seats.includes(me);
  let mode: PromptMode = 'watching';
  if (answers && round.holder === me) mode = 'holding';
  else if (answers && !hasPassed(state, me)) mode = 'respond';
  return {
    round,
    mode,
    item: round.about !== undefined ? (state.stack.find((i) => i.id === round.about) ?? null) : null,
    participants: seats,
    waitingOn: waiting,
    holder,
    allPassed: roundPassed(state),
    timerRunning: round.durationMs > 0 && holder === null && waiting.length > 0,
    // The start seq of an optimistic apply may differ from the sequenced one: key the start by the round alone.
    timerKey: `${round.id}:${round.timerSeq === undefined ? 'start' : timerStartSeq(round)}`,
  };
}

/**
 * A client's own countdown (DESIGN "Specification: network protocol and secrecy", Timers). `observe` it with every
 * state this client applies and the local time it applied it; `fraction` is what is left of the pass timer, 1 at the
 * start, 0 when it ran out. A hold freezes the countdown where it was; a release restarts it from full.
 */
export class Countdown {
  private key: string | null = null;
  private startedAt = 0;
  private frozen: number | null = null;
  private duration = 0;

  observe(model: PromptModel | null, now: number): void {
    if (!model) {
      this.key = null;
      this.frozen = null;
      return;
    }
    if (model.timerKey !== this.key) {
      this.key = model.timerKey;
      this.startedAt = now;
      this.frozen = null;
    }
    this.duration = model.round.durationMs;
    if (!model.timerRunning && this.frozen === null) this.frozen = this.live(now);
    else if (model.timerRunning && this.frozen !== null) {
      // The timer runs again without a new key (a lapsed hold): continue from where it stood.
      this.startedAt = now - (1 - this.frozen) * this.duration;
      this.frozen = null;
    }
  }

  private live(now: number): number {
    if (!(this.duration > 0)) return 1;
    return Math.min(1, Math.max(0, 1 - (now - this.startedAt) / this.duration));
  }

  /** Remaining share of the pass timer, 0..1. */
  fraction(now: number): number {
    return this.frozen ?? this.live(now);
  }

  /** Remaining whole seconds, rounded up (for the label). */
  seconds(now: number): number {
    return Math.ceil((this.fraction(now) * this.duration) / 1000);
  }
}

/** What a round is about, after the asker's name: "cast Spark Jolt", "asks “attacks?”" (DESIGN "Turn flow and confirmation", Prompt). */
export function roundWhat(state: TableState, round: ConfirmRound, nameOf: (card: string) => string): string {
  if (round.label) return `asks “${round.label}”`;
  const item = round.about !== undefined ? state.stack.find((i) => i.id === round.about) : undefined;
  if (!item) return 'asks for responses';
  const source = item.source !== undefined ? nameOf(item.source) : null;
  switch (item.kind) {
    case 'spell':
      return item.card !== undefined ? `cast ${nameOf(item.card)}` : 'cast a spell';
    case 'ability':
      return source ? `activated an ability of ${source}` : 'activated an ability';
    case 'trigger':
      return source ? `put a trigger of ${source} on the stack` : 'put a trigger on the stack';
    case 'copy': {
      const of = item.copyOf !== undefined ? state.stack.find((i) => i.id === item.copyOf) : undefined;
      const name = of?.card !== undefined ? nameOf(of.card) : of?.source !== undefined ? nameOf(of.source) : null;
      return name ? `copied ${name}` : 'put a copy on the stack';
    }
  }
}
