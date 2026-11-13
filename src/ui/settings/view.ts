/**
 * The viewer's view settings: the quality level and the two follow toggles (DESIGN "Themes and rendering", Renderer: "a
 * per-theme quality setting drops shadows and post-processing first"; "Camera and navigation", Follow options: "two
 * personal toggles ... both off by default"; "Local persistence": quality and follow toggles are per-browser settings).
 *
 * One stored quality choice (`Settings.quality`) serves every theme: each theme resolves it to its own level
 * (themes/types.ts `qualityLevel`), so what the choice drops is per theme. The choice lives in this browser's settings
 * and is handed to the table scene, which keeps it across theme hot-swaps (scene/theme-runtime.ts).
 */
import type { FollowOptions } from '../../scene/types';
import type { Settings, SettingsStore } from '../../store/types';
import type { QualityId } from '../../themes/types';

/** The view settings the HUD shows and hands to the scene. */
export interface ViewPrefs extends Pick<Settings, 'followStack' | 'followActive'> {
  quality: QualityId;
}

/** Defaults (DESIGN "Decision log": follow toggles off; the scene's own default quality is 'high'). */
export const DEFAULT_VIEW: Readonly<ViewPrefs> = { quality: 'high', followStack: false, followActive: false };

/** The quality select's options, best first. */
export const QUALITY_OPTIONS: readonly { id: QualityId; label: string }[] = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

export function qualityIdOf(v: unknown): QualityId {
  return v === 'medium' || v === 'low' ? v : 'high';
}

/** The view settings in a stored settings record; anything unexpected reads as the default. */
export function viewPrefsOf(s: Partial<Pick<Settings, keyof ViewPrefs>>): ViewPrefs {
  return { quality: qualityIdOf(s.quality), followStack: s.followStack === true, followActive: s.followActive === true };
}

/** What the view settings act on: the table scene (scene/types.ts TableScene). */
export interface ViewTarget {
  setQuality(id: QualityId): void;
  camera: { setFollow(next: Partial<FollowOptions>): void };
}

/**
 * The viewer's view settings: read from the store, changed by the picker, handed to the scene. The scene is told only
 * what differs from what it has (it starts at 'high' with both follow toggles off); both follow values go over
 * together, so turning one off reaches the scene too.
 */
export class ViewSettings {
  private prefs: ViewPrefs = { ...DEFAULT_VIEW };
  private target: ViewTarget | null = null;
  /** What the target has: its defaults until something is handed over. */
  private handed: ViewPrefs = { ...DEFAULT_VIEW };
  private readonly listeners = new Set<(prefs: ViewPrefs) => void>();
  /** Bumped by every change on this page; a read that started before it does not override it. */
  private edits = 0;
  private disposed = false;

  constructor(private readonly store: SettingsStore | null | undefined) {}

  state(): ViewPrefs {
    return { ...this.prefs };
  }

  subscribe(fn: (prefs: ViewPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The scene to hand the settings to (null when it is gone); it gets what differs from its defaults at once. */
  attach(target: ViewTarget | null): void {
    this.target = target;
    this.handed = { ...DEFAULT_VIEW };
    this.apply();
  }

  /**
   * Read the stored settings (on mount, and when the window regains focus or becomes visible: another tab may have
   * changed them; SettingsStore has no change events). A change made on this page after the read started wins.
   */
  async refresh(): Promise<void> {
    if (!this.store) return;
    const at = this.edits;
    let stored: Settings;
    try {
      stored = await this.store.all();
    } catch {
      return;
    }
    if (this.disposed || at !== this.edits) return;
    this.update(viewPrefsOf(stored));
  }

  /** The viewer changed one setting: shown and handed to the scene at once, then kept in the store. */
  async set<K extends keyof ViewPrefs>(name: K, value: ViewPrefs[K]): Promise<void> {
    this.edits++;
    this.update({ ...this.prefs, [name]: value });
    // ViewPrefs is a slice of Settings with the same value types.
    await this.store?.set<keyof ViewPrefs>(name, value as Settings[keyof ViewPrefs]);
  }

  dispose(): void {
    this.disposed = true;
    this.target = null;
    this.listeners.clear();
  }

  private update(next: ViewPrefs): void {
    const changed = next.quality !== this.prefs.quality || next.followStack !== this.prefs.followStack || next.followActive !== this.prefs.followActive;
    this.prefs = next;
    this.apply();
    if (changed) for (const fn of this.listeners) fn(this.state());
  }

  private apply(): void {
    const t = this.target;
    if (!t) return;
    const p = this.prefs;
    if (p.quality !== this.handed.quality) {
      this.handed = { ...this.handed, quality: p.quality };
      t.setQuality(p.quality);
    }
    if (p.followStack !== this.handed.followStack || p.followActive !== this.handed.followActive) {
      this.handed = { ...this.handed, followStack: p.followStack, followActive: p.followActive };
      t.camera.setFollow({ stack: p.followStack, activePlayer: p.followActive });
    }
  }
}
