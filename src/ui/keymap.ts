/**
 * The keymap engine (DESIGN "Input and interaction design": hover plus key, keys never fire while a text field has
 * focus, all keys remappable; "Combat and annotation", Ping: double press). Pure apart from the optional clock, so it
 * runs in Vitest without a DOM. The HUD feeds it keyboard events and runs the matched action (ui/commands.ts).
 */
import type { ActionId, KeyBinding, KeyChord, KeyContext, Keymap } from '../games/types';
import type { KeymapOverride } from '../store/types';
import { chordToString } from '../games/mtg/keymap';

export { chordToString };

/** The parts of a KeyboardEvent the engine reads (DESIGN "Input and interaction design"). */
export interface KeyInput {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

const NAMED_ALIASES: Record<string, string> = { Spacebar: ' ', Esc: 'Escape', Add: '+', Subtract: '-' };

function isLetter(k: string): boolean {
  return k.length === 1 && k.toLowerCase() !== k.toUpperCase();
}

/**
 * Normalise KeyboardEvent.key as the KeyChord contract describes it (games/types.ts): letters lower case, named keys
 * as the browser names them, other printable keys as the produced character. With Alt or Ctrl held, a letter key is
 * read from `code`, because macOS Option turns Alt+F into 'ƒ'.
 */
export function normalizeKey(e: KeyInput): string {
  let key = NAMED_ALIASES[e.key] ?? e.key;
  if ((e.altKey || e.ctrlKey) && e.code && /^Key[A-Z]$/.test(e.code) && !/^[a-z]$/i.test(key)) key = e.code.slice(3);
  if ((e.altKey || e.ctrlKey) && e.code && /^Digit[0-9]$/.test(e.code) && !/^[0-9]$/.test(key)) key = e.code.slice(5);
  return isLetter(key) && key.length === 1 ? key.toLowerCase() : key;
}

/** Whether Shift is part of a chord for this key: yes for letters and named keys, no for other printable characters. */
export function shiftCounts(key: string): boolean {
  return key.length > 1 || isLetter(key);
}

/** Whether a key event matches a chord (DESIGN "Input and interaction design"). Meta (Cmd) never matches, so browser shortcuts stay intact. */
export function matchesChord(chord: KeyChord, e: KeyInput): boolean {
  if (e.metaKey) return false;
  if (normalizeKey(e) !== chord.key) return false;
  if (!!chord.ctrl !== !!e.ctrlKey) return false;
  if (!!chord.alt !== !!e.altKey) return false;
  if (shiftCounts(chord.key) && !!chord.shift !== !!e.shiftKey) return false;
  return true;
}

/** The chord a key event produces, or null for a bare modifier or a Meta chord (remapping, DESIGN "Input and interaction design"). */
export function chordFromEvent(e: KeyInput): KeyChord | null {
  if (e.metaKey || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process'].includes(e.key)) return null;
  const key = normalizeKey(e);
  const chord: KeyChord = { key };
  if (e.ctrlKey) chord.ctrl = true;
  if (e.altKey) chord.alt = true;
  if (e.shiftKey && shiftCounts(key)) chord.shift = true;
  return chord;
}

/** Whether two chords are the same key combination. */
export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && (!shiftCounts(a.key) || !!a.shift === !!b.shift);
}

/**
 * Apply remappings (DESIGN "Input and interaction design": all keys are remappable; store/types.ts KeymapOverride):
 * an override's chord replaces every default binding of its action in its context. Overrides for unknown actions are
 * ignored; a later override of the same action and context wins.
 */
export function applyOverrides(defaults: Keymap, overrides: readonly KeymapOverride[]): KeyBinding[] {
  const last = new Map<string, KeymapOverride>();
  for (const o of overrides) last.set(`${o.context}|${o.action}`, o);
  const out: KeyBinding[] = [];
  const placed = new Set<string>();
  for (const b of defaults) {
    const id = `${b.context}|${b.action}`;
    const o = last.get(id);
    if (!o) {
      out.push(b);
      continue;
    }
    if (placed.has(id)) continue;
    placed.add(id);
    const chord: KeyChord = { key: o.chord.key };
    if (o.chord.ctrl) chord.ctrl = true;
    if (o.chord.alt) chord.alt = true;
    if (o.chord.shift && shiftCounts(o.chord.key)) chord.shift = true;
    out.push({ ...b, chord });
  }
  return out;
}

/** The binding (of another action) that already uses `chord` in `context`, or null (DESIGN "Input and interaction design": no chord twice within one context). */
export function findConflict(keymap: Keymap, chord: KeyChord, context: KeyContext, action: ActionId): KeyBinding | null {
  return keymap.find((b) => b.context === context && b.action !== action && sameChord(b.chord, chord)) ?? null;
}

/**
 * Keys the HUD reserves outside the keymap (DESIGN "Turn flow and confirmation": on Next turn the new active player is
 * offered a single key that untaps everything and draws). `ActionId` is a contract type, so the offer key is not a
 * remappable binding; remapping refuses it and the cheat sheet lists it.
 */
export const RESERVED_KEYS: readonly { chord: KeyChord; context: KeyContext; label: string }[] = [{ chord: { key: 'u' }, context: 'table', label: 'Untap all and draw (when offered)' }];

/** The reserved key's label when `chord` is reserved in `context`, else null. */
export function reservedConflict(chord: KeyChord, context: KeyContext): string | null {
  return RESERVED_KEYS.find((r) => r.context === context && sameChord(r.chord, chord))?.label ?? null;
}

/**
 * Keymap overrides as loaded from settings, keeping only well-formed records (a stored value may come from an older
 * build or be corrupted; a malformed entry must not break the keymap).
 */
export function validOverrides(value: unknown): KeymapOverride[] {
  if (!Array.isArray(value)) return [];
  const out: KeymapOverride[] = [];
  for (const v of value as unknown[]) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const c = o.chord as Record<string, unknown> | null | undefined;
    if (typeof o.action !== 'string' || (o.context !== 'table' && o.context !== 'prompt')) continue;
    if (!c || typeof c !== 'object' || typeof c.key !== 'string' || c.key === '') continue;
    const chord: KeymapOverride['chord'] = { key: c.key };
    if (c.ctrl === true) chord.ctrl = true;
    if (c.alt === true) chord.alt = true;
    if (c.shift === true) chord.shift = true;
    out.push({ action: o.action, context: o.context, chord });
  }
  return out;
}

/**
 * Which prompt bindings are live: false while no prompt shows, true for all of them, or a test per action (a prompt
 * binding whose action can do nothing right now, such as Hold while this seat already holds, lets the key fall through).
 */
export type PromptKeys = boolean | ((action: ActionId) => boolean);

/** The binding for a key event: live prompt bindings take precedence while a prompt shows and are dead otherwise. */
export function findBinding(keymap: Keymap, e: KeyInput, prompt: PromptKeys): KeyBinding | null {
  if (prompt) {
    const p = keymap.find((b) => b.context === 'prompt' && matchesChord(b.chord, e) && (prompt === true || prompt(b.action)));
    if (p) return p;
  }
  return keymap.find((b) => b.context === 'table' && matchesChord(b.chord, e)) ?? null;
}

/** Key text for an action, e.g. 'Shift+L', from the first binding in `context` (context menus, DESIGN "Input and interaction design"). */
export function keyLabel(keymap: Keymap, action: ActionId, context: KeyContext = 'table'): string | null {
  const b = keymap.find((x) => x.action === action && x.context === context);
  return b ? chordToString(b.chord) : null;
}

/** Cheat-sheet group order: the canonical table's (DESIGN "Input and interaction design"). */
export const GROUP_ORDER: readonly KeyBinding['group'][] = ['Card', 'Zones', 'Library', 'Combat', 'Stack', 'Turn', 'Confirm', 'Table', 'Talk', 'View'];

/** One cheat-sheet row: an action in a context with all its chords. */
export interface CheatRow {
  action: ActionId;
  context: KeyContext;
  label: string;
  trigger: KeyBinding['trigger'];
  chords: KeyChord[];
}

/** The `?` cheat sheet: every binding of the keymap, grouped as in the canonical table (DESIGN "Input and interaction design", Discoverable). */
export function cheatSheet(keymap: Keymap): { group: KeyBinding['group']; rows: CheatRow[] }[] {
  const groups = new Map<KeyBinding['group'], CheatRow[]>();
  for (const b of keymap) {
    const rows = groups.get(b.group) ?? [];
    groups.set(b.group, rows);
    const row = rows.find((r) => r.action === b.action && r.context === b.context);
    if (row) row.chords.push(b.chord);
    else rows.push({ action: b.action, context: b.context, label: b.label, trigger: b.trigger, chords: [b.chord] });
  }
  const order = [...GROUP_ORDER, ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g))];
  return order.filter((g) => groups.has(g)).map((group) => ({ group, rows: groups.get(group)! }));
}

/** Whether a focused element takes text, so no key may fire (DESIGN "Input and interaction design"). Duck-typed for tests. */
export function isTextEntry(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as { tagName?: string; type?: string; isContentEditable?: boolean };
  if (node.isContentEditable) return true;
  const tag = (node.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (node.type ?? 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'file', 'image'].includes(type);
}

/** What the engine asks the HUD to do (DESIGN "Input and interaction design"). */
export interface KeyEngineHandlers {
  /** A press or double-press binding fired, or a hold binding started. */
  start(binding: KeyBinding): void;
  /** A hold binding's key was released (or the window lost focus). */
  end(binding: KeyBinding): void;
}

/** Window for a double press (DESIGN "Combat and annotation", Ping: double-tapping a key). */
export const DOUBLE_PRESS_MS = 400;

/**
 * Turns key events into binding starts and ends. Press bindings fire once per key press (auto-repeat is swallowed),
 * hold bindings fire `start` on press and `end` on release, double bindings fire on the second press within
 * DOUBLE_PRESS_MS. Events from text fields are ignored entirely.
 */
export class KeyEngine {
  private keymap: Keymap;
  private readonly held = new Map<string, KeyBinding>();
  private lastPress: { action: ActionId; at: number } | null = null;

  constructor(
    keymap: Keymap,
    private readonly handlers: KeyEngineHandlers,
    private readonly promptShowing: () => PromptKeys,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.keymap = keymap;
  }

  setKeymap(keymap: Keymap): void {
    this.blur();
    this.keymap = keymap;
  }

  /** Returns true when the event was consumed (the caller then prevents the browser default). */
  keydown(e: KeyInput, inTextField: boolean): boolean {
    if (inTextField) return false;
    const binding = findBinding(this.keymap, e, this.promptShowing());
    if (!binding) return false;
    if (e.repeat) return true;
    if (binding.trigger === 'hold') {
      const k = normalizeKey(e);
      if (this.held.has(k)) return true;
      this.held.set(k, binding);
      this.handlers.start(binding);
      return true;
    }
    if (binding.trigger === 'double') {
      const t = this.now();
      if (this.lastPress && this.lastPress.action === binding.action && t - this.lastPress.at <= DOUBLE_PRESS_MS) {
        this.lastPress = null;
        this.handlers.start(binding);
      } else this.lastPress = { action: binding.action, at: t };
      return true;
    }
    this.lastPress = null;
    this.handlers.start(binding);
    return true;
  }

  /** Ends a hold whose key is released, whatever modifiers are down by then. */
  keyup(e: KeyInput): boolean {
    const k = normalizeKey(e);
    const b = this.held.get(k);
    if (!b) return false;
    this.held.delete(k);
    this.handlers.end(b);
    return true;
  }

  /** Window blur or focus moving into a text field: end every hold. */
  blur(): void {
    const holds = [...this.held.values()];
    this.held.clear();
    for (const b of holds) this.handlers.end(b);
  }
}
