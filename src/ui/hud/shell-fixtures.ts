/**
 * Fixture snippets for the HUD's shell slots on the ui harness (`?harness=ui`, `setShell(partial)`; docs/design/m8/
 * m7-adjustments.md, chunk P2-3: "a text node with a test id per slot"). Test pages only.
 */
import { createRawSnippet } from 'svelte';
import type { SeatId } from '../../core/types';

/** `plateBadge`: a badge with the seat id. */
export const fixturePlateBadge = createRawSnippet((seat: () => SeatId) => ({
  render: () => `<span class="ds-badge" data-testid="fixture-plate-badge" data-seat="${seat()}">RE-INVITE</span>`,
}));

/** `plateMenuTop`: a line naming the seat and a button that calls the close callback. */
export const fixturePlateMenuTop = createRawSnippet((seat: () => SeatId, close: () => () => void) => ({
  render: () => `<div data-testid="fixture-plate-menu-top" data-seat="${seat()}"><span>Away for 3 min</span><button type="button" class="ds-btn sp-h-sm" data-testid="fixture-plate-menu-close">Bring back</button></div>`,
  setup: (el: Element) => {
    const button = el.querySelector('button');
    const run = (): void => close()();
    button?.addEventListener('click', run);
    return () => button?.removeEventListener('click', run);
  },
}));

/** `status`: one line of text. */
export const fixtureStatus = createRawSnippet(() => ({
  render: () => `<span class="ds-chip" data-testid="fixture-status">Waiting for Ben</span>`,
}));

/** `status` that renders nothing (it must take no space). */
export const fixtureEmptyStatus = createRawSnippet(() => ({ render: () => `<span hidden data-testid="fixture-status-empty"></span>` }));
