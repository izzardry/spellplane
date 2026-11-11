/**
 * window.__spellplane: the test and gate hook (docs/DESIGN.md, "Specification: code interfaces").
 * Present in dev and test builds only (__SPELLPLANE_DEBUG__). Modules register the parts they own;
 * Playwright reads them. The full SpellplaneDebug type is fixed by the M0 contracts package.
 */
export type DebugApi = Record<string, unknown>;

declare global {
  interface Window {
    __spellplane?: DebugApi;
  }
}

/** Merge `part` into window.__spellplane. A no-op in production builds. */
export function registerDebug(part: DebugApi): void {
  if (!__SPELLPLANE_DEBUG__ || typeof window === 'undefined') return;
  window.__spellplane = Object.assign(window.__spellplane ?? {}, part);
}
