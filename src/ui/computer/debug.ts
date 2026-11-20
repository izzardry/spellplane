/**
 * The debug hook's `bot` part (computer.md section 12; contracts.md Part C "Debug hook"): what the computer game on
 * this page is doing, Sparring's own view (so tests can assert what it saw), and a manual clock so specs drive
 * Sparring's pace instead of sleeping through it. The route sets the active game; `debug/bot.ts` (the app) and the
 * `?harness=computer` page register the part. Dev and test builds only (registerDebug is a no-op in production).
 */
import type { BotRunner } from '../../bot/runner';
import { ManualClock } from '../../bot/runner';
import type { BotClock, BotConfig, BotPace, BotStatus, BotStep, BotView } from '../../bot/types';

/** The `bot` part of window.__spellplane (a superset of debug/types.ts BotDebug). */
export interface BotDebugPart {
  /** What Sparring is doing; null without a computer game on this page. */
  status(): BotStatus | null;
  /** Whether a computer game is open on this page. */
  active(): boolean;
  config(): BotConfig | null;
  /** Sparring's own view (computer.md 4.1). */
  view(): BotView | null;
  lastStep(): BotStep | null;
  /** Steps executed since the game opened. */
  steps(): number;
  /** Decide and execute one step now; resolves to its kind (null: nothing to do). */
  step(): Promise<string | null>;
  /** Alias of `step` (computer.md section 12). */
  stepNow(): Promise<string | null>;
  /** 'manual': Sparring waits for `tick`; 'page': the page's timers (the default). */
  setClock(kind: 'manual' | 'page'): void;
  /** Advance the manual clock by `ms`, running Sparring's steps that fall due. */
  tick(ms: number): void;
  pause(): void;
  resume(): void;
  setPace(p: BotPace): void;
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

/** The clock a new runner should start with: the manual one once a spec chose it, else null (the page's timers). */
export function botDebugClock(): BotClock | null {
  return manual;
}

/** The part itself. */
export function botDebugPart(): BotDebugPart {
  const step = async (): Promise<string | null> => (await active?.runner.stepNow())?.kind ?? null;
  return {
    status: () => active?.runner.status() ?? null,
    active: () => active !== null,
    config: () => active?.config ?? null,
    view: () => active?.runner.view() ?? null,
    lastStep: () => active?.runner.lastStep() ?? null,
    steps: () => active?.runner.steps() ?? 0,
    step,
    stepNow: step,
    setClock(kind) {
      manual = kind === 'manual' ? (manual ?? new ManualClock()) : null;
      active?.runner.setClock(manual ?? pageClock);
    },
    tick(ms) {
      manual?.tick(ms);
    },
    pause: () => active?.runner.pause(),
    resume: () => active?.runner.resume(),
    setPace: (p) => active?.runner.setPace(p),
  };
}
