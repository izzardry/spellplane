/**
 * Touch devices (DESIGN "Input and interaction design": "tablets with touch are fully supported"; PLAN Milestone 5,
 * owner decisions: iPad with Safari, no text-selection callout, magnifier, double-tap zoom or pull-to-refresh, safe-area
 * insets respected). Which surfaces the HUD adds for fingers, and the page behaviour Safari needs turned off at the table.
 */
import type { EdgeInsets } from './radial';

/**
 * Whether the device has a touch screen (any coarse pointer, or touch points: iPadOS Safari presents itself as a Mac but
 * reports touch points). The thumb action bar and the scrolling hand fan show on such devices, and on any device once a
 * finger touched the page.
 */
export function touchDevice(win: Pick<Window, 'matchMedia' | 'navigator'> | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return false;
  try {
    if (typeof win.matchMedia === 'function' && win.matchMedia('(any-pointer: coarse)').matches) return true;
  } catch {
    // No media queries: fall back to touch points.
  }
  return (win.navigator?.maxTouchPoints ?? 0) > 0;
}

/**
 * Safari's own page gestures that fight the table (pinch-zooming the page, its `gesturestart` family): turned off while
 * the table is shown. Double-tap zoom and pull-to-refresh are off through CSS (index.html: `touch-action: manipulation`,
 * `overscroll-behavior: none`); the text-selection callout and magnifier through the HUD's `user-select: none` and
 * `-webkit-touch-callout: none`. Returns the undo.
 */
export function blockPageGestures(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = document): () => void {
  const stop = (e: Event) => e.preventDefault();
  const types = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const t of types) target.addEventListener(t, stop, { passive: false } as AddEventListenerOptions);
  return () => {
    for (const t of types) target.removeEventListener(t, stop);
  };
}

/** The device's safe-area insets (the iPad's rounded corners and home indicator), CSS px; zeros where there are none. */
export function safeAreaInsets(): EdgeInsets {
  if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  probe.remove();
  return out;
}
