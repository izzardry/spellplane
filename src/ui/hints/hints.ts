/**
 * First-run hints (PLAN M5-P5: "first-run hints (short, dismissible, never blocking)"; DESIGN "Input and interaction
 * design", Discoverable, Nothing modal; PLAN Milestone 5, owner decisions, Talk key: "The cheat sheet, hints and labels
 * say Ctrl").
 *
 * One hint shows at a time, in a corner, never over a control the player needs and never taking focus. Dismissing it
 * stores its id in `Settings.hintsSeen` (store/types.ts HintId), so it shows once per browser profile; the next one, if
 * any, follows. Keys are named from the player's keymap, so a remapped key reads as remapped. This module owns the hints
 * welcome, tableKeys, touchGestures and talkKey; installHomeScreen and persistStorage are M5-P3's and are left alone.
 */
import type { ActionId } from '../../games/types';
import type { HintId, SettingsStore } from '../../store/types';

/** The hints this package shows, in the order a new player meets them. */
export const FIRST_RUN_HINTS = ['welcome', 'tableKeys', 'touchGestures', 'talkKey'] as const satisfies readonly HintId[];
export type FirstRunHint = (typeof FIRST_RUN_HINTS)[number];

/** Where the page is and what it offers. */
export interface HintContext {
  /** The start page or a table. */
  where: 'start' | 'table';
  /** The device has a touch screen (tablet): gestures instead of hover keys. */
  touch: boolean;
  /** The table has live voice (a networked table with a talk key). */
  voice: boolean;
  /** A spectator: no hover keys, no talking. */
  spectator?: boolean;
  /**
   * A table in a room with other players (an evening): the welcome's "import a deck to try it alone" does not fit there
   * (M5 gate), so it waits for the start page or the solo table.
   */
  networked?: boolean;
}

/** The next hint to show, or null: the first not yet seen that fits the page. */
export function nextHint(seen: readonly string[], ctx: HintContext): FirstRunHint | null {
  const fits = (id: FirstRunHint): boolean => {
    switch (id) {
      case 'welcome':
        return !(ctx.where === 'table' && ctx.networked);
      case 'tableKeys':
        return ctx.where === 'table' && !ctx.touch && !ctx.spectator;
      case 'touchGestures':
        return ctx.where === 'table' && ctx.touch && !ctx.spectator;
      case 'talkKey':
        return ctx.where === 'table' && ctx.voice && !ctx.spectator;
    }
  };
  return FIRST_RUN_HINTS.find((id) => !seen.includes(id) && fits(id)) ?? null;
}

/** A hint's title and text, naming the player's keys (`key(action)` gives its label, or null when unbound). */
export function hintText(id: FirstRunHint, key: (action: ActionId) => string | null, touch = false): { title: string; text: string } {
  const k = (a: ActionId, fallback: string): string => key(a) ?? fallback;
  switch (id) {
    case 'welcome':
      return {
        title: 'Welcome to Spellplane',
        text: 'A shared card table for friends, with no rules engine: you play as at a real table. Import a deck to try it alone, or open the lobby to invite friends.',
      };
    case 'tableKeys':
      return {
        title: 'Point and press',
        text: `Point at a card and press a key: ${k('tap', 'T')} taps it, ${k('toGraveyard', 'G')} puts it in the graveyard, ${k('draw', 'D')} draws. ${k('help', '?')} lists every key; Settings changes them.`,
      };
    case 'touchGestures':
      return {
        title: 'Touch',
        text: 'Tap selects, double-tap taps a card, long-press opens its actions, long-press and drag draws a line. Two fingers move the camera.',
      };
    case 'talkKey':
      // A touch screen has no talk key to hold: the thumb bar's Talk button is the route (DESIGN "Input and
      // interaction design", Touch; M5 gate).
      if (touch)
        return {
          title: 'Talk',
          text: 'Touch and hold Talk in the bar at the bottom to talk to the table; let go to stop.',
        };
      return {
        title: 'Talk',
        text: `Hold ${k('talk', 'the talk key')} to talk to the table; a quick ${k('talk', 'press')} with another key stays a shortcut. ${k('mute', 'M')} mutes you.`,
      };
  }
}

/** Hint ids as stored: only strings, each once (unknown ids are kept, so another build's hints stay seen). */
export function hintsSeenOf(v: unknown): HintId[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is HintId => typeof x === 'string'))];
}

/**
 * Which hint shows on this page: reads `Settings.hintsSeen` once, shows nothing until then (no flash for a returning
 * player), and stores a dismissal. Without a settings store a dismissal lasts for the page.
 */
export class HintController {
  private seen: HintId[] = [];
  private ready = false;
  private ctx: HintContext;
  private readonly listeners = new Set<(hint: FirstRunHint | null) => void>();

  constructor(
    private readonly settings: SettingsStore | null | undefined,
    ctx: HintContext,
  ) {
    this.ctx = { ...ctx };
  }

  /** Whether the page is on a touch screen (the hint texts name touch routes then). */
  get touch(): boolean {
    return this.ctx.touch;
  }

  /** The hint to show now, or null. */
  current(): FirstRunHint | null {
    return this.ready ? nextHint(this.seen, this.ctx) : null;
  }

  subscribe(fn: (hint: FirstRunHint | null) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Read what this browser has seen; without a store, start with nothing seen. */
  async load(): Promise<void> {
    let stored: unknown;
    try {
      stored = (await this.settings?.get('hintsSeen')) ?? [];
    } catch {
      stored = [];
    }
    // Anything dismissed while the read ran stays dismissed.
    this.seen = [...new Set([...hintsSeenOf(stored), ...this.seen])];
    this.ready = true;
    this.emit();
  }

  /** The page changed (voice joined, a touch seen). */
  setContext(next: Partial<HintContext>): void {
    const before = this.current();
    this.ctx = { ...this.ctx, ...next };
    if (this.current() !== before) this.emit();
  }

  /** The player dismissed `id`: it never shows again in this profile. */
  async dismiss(id: FirstRunHint): Promise<void> {
    if (!this.seen.includes(id)) this.seen = [...this.seen, id];
    this.emit();
    if (!this.settings) return;
    try {
      // Merge with what is stored: another page (or M5-P3's hints) may have added ids since this one read them.
      const stored = hintsSeenOf(await this.settings.get('hintsSeen'));
      await this.settings.set('hintsSeen', [...new Set([...stored, ...this.seen])]);
    } catch {
      // Not stored: the hint stays dismissed for this page.
    }
  }

  private emit(): void {
    const h = this.current();
    for (const fn of [...this.listeners]) fn(h);
  }
}

/** Whether this device has a touch screen (iPad Safari; Playwright's iPad emulation). */
export function isTouchDevice(): boolean {
  if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0) return true;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
