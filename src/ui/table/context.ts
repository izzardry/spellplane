/**
 * The page's table dependencies as a Svelte context (contracts.md Part C): App.svelte sets it once, so a route renders
 * the table frame with the contract's props only (TableFrameProps.deps overrides it, for harness pages). Added by M8-C.
 */
import { getContext, setContext } from 'svelte';
import type { TableDeps } from './types';

const KEY = Symbol('spellplane.tableDeps');

export function setTableDeps(deps: TableDeps): void {
  setContext(KEY, deps);
}

/** The page's table dependencies, or null outside the app (a harness without them). */
export function tableDeps(): TableDeps | null {
  return getContext<TableDeps | undefined>(KEY) ?? null;
}

const GUARD = Symbol('spellplane.leaveGuard');

/**
 * Browser Back leaves like the arrow (journey.md 4.10 "Leaving"; M8-P8): App asks the shown table frame to leave
 * before it switches away from a table route by a hash change the frame did not make. The frame registers its leave
 * here; the registration returns its undo.
 */
export type LeaveGuardHost = (leave: (() => Promise<void>) | null) => void;

export function setLeaveGuardHost(host: LeaveGuardHost): void {
  setContext(GUARD, host);
}

/** The page's leave-guard host, or null outside the app (a harness). */
export function leaveGuardHost(): LeaveGuardHost | null {
  return getContext<LeaveGuardHost | undefined>(GUARD) ?? null;
}
