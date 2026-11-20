/**
 * The bot runner (computer.md 3.1, 5 and 6): it subscribes to the bot's session, waits the pace delay, rebuilds the
 * view, decides one step and executes it through the session; the table is the truth, so nothing is remembered between
 * steps except the watchdog's counts. It takes its clock as an argument (no DOM or real timers here); the route pauses
 * it while the page is hidden. `dispose()` stops every timer and listener. Counted as `botRunners`, its pending timer
 * as `timers` (util/lifecycle.ts).
 */
import type { ActionDraft } from '../core/actions';
import type { TableState } from '../core/types';
import { track, untrack } from '../util/lifecycle';
import { decide, type DecideContext } from './plan';
import type { BotClock, BotConfig, BotPace, BotProfile, BotSeatPort, BotStatus, BotStep, BotStepKind, BotView } from './types';
import { BOT_PACE_MS, BOT_PROFILES } from './types';
import { buildView } from './view';

export interface BotRunner {
  status(): BotStatus;
  subscribe(listener: (s: BotStatus) => void): () => void;
  pause(): void;
  resume(): void;
  setPace(pace: BotPace): void;
  /** Swap the clock (the debug hook's manual clock); a pending step is rescheduled on it. */
  setClock(clock: BotClock): void;
  /** Decide and execute one step now, skipping the delay; resolves to the step (null: nothing to do). */
  stepNow(): Promise<BotStep | null>;
  view(): BotView;
  lastStep(): BotStep | null;
  /** Steps executed since the runner started. */
  steps(): number;
  dispose(): void;
}

export interface RunnerOptions {
  port: BotSeatPort;
  config: BotConfig;
  clock: BotClock;
  ctx?: DecideContext;
  /** Errors of steps (logged to the console by the caller). */
  onError?: (e: unknown) => void;
}

/** Three refused or repeated steps of one kind in a turn skip that kind for the turn (computer.md 10.4). */
const REPEATS = 3;
/** Three throws in a row stop the runner (computer.md 10.4). */
const THROWS = 3;
/** How long to wait for the own proposals to be sequenced before looking again. */
const SETTLE_RETRY_MS = 50;

/** Start a runner for the bot's seat (computer.md 3.1). */
export function createBotRunner(opts: RunnerOptions): BotRunner {
  const { port } = opts;
  const me = port.seat;
  const profile: BotProfile = BOT_PROFILES[opts.config.level];
  let pace: BotPace = opts.config.pace;
  let clock = opts.clock;
  let paused = false;
  let disposed = false;
  let busy = false;
  let timer: { handle: unknown; token: object } | null = null;
  let throws = 0;
  let executed = 0;
  let last: BotStep | null = null;
  let current: BotStatus = { phase: 'waiting', text: 'Sparring is waiting.' };
  let n = 0;
  const listeners = new Set<(s: BotStatus) => void>();
  // Watchdog: per turn, how often each step signature was decided, and the kinds skipped this turn.
  let turnKey = -1;
  const repeats = new Map<string, number>();
  const skip = new Set<BotStepKind>();
  const self = {};

  const setStatus = (s: BotStatus): void => {
    if (s.phase === current.phase && s.text === current.text) return;
    current = s;
    for (const l of [...listeners]) l(s);
  };

  const view = (): BotView => buildView({ state: port.getState(), secrets: port.secrets(), cardData: (r) => port.cardData(r), log: port.log(), me });

  const newId = (prefix: string, state: TableState): string => {
    for (;;) {
      const id = `${me}.${prefix}${state.seq}.${++n}`;
      if (!Object.hasOwn(state.cards, id) && !Object.hasOwn(state.lines, id) && !state.stack.some((s) => s.id === id) && state.confirm?.id !== id) return id;
    }
  };

  const clearTimer = (): void => {
    if (!timer) return;
    clock.clearTimeout(timer.handle);
    untrack('timers', timer.token);
    timer = null;
  };

  const ctxFor = (v: BotView): DecideContext => {
    if (v.turn.number !== turnKey) {
      turnKey = v.turn.number;
      repeats.clear();
      skip.clear();
    }
    return { ...opts.ctx, skip };
  };

  const choose = (): { step: BotStep | null; view: BotView } => {
    const v = view();
    const step = decide(v, profile, opts.config.seed, ctxFor(v));
    return { step, view: v };
  };

  const isAnswer = (s: BotStep): boolean => s.kind === 'answer' || s.kind === 'block' || s.kind === 'book';

  /** Look at the table and schedule the next step after the pace delay. */
  const poke = (): void => {
    if (disposed || paused || busy || timer) return;
    if (port.settled && !port.settled()) {
      later(SETTLE_RETRY_MS);
      return;
    }
    let next: BotStep | null;
    try {
      next = choose().step;
    } catch (e) {
      opts.onError?.(e);
      next = null;
    }
    if (!next) {
      setStatus(port.getState().result !== undefined ? { phase: 'conceded', text: 'The game is over.' } : { phase: 'waiting', text: 'Sparring is waiting.' });
      return;
    }
    setStatus({ phase: 'thinking', text: 'Sparring is thinking.' });
    later(isAnswer(next) ? BOT_PACE_MS[pace].answer : BOT_PACE_MS[pace].step, true);
  };

  /** Schedule `run` (or, while the log catches up, another look) after `ms`. */
  const later = (ms: number, step = false): void => {
    const token = {};
    track('timers', token);
    const handle = clock.setTimeout(() => {
      if (!timer || timer.token !== token) return;
      untrack('timers', token);
      timer = null;
      if (step) void run();
      else poke();
    }, ms);
    timer = { handle, token };
  };

  /** Decide again on the current table and execute the step. */
  const run = async (): Promise<BotStep | null> => {
    if (disposed || busy) return null;
    busy = true;
    let step: BotStep | null = null;
    try {
      if (port.settled && !port.settled()) return null;
      const { step: s, view: v } = choose();
      step = s;
      if (step) {
        const sig = JSON.stringify(step);
        const seen = (repeats.get(sig) ?? 0) + 1;
        repeats.set(sig, seen);
        if (seen >= REPEATS && step.kind !== 'passTurn' && step.kind !== 'concede') skip.add(step.kind);
        await execute(step, v);
        last = step;
        executed++;
        throws = 0;
      }
    } catch (e) {
      opts.onError?.(e);
      throws++;
      if (throws >= THROWS) {
        paused = true;
        setStatus({ phase: 'failed', text: 'Sparring stopped.' });
      }
    } finally {
      busy = false;
    }
    if (!disposed && step?.kind === 'concede') setStatus({ phase: 'conceded', text: 'Sparring conceded.' });
    poke();
    return step;
  };

  const group = (state: TableState): string => newId('g', state);

  const execute = async (step: BotStep, v: BotView): Promise<void> => {
    const st = port.getState();
    const d = (a: ActionDraft): void => void port.dispatch(a);
    switch (step.kind) {
      case 'keep':
        return;
      case 'mulligan':
        port.chat('I mulligan.');
        await port.mulligan();
        return;
      case 'bottom': {
        const g = group(st);
        for (const card of step.cards) d({ type: 'toZone', card, to: `library:${me}`, position: 'bottom', group: g });
        return;
      }
      case 'untap': {
        const g = group(st);
        for (const card of step.cards) d({ type: 'tap', card, tapped: false, group: g });
        return;
      }
      case 'phase':
        d({ type: 'phaseSet', phase: step.phase });
        return;
      case 'draw':
        await port.draw(1);
        return;
      case 'playLand':
        d({ type: 'move', card: step.card, to: `battlefield:${me}`, pose: step.pose });
        return;
      case 'cast': {
        const g = group(st);
        for (const card of step.pay) d({ type: 'tap', card, tapped: true, group: g });
        const now = port.getState();
        d({ type: 'stackPush', item: newId('si', now), kind: 'spell', card: step.card, controller: me, round: newId('r', now) });
        return;
      }
      case 'resolve':
        d({ type: 'stackResolve', item: step.item, to: `battlefield:${me}`, pose: step.pose });
        return;
      case 'attack': {
        const g = group(st);
        for (const a of step.attackers) d({ type: 'moveTemp', card: a.card, pose: a.pose, combat: 'attack', tap: a.tap, group: g });
        port.chat(step.line);
        return;
      }
      case 'block': {
        const g = group(st);
        for (const p of step.pairs) {
          d({ type: 'moveTemp', card: p.blocker, pose: p.pose, combat: 'block', group: g });
          d({ type: 'lineAdd', line: newId('ln', port.getState()), kind: 'block', from: { kind: 'card', id: p.blocker }, to: { kind: 'card', id: p.attacker }, group: g });
        }
        port.chat(step.line);
        d({ type: 'respond', round: step.round, seat: me, response: 'ok' });
        return;
      }
      case 'book': {
        const g = group(st);
        for (const l of step.life) d({ type: 'life', seat: l.seat, delta: l.delta, group: g });
        if (step.settle.length > 0) d({ type: 'settle', cards: step.settle, group: g });
        for (const card of step.bury) d({ type: 'toZone', card, to: `graveyard:${me}`, position: 'top', group: g });
        for (const card of step.pings) d({ type: 'ping', target: { kind: 'card', id: card } });
        port.chat(step.line);
        d({ type: 'respond', round: step.round, seat: me, response: 'ok' });
        return;
      }
      case 'answer':
        d({ type: 'respond', round: step.round, seat: me, response: 'ok' });
        return;
      case 'settle':
        d({ type: 'settle', cards: step.cards });
        return;
      case 'discard': {
        const g = group(st);
        for (const card of step.cards) d({ type: 'toZone', card, to: `graveyard:${me}`, position: 'top', group: g });
        return;
      }
      case 'passTurn': {
        const g = group(st);
        if (v.thisTurn.steps >= 80) port.chat("I'll pass.");
        d({ type: 'turnPass', to: v.opp, group: g });
        d({ type: 'phaseSet', phase: 'untap', group: g });
        return;
      }
      case 'concede':
        port.chat(v.life.me <= 0 ? 'Good game.' : 'I concede. Good game.');
        d({ type: 'concede' });
        return;
      case 'say':
        port.chat(step.line);
        return;
    }
  };

  const unsub = port.subscribe(() => poke());
  track('botRunners', self);
  poke();

  return {
    status: () => current,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    pause() {
      if (disposed) return;
      paused = true;
      clearTimer();
      setStatus({ phase: 'paused', text: 'Sparring is paused.' });
    },
    resume() {
      if (disposed) return;
      paused = false;
      throws = 0;
      setStatus({ phase: 'waiting', text: 'Sparring is waiting.' });
      poke();
    },
    setPace(p) {
      pace = p;
    },
    setClock(c) {
      const had = timer !== null;
      clearTimer();
      clock = c;
      if (had) poke();
    },
    async stepNow() {
      clearTimer();
      return run();
    },
    view,
    lastStep: () => last,
    steps: () => executed,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      unsub();
      listeners.clear();
      untrack('botRunners', self);
    },
  };
}

/** A manual clock (the debug hook and e2e specs): timers run only when `tick` advances past them. */
export class ManualClock implements BotClock {
  private now = 0;
  private seq = 0;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.due.delete(handle as number);
  }
  /** Advance by `ms`, running every timer that falls due, in order. */
  tick(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.due) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      this.due.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
    }
    this.now = end;
  }
  pending(): number {
    return this.due.size;
  }
}
