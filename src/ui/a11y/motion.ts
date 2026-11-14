/**
 * Reduced motion (DESIGN "Input and interaction design", Accessibility: "Reduced-motion is honoured"; "Camera and
 * navigation": camera motion cuts instead of animating; "Specification: geometry, layout and motion": "With reduced
 * motion, all of these are cuts"; PLAN M5-P4: every animation cuts or fades under prefers-reduced-motion).
 *
 * The scene, the builder and the draft surfaces cut their own motion from `ViewState.reducedMotion`; HUD components
 * that animate carry their own `prefers-reduced-motion` rules. The page-wide rule below is the safety net of the audit:
 * under the setting, every CSS animation and transition on the page runs for 1 ms once (a cut), whichever component it
 * comes from. 1 ms rather than 0 keeps animationend and transitionend events firing for code that waits on them.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The CSS of the page-wide cut (M5-P4). Delays stay: a delayed appearance is not motion. */
export const REDUCED_MOTION_CSS = `@media ${REDUCED_MOTION_QUERY} {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}`;

const STYLE_ID = 'sp-reduced-motion';

/** Add the page-wide reduced-motion rule once (idempotent). */
export function installReducedMotionCss(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = REDUCED_MOTION_CSS;
  doc.head.appendChild(style);
}

/** Whether the viewer asked for reduced motion now. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Follow the setting: `onChange` runs whenever the viewer changes it (the table stays open). Returns the unsubscribe. */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const q = matchMedia(REDUCED_MOTION_QUERY);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  q.addEventListener('change', handler);
  return () => q.removeEventListener('change', handler);
}
