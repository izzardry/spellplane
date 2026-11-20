/**
 * The viewer's look (PLAN Milestone 7, Owner decisions after the first design round: three looks, Kitchen Table,
 * Graphite and Codex; store/types.ts Settings.look). A look dresses the HUD (ui/design/tokens.ts) and, through
 * LOOK_THEME, picks the table's 3D theme: choosing one stores both, so "the three looks switch the HUD skin with the
 * table". Kept per browser like the theme, never on the wire.
 */
import { getContext, setContext, tick } from 'svelte';
import { lookIdOf, lookOfTheme } from '../../themes/index';
import { DEFAULT_LOOK, LOOK_THEME, type LookId } from '../../themes/types';
import type { SettingsStore } from '../../store/types';
import { registerDebug } from '../../util/debug';
import type { ThemeChoice } from '../settings/theme';

/** The viewer's look: the stored setting, or the look whose table theme is shown. */
export class LookChoice {
  private stored: LookId = DEFAULT_LOOK;
  private readonly listeners = new Set<(look: LookId) => void>();
  private picked = false;
  private offTheme: (() => void) | null = null;

  constructor(
    private readonly themes: ThemeChoice | null,
    private readonly settings: SettingsStore | null | undefined,
  ) {
    this.offTheme = themes?.subscribe(() => this.emit()) ?? null;
    void settings
      ?.get('look')
      .then((v) => {
        if (this.picked) return;
        this.stored = lookIdOf(v);
        this.emit();
      })
      .catch(() => undefined);
  }

  /** The look shown now: the table theme's own look, else the stored one (an M4 theme keeps the stored look's HUD). */
  current(): LookId {
    const theme = this.themes?.id();
    return (theme && lookOfTheme(theme)) || this.stored;
  }

  /** Pick a look: the table theme loads, then the HUD and the table switch together; both are kept in the settings. */
  async set(id: LookId): Promise<void> {
    const look = lookIdOf(id);
    this.picked = true;
    // The table theme first: a chunk that cannot be loaded leaves both the table and the HUD as they were.
    if (this.themes) await this.themes.set(LOOK_THEME[look]);
    this.stored = look;
    this.emit();
    await this.settings?.set('look', look).catch(() => undefined);
  }

  subscribe(listener: (look: LookId) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.offTheme?.();
    this.offTheme = null;
    this.listeners.clear();
  }

  private emit(): void {
    const look = this.current();
    for (const l of [...this.listeners]) l(look);
  }
}

const KEY = Symbol('spellplane.look');

export function setLookContext(choice: LookChoice): void {
  setContext(KEY, choice);
}

/** The viewer's look choice, or null in a harness page with a fixed theme. */
export function lookContext(): LookChoice | null {
  return getContext<LookChoice | undefined>(KEY) ?? null;
}

function frames(n: number): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });
}

/** The `look` part of the debug hook (debug/types.ts LookDebug): `set` resolves once the new theme drew two frames. */
export function registerLookDebug(choice: LookChoice): void {
  registerDebug({
    look: {
      current: () => choice.current(),
      set: async (id: LookId) => {
        await choice.set(id);
        if (choice.current() !== id) throw new Error(`the look switch to ${id} was overtaken by ${choice.current()}`);
        await tick();
        await frames(2);
      },
    },
  });
}
