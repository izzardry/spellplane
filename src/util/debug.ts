/**
 * window.__spellplane: the test and gate hook (docs/DESIGN.md, "Specification: code interfaces").
 * Present in dev and test builds only (__SPELLPLANE_DEBUG__). Modules register the parts they own;
 * Playwright reads them. The full type, SpellplaneDebug, lives in debug/types.ts and is merged into
 * `DebugParts` below by declaration merging, so util/ needs no import from debug/.
 */

/** Parts of the debug hook; debug/types.ts augments this with every SpellplaneDebug member (DESIGN "Specification: code interfaces"). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DebugParts {}

/** The hook as seen at runtime: any member may be missing until its module registered it (DESIGN "Specification: code interfaces"). */
export type DebugApi = Partial<DebugParts>;

declare global {
  interface Window {
    __spellplane?: DebugApi;
  }
}

/** Merge `part` into window.__spellplane. A no-op in production builds. */
export function registerDebug(part: Partial<DebugParts>): void {
  if (!__SPELLPLANE_DEBUG__ || typeof window === 'undefined') return;
  window.__spellplane = Object.assign(window.__spellplane ?? {}, part);
}
