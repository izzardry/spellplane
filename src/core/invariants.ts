/**
 * State invariants for property tests and debug builds (DESIGN "Table model": every card is in exactly one zone;
 * PLAN M0-P1 acceptance: contiguous pile indices). Implementer: M0-P1.
 */
import type { TableState } from './types';

/** Human-readable violations; empty when the state is consistent (DESIGN "Table model"). Stub (M0-P1). */
export function checkInvariants(_state: TableState): string[] {
  throw new Error('not implemented: M0-P1');
}
