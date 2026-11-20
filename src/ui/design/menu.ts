/**
 * Menu items and groups of the kit's menu popover (ui/design/MenuPopover.svelte; docs/design/m8/contracts.md Part B:
 * `MenuGroup = { title?: string; items: MenuItem[] }`, `MenuItem = { id; label; hint?; danger?; disabled?; run() }`).
 * The seed's fields (a group's `id` and `label`, an item's icon, key, testid, keepOpen, onpointerdown, title) stay
 * optional, so the HUD's menus built on the seed keep working. Revised by M8-P1.
 */
import type { IconName } from './icons';

export interface MenuItem {
  id: string;
  label: string;
  /** A value or key shown muted on the right (contracts.md Part B). */
  hint?: string | undefined;
  icon?: IconName | undefined;
  /** Shortcut text, muted on the right (seed; `hint` wins when both are given). */
  key?: string | null | undefined;
  testid?: string | undefined;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Keep the menu open after the item ran. */
  keepOpen?: boolean | undefined;
  run?: (() => void) | undefined;
  /** A press that starts a drag out of the menu (the paperclip); the menu closes. */
  onpointerdown?: ((e: PointerEvent) => void) | undefined;
  title?: string | undefined;
}
export interface MenuGroup {
  /** The group's eyebrow (contracts.md Part B). */
  title?: string | undefined;
  /** Seed: a stable id (data-group) and the eyebrow when `title` is absent. */
  id?: string | undefined;
  label?: string | undefined;
  items: MenuItem[];
}

/** Where a popover goes for an anchor box (fixed coordinates), clamped to the viewport with an 8 px margin. Added by M8-P1. */
export function popoverPlace(
  anchor: { left: number; top: number; bottom: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: 'above' | 'below' | 'auto' = 'auto',
  gap = 8,
): { left: number; top: number; side: 'above' | 'below' } {
  const below = viewport.height - anchor.bottom - gap;
  const above = anchor.top - gap;
  const side = placement === 'auto' ? (below >= size.height || below >= above ? 'below' : 'above') : placement;
  let top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - size.height;
  top = Math.max(8, Math.min(top, viewport.height - size.height - 8));
  let left = anchor.left;
  left = Math.max(8, Math.min(left, viewport.width - size.width - 8));
  return { left, top, side };
}
