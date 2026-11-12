/**
 * Client side of the Winston draft (DESIGN "Specification: card data, packs and draft formats", Winston: face-down stack, three piles, private looks).
 * Contracts: M2-C (stub); implementer: M2-P3.
 */
import type { CreateDraftDriver } from './types';

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P3. */
export const createWinstonDriver: CreateDraftDriver = () => {
  throw new Error('not implemented: M2-P3');
};
