/**
 * Key remapping (DESIGN "Input and interaction design", Discoverable: "all keys are remappable"; "no chord twice within
 * one context"; PLAN M5-P5: key remapping UI with every action, conflict detection and reset; PLAN Milestone 5, owner
 * decisions, Talk key: Ctrl, either key, "the key stays remappable in M5-P5's key-remapping UI").
 *
 * Pure apart from the settings store: the HUD, the settings panel and the cheat sheet all read the keymap from one
 * `KeymapSettings`, so a remap made in one shows in the others at once.
 *
 * Rules:
 * - an override replaces every default binding of its action in its context (ui/keymap.ts applyOverrides);
 * - a chord another action of the same context holds is a conflict: refused and reported with that action's name; the
 *   player may then swap the two keys;
 * - keys the HUD reserves outside the keymap (ui/keymap.ts RESERVED_KEYS, the untap offer) and the arrow and page keys
 *   (keyboard focus, ui/a11y; DECISIONS [M5-C]) are refused;
 * - a bare modifier (Ctrl, Shift or Alt alone, games/types.ts isModifierChord) is accepted only for the talk key, which
 *   opens under the hold-alone rule (voice/types.ts TALK_HOLD_ALONE_MS): any other action on a bare modifier would fire
 *   on the first key of every shortcut;
 * - a remap back to an action's only default chord drops the override.
 */
import { isModifierChord, type ActionId, type KeyBinding, type KeyChord, type KeyContext, type Keymap } from '../../games/types';
import type { KeymapOverride, SettingsStore } from '../../store/types';
import { applyOverrides, chordFromEvent, chordToString, cheatSheet, findConflict, normalizeKey, reservedConflict, sameChord, validOverrides, type KeyInput } from '../keymap';

/** Actions a bare modifier may be bound to (PLAN Milestone 5, owner decisions, Talk key; DECISIONS [M5-C] CTRL_KEY_CHORD). */
export const MODIFIER_KEY_ACTIONS: readonly ActionId[] = ['talk'];

/** Modifier keys as KeyboardEvent.key names them (games/types.ts isModifierChord). */
const MODIFIERS = ['Control', 'Shift', 'Alt'] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Keys that move keyboard focus through cards and zones (ui/a11y, DECISIONS [M5-C]) and so cannot be remapped to. */
export const FOCUS_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'];

/** Why a remap was refused, or that it applied. */
export type RemapResult =
  | { ok: true }
  /** Another action of the same context holds the chord. */
  | { ok: false; reason: 'conflict'; chord: KeyChord; holder: { action: ActionId; context: KeyContext; label: string } }
  /** The HUD keeps the chord for itself (untap offer, keyboard focus). */
  | { ok: false; reason: 'reserved'; chord: KeyChord; label: string }
  /** A bare modifier for an action that cannot open on one. */
  | { ok: false; reason: 'modifier'; chord: KeyChord }
  /** The action has no binding in that context (nothing to remap). */
  | { ok: false; reason: 'unknown'; chord: KeyChord };

/** The plain sentence for a refused remap, or null when it applied (shown in the settings panel and the cheat sheet). */
export function remapMessage(r: RemapResult): string | null {
  if (r.ok) return null;
  const key = chordToString(r.chord);
  switch (r.reason) {
    case 'conflict':
      return `${key} is already “${r.holder.label}”.`;
    case 'reserved':
      return `${key} is already “${r.label}”.`;
    case 'modifier':
      return `${key} alone can only be the talk key: as the first key of every shortcut it would fire too often. Hold it with another key instead.`;
    case 'unknown':
      return `There is no key to change for this action.`;
  }
}

/** One row of the remapping table: an action in a context, its keys now and by default. */
export interface KeyRow {
  action: ActionId;
  context: KeyContext;
  label: string;
  group: KeyBinding['group'];
  trigger: KeyBinding['trigger'];
  chords: KeyChord[];
  defaults: KeyChord[];
  /** The player changed this action's key. */
  remapped: boolean;
  /** A bare modifier (Ctrl alone) is offered for this action. */
  modifierOk: boolean;
}

function reservedFocusKey(chord: KeyChord): boolean {
  return FOCUS_KEYS.includes(chord.key);
}

/** The keymap's rows grouped as in the cheat sheet (DESIGN canonical keymap order), with their defaults. */
export function keyRows(defaults: Keymap, overrides: readonly KeymapOverride[]): { group: KeyBinding['group']; rows: KeyRow[] }[] {
  const now = applyOverrides(defaults, overrides);
  const remapped = new Set(validOverrides(overrides).map((o) => `${o.context}|${o.action}`));
  return cheatSheet(now).map((g) => ({
    group: g.group,
    rows: g.rows.map((r) => ({
      action: r.action,
      context: r.context,
      label: r.label,
      group: g.group,
      trigger: r.trigger,
      chords: r.chords,
      defaults: defaults.filter((b) => b.action === r.action && b.context === r.context).map((b) => b.chord),
      remapped: remapped.has(`${r.context}|${r.action}`),
      modifierOk: MODIFIER_KEY_ACTIONS.includes(r.action),
    })),
  }));
}

/** Whether `chord` may be given to `action` in `context` in `keymap`; the conflict found, if any. */
export function checkRemap(keymap: Keymap, action: ActionId, context: KeyContext, chord: KeyChord): RemapResult {
  if (!keymap.some((b) => b.action === action && b.context === context)) return { ok: false, reason: 'unknown', chord };
  if (isModifierChord(chord) && !MODIFIER_KEY_ACTIONS.includes(action)) return { ok: false, reason: 'modifier', chord };
  const reserved = reservedConflict(chord, context);
  if (reserved) return { ok: false, reason: 'reserved', chord, label: reserved };
  if (reservedFocusKey(chord)) return { ok: false, reason: 'reserved', chord, label: 'Move keyboard focus' };
  const holder = findConflict(keymap, chord, context, action);
  if (holder) return { ok: false, reason: 'conflict', chord, holder: { action: holder.action, context: holder.context, label: holder.label } };
  return { ok: true };
}

/** A copy of a chord with only its set flags (stored overrides stay minimal). */
function cleanChord(c: KeyChord): KeyChord {
  const out: KeyChord = { key: c.key };
  if (c.ctrl) out.ctrl = true;
  if (c.alt) out.alt = true;
  if (c.shift) out.shift = true;
  return out;
}

/**
 * The player's keymap: the game's defaults with the stored overrides (`Settings.keymap`). Changes show at once and are
 * kept in the settings; a stored value read after the player changed something on this page does not override it.
 */
export class KeymapSettings {
  private list: KeymapOverride[] = [];
  private readonly listeners = new Set<(overrides: KeymapOverride[]) => void>();
  /** Bumped by every change on this page; a read that started before it does not override it. */
  private edits = 0;

  constructor(
    readonly defaults: Keymap,
    private readonly store: SettingsStore | null | undefined = null,
  ) {}

  /** The current overrides (a copy). */
  overrides(): KeymapOverride[] {
    return this.list.map((o) => ({ ...o, chord: { ...o.chord } }));
  }

  /** The keymap in effect: defaults with the overrides applied. */
  keymap(): KeyBinding[] {
    return applyOverrides(this.defaults, this.list);
  }

  rows(): { group: KeyBinding['group']; rows: KeyRow[] }[] {
    return keyRows(this.defaults, this.list);
  }

  subscribe(fn: (overrides: KeymapOverride[]) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Read the stored overrides (on mount; another tab may have changed them). A change made here meanwhile wins. */
  async load(): Promise<void> {
    if (!this.store) return;
    const at = this.edits;
    let stored: unknown;
    try {
      stored = await this.store.get('keymap');
    } catch {
      return;
    }
    if (at !== this.edits) return;
    this.list = validOverrides(stored);
    this.emit();
  }

  /** Give `action` in `context` the key `chord`; refused (and nothing changes) on a conflict. */
  remap(action: ActionId, context: KeyContext, chord: KeyChord): RemapResult {
    const c = cleanChord(chord);
    const check = checkRemap(this.keymap(), action, context, c);
    if (!check.ok) return check;
    this.put(action, context, c);
    this.commit();
    return check;
  }

  /**
   * Give `action` the key `chord` that another action of the same context holds, and that action `action`'s current key
   * (the remedy offered for a conflict). Refused for anything but a conflict with an ordinary action.
   */
  swap(action: ActionId, context: KeyContext, chord: KeyChord): RemapResult {
    const c = cleanChord(chord);
    const keymap = this.keymap();
    const check = checkRemap(keymap, action, context, c);
    if (check.ok || check.reason !== 'conflict') return check;
    const mine = keymap.find((b) => b.action === action && b.context === context);
    if (!mine) return { ok: false, reason: 'unknown', chord: c };
    const holder = check.holder;
    if (isModifierChord(mine.chord) && !MODIFIER_KEY_ACTIONS.includes(holder.action)) return { ok: false, reason: 'modifier', chord: mine.chord };
    this.put(action, context, c);
    this.put(holder.action, holder.context, cleanChord(mine.chord));
    this.commit();
    return { ok: true };
  }

  /** Back to the default key of one action. */
  reset(action: ActionId, context: KeyContext): void {
    const before = this.list.length;
    this.list = this.list.filter((o) => !(o.action === action && o.context === context));
    if (this.list.length !== before) this.commit();
  }

  /** Every key back to its default. */
  resetAll(): void {
    this.list = [];
    this.commit();
  }

  private put(action: ActionId, context: KeyContext, chord: KeyChord): void {
    this.list = this.list.filter((o) => !(o.action === action && o.context === context));
    const defaults = this.defaults.filter((b) => b.action === action && b.context === context);
    // Back to the action's only default key: no override needed.
    if (defaults.length === 1 && sameChord(defaults[0]!.chord, chord)) return;
    this.list.push({ action, context, chord });
  }

  private commit(): void {
    this.edits++;
    this.emit();
    void this.store?.set('keymap', this.overrides()).catch(() => undefined);
  }

  private emit(): void {
    const now = this.overrides();
    for (const fn of [...this.listeners]) fn(now);
  }
}

/** Whether a key event's `key` is a modifier this capture tracks. */
function modifierOf(key: string): Modifier | null {
  return (MODIFIERS as readonly string[]).includes(key) ? (key as Modifier) : null;
}

/** Whether a modifier key event carries any other modifier (or Meta) besides its own. */
function othersHeld(m: Modifier, e: KeyInput): boolean {
  return !!e.metaKey || (m !== 'Control' && !!e.ctrlKey) || (m !== 'Shift' && !!e.shiftKey) || (m !== 'Alt' && !!e.altKey);
}

/**
 * Captures the next chord the player presses for a remap. A plain chord (T, Shift+L, Ctrl+Enter) is taken on its
 * keydown; a modifier pressed and released with no other key in between is the bare-modifier chord ({key: 'Control'},
 * games/types.ts CTRL_KEY_CHORD), taken on its keyup, so Ctrl+T still captures Ctrl+T. Meta (Cmd) chords stay the
 * browser's and are never captured.
 */
export class ChordCapture {
  private pending: Modifier | null = null;

  /** A keydown: the chord it completes, or null (a modifier going down, a Meta chord, a dead key). */
  keydown(e: KeyInput): KeyChord | null {
    const m = modifierOf(e.key);
    if (m) {
      if (!e.repeat) this.pending = othersHeld(m, e) ? null : m;
      return null;
    }
    this.pending = null;
    return chordFromEvent(e);
  }

  /** A keyup: the bare modifier chord when a modifier was pressed and released alone, else null. */
  keyup(e: KeyInput): KeyChord | null {
    const m = modifierOf(e.key) ?? modifierOf(normalizeKey(e));
    const p = this.pending;
    this.pending = null;
    if (m && p === m) return { key: m };
    return null;
  }

  /** A click or blur in between: a held modifier is no longer alone. */
  reset(): void {
    this.pending = null;
  }
}
