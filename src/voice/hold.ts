/**
 * The Ctrl talk key's hold-alone rule (PLAN Milestone 5, owner decisions, Talk key: "The mic and dictation open only
 * after Ctrl has been held alone for about 200 ms. A key or click during that time makes it a shortcut"). Contract:
 * voice/types.ts HoldAloneGate, TALK_HOLD_ALONE_MS. Contracts: M5-C. Implementer: M5-P7.
 */
import type { HoldAloneGate } from './types';

/** Create the hold-alone gate (pure; time is injected). Implementer: M5-P7. Added by M5-C. */
export function createHoldAloneGate(_holdMs?: number): HoldAloneGate {
  throw new Error('not implemented: M5-P7');
}
