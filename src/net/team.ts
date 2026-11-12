/**
 * The Two-Headed Giant team pair channel: the live teammate hand (`teamHand`) and team text chat (`teamChat`) on `prv`
 * to the teammate only (DESIGN "Players, seats and formats", Two-Headed Giant; "Specification: network protocol and
 * secrecy", prv). Contracts: M3-C (stub); implementer: M3-P2. Adds its scenario to the shared leak test.
 */
import type { CreateTeamChannel } from './types';

/** Create the team channel (net/types.ts TeamChannel). Implementer: M3-P2. */
export const createTeamChannel: CreateTeamChannel = () => {
  throw new Error('not implemented: M3-P2');
};
