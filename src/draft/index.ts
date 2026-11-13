// draft: the client side of the draft formats (DESIGN "Pre-game: draft, sealed and deck building"; PLAN M2-P2, M2-P3).
import type { DraftFormat } from '../core/types';
import { createGridDriver } from './grid';
import { createPassDriver } from './pass';
import { createRochesterDriver } from './rochester';
import { createSealedDriver } from './sealed';
import { createTeamDraftDriver, createTeamSealedDriver } from './team';
import type { CreateDraftDriver } from './types';
import { createWinstonDriver } from './winston';

export * from './types';
export { createGridDriver, createPassDriver, createRochesterDriver, createSealedDriver, createTeamDraftDriver, createTeamSealedDriver, createWinstonDriver };

/** The driver factory per format (DESIGN "Specification: card data, packs and draft formats", Draft formats); the Two-Headed Giant formats are M3-P2's (draft/team.ts). Added by M2-C. */
export const DRAFT_DRIVERS: Readonly<Record<DraftFormat, CreateDraftDriver>> = {
  pass: createPassDriver,
  sealed: createSealedDriver,
  rochester: createRochesterDriver,
  winston: createWinstonDriver,
  grid: createGridDriver,
  teamDraft: createTeamDraftDriver,
  teamSealed: createTeamSealedDriver,
};
