/**
 * Two-Headed Giant draft and sealed (DESIGN "Pre-game: draft, sealed and deck building": Two-Headed Giant draft, teams
 * pick two cards per pack into a shared team pool, 6 packs per team, "Team sees its own packs and pool"; Two-Headed
 * Giant sealed, 8 packs per team, shared pool; "Specification: card data, packs and draft formats", Draft formats:
 * passing goes team to team, alternating direction per round). The drafter is the team (core/types.ts DrafterId); both
 * teammates' browsers hold the team's packs and pool, shared on the pair channel with `draftCards` (about = pack id).
 * Contracts: M3-C (stubs); implementer: M3-P2, with the reducer cases in core/reducer/pass.ts.
 */
import type { CreateDraftDriver } from './types';

/** The Two-Headed Giant draft driver (draft/types.ts DraftDriver). Implementer: M3-P2. */
export const createTeamDraftDriver: CreateDraftDriver = () => {
  throw new Error('not implemented: M3-P2');
};

/** The Two-Headed Giant sealed driver (draft/types.ts DraftDriver). Implementer: M3-P2. */
export const createTeamSealedDriver: CreateDraftDriver = () => {
  throw new Error('not implemented: M3-P2');
};
