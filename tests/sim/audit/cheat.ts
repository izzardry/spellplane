/**
 * A cheating client for the audit simulations (PLAN M5-P2 acceptance: "the audit detects a tampered library order in a
 * simulated game"): test files mock core/secrets.ts with `secretsWithCheats`, so the networked session of the seat
 * named in `cheat.seat` runs a modified shuffle or private reorder, exactly as a browser with patched code would. The
 * honest protocol runs first; the cheat then rewrites what that browser keeps and proposes.
 */
import type * as Secrets from '../../../src/core/secrets';

type FinishShuffle = typeof Secrets.finishShuffle;
type PrivateReorder = typeof Secrets.privateReorder;

export interface Cheat {
  /** The cheating seat; null: everybody is honest. */
  seat: string | null;
  /** Rewrites the honest result of finishing an own shuffle. */
  finish: ((honest: ReturnType<FinishShuffle>, args: Parameters<FinishShuffle>) => ReturnType<FinishShuffle>) | null;
  /** Rewrites the honest result of an own private reorder. */
  reorder: ((honest: ReturnType<PrivateReorder>, args: Parameters<PrivateReorder>) => ReturnType<PrivateReorder>) | null;
}

export const cheat: Cheat = { seat: null, finish: null, reorder: null };

export function honest(): void {
  cheat.seat = null;
  cheat.finish = null;
  cheat.reorder = null;
}

/** The vi.mock factory body for src/core/secrets.ts. */
export function secretsWithCheats(real: typeof Secrets): typeof Secrets {
  return {
    ...real,
    finishShuffle: (...args: Parameters<FinishShuffle>) => {
      const r = real.finishShuffle(...args);
      return cheat.finish && args[0].seat === cheat.seat ? cheat.finish(r, args) : r;
    },
    privateReorder: (...args: Parameters<PrivateReorder>) => {
      const r = real.privateReorder(...args);
      return cheat.reorder && args[0].seat === cheat.seat ? cheat.reorder(r, args) : r;
    },
  };
}
