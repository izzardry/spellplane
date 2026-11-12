/**
 * Every deadline the sequencer's clock enforces for a state (DESIGN "Specification: network protocol and secrecy",
 * Timers, Public randomness 2, Secret shuffle 2). Pure: the net engine calls it after each sequenced action and arms
 * timers only while it is the sequencer (net/types.ts NetEngineOptions.deadlines). Contracts: M1-C; the parts are
 * M1-P3 (confirmation rounds) and M1-P2 (commit windows).
 */
import { commitWindowDeadlines } from './rng';
import { confirmDeadlines } from './reducer/confirm';
import type { Deadline, TableState } from './types';

/** The confirmation-round timer and the open commit windows of `state` (core/types.ts Deadline). */
export function deadlines(state: TableState): Deadline[] {
  return [...confirmDeadlines(state), ...commitWindowDeadlines(state)];
}
