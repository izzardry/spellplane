/**
 * Client side of the sealed pools (DESIGN "Specification: card data, packs and draft formats", Sealed: pools are generated and shown to their owners).
 * Contracts: M2-C (stub); implementer: M2-P2.
 */
import type { CreateDraftDriver } from './types';

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P2. */
export const createSealedDriver: CreateDraftDriver = () => {
  throw new Error('not implemented: M2-P2');
};
