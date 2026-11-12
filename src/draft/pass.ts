/**
 * Client side of the pass draft and the Pick-Two preset (DESIGN "Specification: card data, packs and draft formats", Pass draft; "Specification: network protocol and secrecy", Draft packs: secret pack generation, commitments, pick, private hand-over, alternating direction, pick timer, queue counts).
 * Contracts: M2-C (stub); implementer: M2-P2.
 */
import type { CreateDraftDriver } from './types';

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P2. */
export const createPassDriver: CreateDraftDriver = () => {
  throw new Error('not implemented: M2-P2');
};
