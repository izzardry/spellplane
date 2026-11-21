/**
 * The HUD's menu model (PLAN M7-P2; docs/design/m8/m7-adjustments.md, M7-P2 "Menu"): the HUD's own groups carry icons,
 * keys and test ids; the shell's groups (HudShellProps.menuTop, the kit's MenuGroup from ui/design/menu.ts) are read
 * structurally, so either shape of the kit's group (`{ id, label, items }` of the seed or `{ title?, items }` of
 * contracts.md Part B) lands here unchanged.
 */
import type { IconName } from '../design/icons';

export interface HudMenuItem {
  id: string;
  label: string;
  icon?: IconName | undefined;
  /** Shortcut text, muted on the right. */
  key?: string | null | undefined;
  /** A muted line or value on the right (the kit's `hint`). */
  hint?: string | undefined;
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

export interface HudMenuGroup {
  id: string;
  label?: string | undefined;
  items: HudMenuItem[];
}

/** What a shell group may look like: any of the kit's shapes. */
interface ShellGroupShape {
  id?: unknown;
  title?: unknown;
  label?: unknown;
  items?: readonly ShellItemShape[];
}
interface ShellItemShape {
  id?: unknown;
  label?: unknown;
  hint?: unknown;
  danger?: unknown;
  disabled?: unknown;
  run?: unknown;
  testid?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The shell's groups as HUD groups, first in the Menu. Items get the test id `menu-top-<id>` unless they bring one; a
 * group without items is left out.
 */
export function shellGroups(groups: readonly object[] | null | undefined): HudMenuGroup[] {
  if (!groups) return [];
  const out: HudMenuGroup[] = [];
  groups.forEach((raw, gi) => {
    const g = raw as ShellGroupShape;
    const items: HudMenuItem[] = [];
    for (const [ii, it] of (g.items ?? []).entries()) {
      const id = str(it.id) ?? `item${ii}`;
      const run = typeof it.run === 'function' ? (it.run as () => void) : undefined;
      items.push({
        id: `top:${id}`,
        label: str(it.label) ?? id,
        hint: str(it.hint),
        danger: it.danger === true,
        disabled: it.disabled === true,
        testid: str(it.testid) ?? `menu-top-${id}`,
        run: run ? () => run.call(it) : undefined,
      });
    }
    if (items.length) out.push({ id: `top:${str(g.id) ?? gi}`, label: str(g.title) ?? str(g.label), items });
  });
  return out;
}

/**
 * The whole Menu: the shell's groups first, then the HUD's. The evening's proposals ("Next game…", "New draft…", the
 * HUD's `table` group) join the shell's "This game" group when there is one (journey.md 4.10: the actions that end this
 * game live there; gate M8 finding F6), before a destructive item such as Concede (visual.md O-4).
 */
export function menuWithShell(shell: HudMenuGroup[], own: HudMenuGroup[]): HudMenuGroup[] {
  const thisGame = shell.find((g) => g.id === 'top:this-game');
  const table = own.find((g) => g.id === 'table');
  if (!thisGame || !table || table.items.length === 0) return [...shell, ...own];
  const firstDanger = thisGame.items.findIndex((i) => i.danger);
  const at = firstDanger < 0 ? thisGame.items.length : firstDanger;
  const merged: HudMenuGroup = { ...thisGame, items: [...thisGame.items.slice(0, at), ...table.items, ...thisGame.items.slice(at)] };
  return [...shell.map((g) => (g === thisGame ? merged : g)), ...own.filter((g) => g !== table)];
}
