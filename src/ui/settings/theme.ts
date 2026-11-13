/**
 * The viewer's theme (PLAN M4-P6; DESIGN "Themes and rendering": "Themes are chosen per viewer, loaded on demand as
 * separate chunks and switchable mid-game without reloading; two players at the same table can use different themes").
 *
 * The choice lives in this browser's settings (`Settings.theme`, per profile) and never in the table state or on the
 * wire, so another player's theme is invisible to this page. Paper is bundled with the app; every other theme's chunk
 * is imported the first time it is picked (themes/index.ts `loadTheme`). The latest pick wins: a slow chunk that arrives
 * after a newer pick is kept for later but not shown. A chunk that fails to load leaves the current theme in place.
 */
import { getContext, setContext, tick } from 'svelte';
import type { SettingsStore } from '../../store/types';
import { loadTheme, THEME_IDS, THEME_LABELS, themeIdOf, type Theme, type ThemeId } from '../../themes/index';
import { paper } from '../../themes/paper/index';
import { registerDebug } from '../../util/debug';

/** What the picker shows (DESIGN "Themes and rendering", theme table: the character of each theme). */
export const THEME_BLURBS: Readonly<Record<ThemeId, string>> = {
  paper: 'Clean, black on white',
  dusk: 'Moody, a warm lamp on dark felt',
  wyrm: 'Dragon-themed obsidian and embers',
  stonetable: 'Carved stone, rendered in 3D',
};

/** The state a picker or shell renders. */
export interface ThemeChoiceState {
  theme: Theme;
  /** A theme whose chunk is being loaded for the latest pick, or null. */
  loading: ThemeId | null;
  /** Why the latest pick could not be shown, or null. */
  error: string | null;
}

export interface ThemeChoiceOptions {
  /** Where the choice is kept (this browser's settings); without it the choice lasts for the page. */
  settings?: SettingsStore | null | undefined;
  /** Chunk loader; themes/index.ts `loadTheme` by default. */
  load?: (id: ThemeId) => Promise<Theme>;
  /** The theme shown before the stored choice is read; Paper by default. */
  initial?: Theme;
  /** Longest wait for the stored choice before `ready` settles anyway (ms). */
  restoreTimeoutMs?: number;
}

/** The viewer's theme choice: current theme, lazy loading, persistence (PLAN M4-P6). */
export class ThemeChoice {
  private theme: Theme;
  private loading: ThemeId | null = null;
  private error: string | null = null;
  private readonly themes = new Map<ThemeId, Theme>();
  private readonly listeners = new Set<(state: ThemeChoiceState) => void>();
  private readonly settings: SettingsStore | null;
  private readonly load: (id: ThemeId) => Promise<Theme>;
  /** Bumped by every switch; a load that finishes after a newer one started is not shown. */
  private ticket = 0;
  /** The viewer picked a theme on this page; a late read of the stored setting does not override it. */
  private picked = false;
  /** Settles once the stored choice was read and, if it names another theme, that theme is shown (or failed). */
  readonly ready: Promise<void>;

  constructor(opts: ThemeChoiceOptions = {}) {
    this.theme = opts.initial ?? paper;
    this.themes.set(this.theme.id, this.theme);
    this.settings = opts.settings ?? null;
    this.load = opts.load ?? loadTheme;
    const restored = this.restore();
    const limit = opts.restoreTimeoutMs ?? 3000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((r) => (timer = setTimeout(r, limit)));
    this.ready = Promise.race([restored, waited]).finally(() => clearTimeout(timer));
  }

  /** The theme shown now. */
  current(): Theme {
    return this.theme;
  }

  id(): ThemeId {
    return this.theme.id;
  }

  state(): ThemeChoiceState {
    return { theme: this.theme, loading: this.loading, error: this.error };
  }

  /** Themes whose chunk this page has loaded, in the order of THEME_IDS. */
  loaded(): ThemeId[] {
    return THEME_IDS.filter((id) => this.themes.has(id));
  }

  /** Called with the new state after every change; returns the unsubscribe function. */
  subscribe(listener: (state: ThemeChoiceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * The viewer picks a theme: load its chunk if needed, show it and keep the choice in the settings. Resolves with the
   * theme shown afterwards (a newer pick may have overtaken this one); rejects when the chunk cannot be loaded, in which
   * case the theme shown stays as it was.
   */
  async set(id: ThemeId): Promise<Theme> {
    if (!(THEME_IDS as readonly string[]).includes(id)) throw new Error(`unknown theme ${String(id)}`);
    this.picked = true;
    const shown = await this.apply(id);
    if (shown.id === id) await this.settings?.set('theme', id).catch(() => undefined);
    return shown;
  }

  private async restore(): Promise<void> {
    if (!this.settings) return;
    let stored: string;
    try {
      stored = await this.settings.get('theme');
    } catch {
      return;
    }
    const id = themeIdOf(stored);
    if (this.picked || id === this.theme.id) return;
    await this.apply(id).catch(() => undefined);
  }

  private async apply(id: ThemeId): Promise<Theme> {
    const ticket = ++this.ticket;
    const have = this.themes.get(id);
    if (have) {
      this.show(have);
      return have;
    }
    this.loading = id;
    this.error = null;
    this.emit();
    let theme: Theme;
    try {
      theme = await this.load(id);
      if (theme.id !== id) throw new Error(`the ${id} chunk holds the ${theme.id} theme`);
    } catch (e) {
      if (ticket === this.ticket) {
        this.loading = null;
        // A browser keeps a failed dynamic import for that URL, so picking the theme again on this page fails the same
        // way; the text says what helps.
        this.error = `${THEME_LABELS[id]} could not be loaded (${e instanceof Error ? e.message : String(e)}). ${THEME_LABELS[this.theme.id]} stays; reload the page to try again.`;
        this.emit();
      }
      throw e;
    }
    this.themes.set(id, theme);
    if (ticket !== this.ticket) return this.theme;
    this.show(theme);
    return theme;
  }

  private show(theme: Theme): void {
    this.loading = null;
    this.error = null;
    this.theme = theme;
    this.emit();
  }

  private emit(): void {
    const state = this.state();
    for (const l of [...this.listeners]) l(state);
  }
}

const KEY = Symbol('spellplane.theme');

/** Make the viewer's theme choice available to the shells below (App sets it). */
/**
 * Whether a page waits for the stored theme before it renders: the routes that build a table scene do (a viewer who
 * picked Dusk does not first get Paper's scene); the start page and the connection check render at once.
 */
export function waitsForStoredTheme(route: { name: string }): boolean {
  return route.name === 'solo' || route.name === 'room';
}

export function setThemeContext(choice: ThemeChoice): void {
  setContext(KEY, choice);
}

/** The viewer's theme choice, or null in a harness page that mounts a shell with a fixed theme. */
export function themeContext(): ThemeChoice | null {
  return getContext<ThemeChoice | undefined>(KEY) ?? null;
}

/** Wait until the browser drew `n` more frames. */
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

/**
 * The `theme` part of the debug hook (debug/types.ts ThemeDebug, M4-C): `set` resolves once the components took the
 * new theme (Svelte's tick: the HUD calls the scene's `setTheme`) and the browser drew two more frames.
 */
export function registerThemeDebug(choice: ThemeChoice): void {
  registerDebug({
    theme: {
      current: () => choice.id(),
      set: async (id: ThemeId) => {
        const shown = await choice.set(id);
        if (shown.id !== id) throw new Error(`the theme switch to ${id} was overtaken by ${shown.id}`);
        await tick();
        await frames(2);
      },
      loaded: () => choice.loaded(),
    },
  });
}
