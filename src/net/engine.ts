/**
 * The network engine (DESIGN "Multiplayer architecture"; "Specification: network protocol and secrecy": Handshake,
 * Sequencing, Liveness, Sync, Timers). Contracts: M1-C (net/types.ts NetEngine). Implementer: M1-P1.
 */
import type { CreateNetEngine } from './types';

/** Create a NetEngine over a transport (net/types.ts). Implementer: M1-P1 (the stub throws). */
export const createNetEngine: CreateNetEngine = () => {
  throw new Error('not implemented: M1-P1');
};
