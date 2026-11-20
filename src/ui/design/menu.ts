/** Menu items and groups of the design system's menu popover (ui/design/MenuPopover.svelte). */
import type { IconName } from './icons';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName | undefined;
  /** Shortcut text, muted on the right. */
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
  id: string;
  label: string;
  items: MenuItem[];
}

