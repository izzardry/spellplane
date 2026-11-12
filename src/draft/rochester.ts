/**
 * Client side of the Rochester draft (DESIGN "Specification: card data, packs and draft formats", Rochester: public pack, snake order, rotating opener, burn count).
 * Contracts: M2-C (stub); implementer: M2-P3.
 */
import type { CreateDraftDriver } from './types';

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P3. */
export const createRochesterDriver: CreateDraftDriver = () => {
  throw new Error('not implemented: M2-P3');
};
