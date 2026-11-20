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
