/**
 * Applying a new version only between games (PLAN Milestone 5, owner decisions, Updates only between games: "The
 * service worker installs a new version in the background, and the HUD shows 'New version available: it applies after
 * this game'. The update is applied at the lobby, never mid-game"). Contracts: M5-C. Implementer: M5-P3.
 */
import type { Stage } from '../core/types';
import type { UpdateStatus } from '../util/pwa';
import type { Route } from './routes';

export type { UpdateStatus };

/** Where the page is when it considers applying an update (PLAN Milestone 5, owner decisions). Added by M5-C. */
export interface UpdatePlace {
  route: Route['name'];
  /** The open table's stage; null when no table is open (start page, diagnostics). */
  stage: Stage | null;
}

/**
 * The page's side of service-worker updates (PLAN Milestone 5, owner decisions). Built by main.ts in production builds
 * (dev and test builds run no worker; tests inject a fake). Added by M5-C.
 */
export interface AppUpdate {
  status(): UpdateStatus;
  subscribe(listener: (status: UpdateStatus) => void): () => void;
  /** Apply a waiting update now if `updateMayApply(place)`: tell the worker to skip waiting and reload. False when it may not or none waits. */
  applyAt(place: UpdatePlace): boolean;
}

/**
 * Whether an update may be applied here (PLAN Milestone 5, owner decisions: "applied at the lobby, never mid-game"):
 * true on pages without a table and at a table in the 'lobby' stage, false in 'draft', 'build' and 'match'.
 * Implementer: M5-P3. Added by M5-C.
 */
export function updateMayApply(_place: UpdatePlace): boolean {
  throw new Error('not implemented: M5-P3');
}
