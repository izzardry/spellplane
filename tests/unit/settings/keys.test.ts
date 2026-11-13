// Key remapping (DESIGN "Input and interaction design": "all keys are remappable", "no chord twice within one context",
// "Keys never fire while a text field has focus"; PLAN M5-P5: key remapping UI with every action in the keymap, conflict
// detection, reset; PLAN Milestone 5, owner decisions, Talk key: Ctrl, either key, "the key stays remappable in M5-P5's
// key-remapping UI"; the cheat sheet reflects remaps).
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { CTRL_KEY_CHORD, type ActionId } from '../../../src/games/types';
import { MemorySettings } from '../../../src/ui/fakes';
import { applyOverrides, cheatSheet, findBinding, keyLabel } from '../../../src/ui/keymap';
import { ChordCapture, checkRemap, FOCUS_KEYS, KeymapSettings, keyRows, remapMessage } from '../../../src/ui/settings/keys';

const ALL_ACTIONS = [...new Set(MTG_KEYMAP.map((b) => `${b.context}|${b.action}`))];

function fresh(initial: ConstructorParameters<typeof MemorySettings>[0] = {}) {
  const store = new MemorySettings(initial);
  return { store, keys: new KeymapSettings(MTG_KEYMAP, store) };
}

describe('every action of the keymap can be remapped', () => {
  it('lists every action in every context once, in the canonical groups, with its current and default keys', () => {
    const rows = keyRows(MTG_KEYMAP, []).flatMap((g) => g.rows);
    expect(rows.map((r) => `${r.context}|${r.action}`).sort()).toEqual([...ALL_ACTIONS].sort());
    const add = rows.find((r) => r.action === 'counterAdd')!;
    // An action with two default keys (+ and =) lists both.
    expect(add.chords).toEqual([{ key: '+' }, { key: '=' }]);
    expect(add.defaults).toEqual(add.chords);
    expect(rows.every((r) => !r.remapped)).toBe(true);
  });

  it.each(ALL_ACTIONS)('%s takes a free key, which then fires that action and no longer the old one', (id) => {
    const [context, action] = id.split('|') as ['table' | 'prompt', ActionId];
    const { keys } = fresh();
    // F12 is bound to nothing in either context.
    expect(keys.remap(action, context, { key: 'F12' })).toEqual({ ok: true });
    const map = keys.keymap();
    expect(findBinding(map, { key: 'F12' }, context === 'prompt')?.action).toBe(action);
    const old = MTG_KEYMAP.find((b) => b.action === action && b.context === context)!.chord;
    const oldNow = findBinding(map, { key: old.key, ctrlKey: !!old.ctrl, shiftKey: !!old.shift, altKey: !!old.alt }, context === 'prompt');
    expect(oldNow?.action === action && oldNow.context === context).toBe(false);
  });
});

describe('conflicts', () => {
  it('a key another action of the same context holds is refused, named, and nothing changes', () => {
    const { keys, store } = fresh();
    const r = keys.remap('tap', 'table', { key: 'g' });
    expect(r).toMatchObject({ ok: false, reason: 'conflict', holder: { action: 'toGraveyard', label: 'To graveyard' } });
    expect(remapMessage(r)).toBe('G is already “To graveyard”.');
    expect(keys.overrides()).toEqual([]);
    expect(keyLabel(keys.keymap(), 'tap')).toBe('T');
    expect(store.writes).toEqual([]);
  });

  it('modifiers count: Shift+G and Ctrl+G are free, Ctrl+T is "Create token"', () => {
    const { keys } = fresh();
    expect(keys.remap('tap', 'table', { key: 'g', shift: true })).toEqual({ ok: true });
    expect(keys.remap('flip', 'table', { key: 'g', ctrl: true })).toEqual({ ok: true });
    expect(keys.remap('rotate180', 'table', { key: 't', ctrl: true })).toMatchObject({ ok: false, reason: 'conflict', holder: { action: 'token' } });
  });

  it('the same key in the other context is not a conflict (prompt keys take precedence only while a prompt shows)', () => {
    const { keys } = fresh();
    // K asks on the table; it may also be OK while a prompt shows.
    expect(keys.remap('confirmOk', 'prompt', { key: 'k' })).toEqual({ ok: true });
    expect(findBinding(keys.keymap(), { key: 'k' }, true)?.action).toBe('confirmOk');
    expect(findBinding(keys.keymap(), { key: 'k' }, false)?.action).toBe('ask');
  });

  it('a conflict with a key it held itself is no conflict, and a remap to the only default drops the override', () => {
    const { keys, store } = fresh();
    expect(keys.remap('tap', 'table', { key: 'j' })).toEqual({ ok: true });
    expect(keys.remap('tap', 'table', { key: 't' })).toEqual({ ok: true });
    expect(keys.overrides()).toEqual([]);
    expect(store.writes.at(-1)).toEqual({ name: 'keymap', value: [] });
  });

  it('refuses keys the HUD keeps: the untap offer (U) and the focus keys (arrows, PageUp, PageDown)', () => {
    const { keys } = fresh();
    expect(remapMessage(keys.remap('tap', 'table', { key: 'u' }))).toContain('Untap all and draw');
    for (const key of FOCUS_KEYS) expect(keys.remap('tap', 'table', { key })).toMatchObject({ ok: false, reason: 'reserved' });
  });

  it('swapping gives each action the other one\'s key', () => {
    const { keys } = fresh();
    expect(keys.swap('tap', 'table', { key: 'g' })).toEqual({ ok: true });
    const map = keys.keymap();
    expect(keyLabel(map, 'tap')).toBe('G');
    expect(keyLabel(map, 'toGraveyard')).toBe('T');
    expect(findBinding(map, { key: 'g' }, false)?.action).toBe('tap');
    expect(findBinding(map, { key: 't' }, false)?.action).toBe('toGraveyard');
    // Every chord is still held once per context.
    const seen = new Set(map.map((b) => `${b.context}|${b.chord.ctrl ? 'c' : ''}${b.chord.alt ? 'a' : ''}${b.chord.shift ? 's' : ''}${b.chord.key}`));
    expect(seen.size).toBe(map.length);
    // A swap is only for a conflict.
    expect(keys.swap('flip', 'table', { key: 'F12' })).toEqual({ ok: true });
    expect(keyLabel(keys.keymap(), 'flip')).toBe('F');
    expect(keys.swap('flip', 'table', { key: 'u' })).toMatchObject({ ok: false, reason: 'reserved' });
  });
});

describe('the talk key (owner decision: Ctrl, remappable)', () => {
  it('takes Ctrl alone (the bare-modifier chord), which no Ctrl shortcut conflicts with', () => {
    const { keys } = fresh();
    expect(keys.remap('talk', 'table', CTRL_KEY_CHORD)).toEqual({ ok: true });
    expect(keys.keymap().find((b) => b.action === 'talk')!.chord).toEqual(CTRL_KEY_CHORD);
    // Ctrl+T, Ctrl+Z, Ctrl+Enter keep their actions.
    expect(findBinding(keys.keymap(), { key: 't', ctrlKey: true }, false)?.action).toBe('token');
    expect(findBinding(keys.keymap(), { key: 'z', ctrlKey: true }, false)?.action).toBe('undo');
  });

  it('a bare modifier is refused for any other action, with the reason', () => {
    const { keys } = fresh();
    for (const key of ['Control', 'Shift', 'Alt']) {
      const r = keys.remap('tap', 'table', { key });
      expect(r).toMatchObject({ ok: false, reason: 'modifier' });
      expect(remapMessage(r)).toMatch(/only be the talk key/);
    }
    expect(checkRemap(MTG_KEYMAP, 'teamTalk', 'table', CTRL_KEY_CHORD)).toMatchObject({ ok: false, reason: 'modifier' });
  });

  it('moves from Ctrl to a letter and back, each persisted', async () => {
    const { keys, store } = fresh();
    const storedTalk = async () => applyOverrides(MTG_KEYMAP, await store.get('keymap')).find((b) => b.action === 'talk')!.chord;
    keys.remap('talk', 'table', CTRL_KEY_CHORD);
    expect(await storedTalk()).toEqual(CTRL_KEY_CHORD);
    expect(keys.remap('talk', 'table', { key: 'j' })).toEqual({ ok: true });
    expect(await store.get('keymap')).toEqual([{ action: 'talk', context: 'table', chord: { key: 'j' } }]);
    keys.remap('talk', 'table', CTRL_KEY_CHORD);
    // Whether Ctrl is the default (M5-P7) or an override, the stored keymap gives Ctrl.
    expect(await storedTalk()).toEqual(CTRL_KEY_CHORD);
  });

  it('a stored Ctrl talk key loads back', async () => {
    const { keys } = fresh({ keymap: [{ action: 'talk', context: 'table', chord: { key: 'Control' } }] });
    await keys.load();
    expect(keys.keymap().find((b) => b.action === 'talk')!.chord).toEqual(CTRL_KEY_CHORD);
    expect(keyRows(MTG_KEYMAP, keys.overrides()).flatMap((g) => g.rows).find((r) => r.action === 'talk')).toMatchObject({ remapped: true, modifierOk: true });
  });
});

describe('reset', () => {
  it('one action goes back to its default keys, the others stay', () => {
    const { keys } = fresh();
    keys.remap('tap', 'table', { key: 'j' });
    keys.remap('counterAdd', 'table', { key: 'F9' });
    keys.reset('counterAdd', 'table');
    expect(keyRows(MTG_KEYMAP, keys.overrides()).flatMap((g) => g.rows).find((r) => r.action === 'counterAdd')!.chords).toEqual([{ key: '+' }, { key: '=' }]);
    expect(keyLabel(keys.keymap(), 'tap')).toBe('J');
  });

  it('reset all restores the canonical keymap and stores no override', async () => {
    const { keys, store } = fresh();
    keys.remap('tap', 'table', { key: 'j' });
    keys.swap('draw', 'table', { key: 's' });
    keys.resetAll();
    expect(keys.keymap()).toEqual([...MTG_KEYMAP]);
    expect(await store.get('keymap')).toEqual([]);
  });
});

describe('the cheat sheet and the HUD read the same keymap', () => {
  it('a remap shows in the cheat sheet rows at once and reaches subscribers', () => {
    const { keys } = fresh();
    const seen: unknown[] = [];
    keys.subscribe((o) => seen.push(o));
    keys.remap('tap', 'table', { key: 'j' });
    const tap = cheatSheet(keys.keymap())
      .flatMap((g) => g.rows)
      .find((r) => r.action === 'tap')!;
    expect(tap.chords).toEqual([{ key: 'j' }]);
    expect(seen).toEqual([[{ action: 'tap', context: 'table', chord: { key: 'j' } }]]);
  });
});

describe('stored overrides', () => {
  it('loads well-formed overrides and drops malformed ones', async () => {
    const { keys } = fresh({ keymap: [{ action: 'tap', context: 'table', chord: { key: 'j' } }, { action: 'flip', context: 'nowhere', chord: { key: 'k' } }, null, { action: 'draw' }] as never });
    await keys.load();
    expect(keys.overrides()).toEqual([{ action: 'tap', context: 'table', chord: { key: 'j' } }]);
  });

  it('a remap made while the stored keymap is being read wins over the late read', async () => {
    let release!: () => void;
    const store = new MemorySettings({ keymap: [{ action: 'tap', context: 'table', chord: { key: 'y' } }] });
    const slow = Object.assign(Object.create(store) as MemorySettings, {
      get: async (name: 'keymap') => {
        await new Promise<void>((r) => (release = r));
        return store.get(name);
      },
      set: store.set.bind(store),
    });
    const keys = new KeymapSettings(MTG_KEYMAP, slow);
    const loading = keys.load();
    expect(keys.remap('tap', 'table', { key: 'j' })).toEqual({ ok: true });
    release();
    await loading;
    expect(keyLabel(keys.keymap(), 'tap')).toBe('J');
  });

  it('works without a settings store (changes last for the page)', () => {
    const keys = new KeymapSettings(MTG_KEYMAP, null);
    expect(keys.remap('tap', 'table', { key: 'j' })).toEqual({ ok: true });
    expect(keyLabel(keys.keymap(), 'tap')).toBe('J');
  });
});

describe('ChordCapture: the key a player presses for a remap', () => {
  it('a plain key and a chord are taken on keydown', () => {
    const c = new ChordCapture();
    expect(c.keydown({ key: 'j', code: 'KeyJ' })).toEqual({ key: 'j' });
    expect(c.keydown({ key: 'L', code: 'KeyL', shiftKey: true })).toEqual({ key: 'l', shift: true });
  });

  it('Ctrl pressed and released alone is the bare Ctrl chord, either Ctrl key', () => {
    const c = new ChordCapture();
    expect(c.keydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true })).toBeNull();
    expect(c.keyup({ key: 'Control', code: 'ControlLeft' })).toEqual(CTRL_KEY_CHORD);
    expect(c.keydown({ key: 'Control', code: 'ControlRight', ctrlKey: true })).toBeNull();
    expect(c.keyup({ key: 'Control', code: 'ControlRight' })).toEqual(CTRL_KEY_CHORD);
  });

  it('Ctrl with another key is that chord, and releasing Ctrl afterwards adds nothing', () => {
    const c = new ChordCapture();
    c.keydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(c.keydown({ key: 't', code: 'KeyT', ctrlKey: true })).toEqual({ key: 't', ctrl: true });
    expect(c.keyup({ key: 'Control', code: 'ControlLeft' })).toBeNull();
  });

  it('Shift then Ctrl is not a bare Ctrl; Meta chords and auto-repeat are ignored; a click in between cancels', () => {
    const c = new ChordCapture();
    c.keydown({ key: 'Shift', shiftKey: true });
    c.keydown({ key: 'Control', ctrlKey: true, shiftKey: true });
    expect(c.keyup({ key: 'Control' })).toBeNull();
    expect(c.keydown({ key: 'c', code: 'KeyC', metaKey: true })).toBeNull();
    c.keydown({ key: 'Control', ctrlKey: true });
    c.reset();
    expect(c.keyup({ key: 'Control' })).toBeNull();
    c.keydown({ key: 'Alt', altKey: true });
    c.keydown({ key: 'Alt', altKey: true, repeat: true });
    expect(c.keyup({ key: 'Alt' })).toEqual({ key: 'Alt' });
  });
});
