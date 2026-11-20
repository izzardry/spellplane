/**
 * The debug hook's `bot` part (computer.md section 12; contracts.md Part C): what the computer game on this page is
 * doing, the bot's own view (so tests can assert what it saw), and a manual clock so specs drive Sparring's pace
 * instead of sleeping through it. The route (ui/computer) sets the active game; `registerBotDebug` (called by
 * debug/index.ts) installs the part. Dev and test builds only.
 */
import type { BotRunner } from '../bot/runner';
import { ManualClock } from '../bot/runner';
import type { BotClock, BotConfig, BotStatus, BotStep, BotView } from '../bot/types';
import { registerDebug } from '../util/debug';

/** The `bot` part of window.__spellplane. */
export interface BotDebug {
  /** Whether a computer game is open on this page. */
  active(): boolean;
  config(): BotConfig | null;
  status(): BotStatus | null;
  /** Sparring's own view (computer.md 4.1). */
  view(): BotView | null;
  lastStep(): BotStep | null;
  /** Steps executed since the game opened. */
  steps(): number;
  /** Decide and execute one step now; resolves to its kind (null: nothing to do). */
  step(): Promise<string | null>;
  /** 'manual': Sparring waits for `tick`; 'page': the page's timers (the default). */
  setClock(kind: 'manual' | 'page'): void;
  /** Advance the manual clock. */
  tick(ms: number): void;
  pause(): void;
  resume(): void;
}

declare module '../util/debug' {
  interface DebugParts {
    bot: BotDebug;
  }
}

interface Active {
  runner: BotRunner;
  config: BotConfig;
}

let active: Active | null = null;
let manual: ManualClock | null = null;
const pageClock: BotClock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The route reports the open computer game (null when it closes). A manual clock chosen before carries over. */
export function setActiveComputer(a: Active | null): void {
  active = a;
  if (a && manual) a.runner.setClock(manual);
}

/** The clock a new runner should start with (the manual one once a spec chose it). */
export function botDebugClock(): BotClock | null {
  return manual;
}

/** Install the `bot` part (debug/index.ts calls it). */
export function registerBotDebug(): void {
  const part: BotDebug = {
    active: () => active !== null,
    config: () => active?.config ?? null,
    status: () => active?.runner.status() ?? null,
    view: () => active?.runner.view() ?? null,
    lastStep: () => active?.runner.lastStep() ?? null,
    steps: () => active?.runner.steps() ?? 0,
    async step() {
      const s = await active?.runner.stepNow();
      return s?.kind ?? null;
    },
    setClock(kind) {
      manual = kind === 'manual' ? (manual ?? new ManualClock()) : null;
      active?.runner.setClock(manual ?? pageClock);
    },
    tick(ms) {
      manual?.tick(ms);
    },
    pause: () => active?.runner.pause(),
    resume: () => active?.runner.resume(),
  };
  registerDebug({ bot: part });
}
