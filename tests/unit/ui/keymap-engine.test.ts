/**
 * The key engine (DESIGN "Input and interaction design"): no key fires while a text field has focus, prompt bindings
 * take precedence while a prompt shows, the cheat sheet lists every bound key, remapping replaces bindings.
 */
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP, chordToString } from '../../../src/games/mtg/keymap';
import { applyOverrides, cheatSheet, chordFromEvent, findConflict, isTextEntry, matchesChord, normalizeKey, reservedConflict, validOverrides } from '../../../src/ui/keymap';
import { drafts, eventFor, rig } from './setup';

describe('no key fires while a text field has focus (PLAN M0-P4)', () => {
  it('ignores every binding of the keymap when the event comes from a text field', () => {
    const r = rig({ hovered: 'bf1', confirm: { id: 'r9', askedBy: 's1', durationMs: 5000, startSeq: 0, responses: {} } });
    for (const b of MTG_KEYMAP) {
      expect(r.press(b.chord, { inText: true })).toBe(false);
      r.clock.t += 100; // a quick second press would otherwise count as a double press
      r.press(b.chord, { inText: true });
    }
    expect(r.session.dispatched).toEqual([]);
    expect(r.session.calls).toEqual([]);
    expect(r.scene.calls).toEqual([]);
    expect(r.ui).toEqual([]);
  });

  it('recognises text entry elements: chat input, note field, textarea, contenteditable; not buttons or checkboxes', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it('a hold that started before focus moved into a text field ends on blur', () => {
    const r = rig({ hovered: 'bf1' });
    r.down({ key: ' ' });
    r.engine.blur();
    expect(r.ui).toEqual([
      { hook: 'inspect', args: ['bf1'] },
      { hook: 'inspect', args: [null] },
    ]);
  });
});

describe('key events', () => {
  it('auto-repeat does not fire a press binding again', () => {
    const r = rig({ hovered: 'bf1' });
    r.down({ key: 't' });
    r.down({ key: 't' }, { repeat: true });
    r.down({ key: 't' }, { repeat: true });
    expect(r.session.dispatched).toHaveLength(1);
  });

  it('Cmd (meta) chords never match, so browser shortcuts stay intact', () => {
    const r = rig({ hovered: 'bf1' });
    expect(r.engine.keydown({ key: 't', code: 'KeyT', metaKey: true }, false)).toBe(false);
    expect(r.session.dispatched).toEqual([]);
  });

  it('Shift changes letter chords: T taps, Shift+T rotates', () => {
    const r = rig({ hovered: 'bf1' });
    r.engine.keydown({ key: 'T', code: 'KeyT', shiftKey: true }, false);
    expect(drafts(r)).toEqual([{ type: 'rotate', card: 'bf1', delta: 180 }]);
  });

  it('macOS Option+F (key "ƒ") is Alt+F, peek', () => {
    expect(normalizeKey({ key: 'ƒ', code: 'KeyF', altKey: true })).toBe('f');
    expect(matchesChord({ key: 'f', alt: true }, { key: 'ƒ', code: 'KeyF', altKey: true })).toBe(true);
  });

  it('Ctrl+Shift+I flips a coin while Ctrl+I rolls a die', () => {
    expect(matchesChord({ key: 'i', ctrl: true, shift: true }, eventFor({ key: 'i', ctrl: true, shift: true }))).toBe(true);
    expect(matchesChord({ key: 'i', ctrl: true }, eventFor({ key: 'i', ctrl: true, shift: true }))).toBe(false);
  });

  it('+ and ? match whether or not the browser reports Shift; numpad + too', () => {
    expect(matchesChord({ key: '+' }, { key: '+', code: 'Equal', shiftKey: true })).toBe(true);
    expect(matchesChord({ key: '+' }, { key: '+', code: 'NumpadAdd' })).toBe(true);
    expect(matchesChord({ key: '?' }, { key: '?', code: 'Slash', shiftKey: true })).toBe(true);
  });

  it('Ctrl+Enter is next turn, not focus chat', () => {
    const r = rig();
    r.press({ key: 'Enter', ctrl: true });
    expect(r.ui).toEqual([]);
    expect(drafts(r)).toEqual([{ type: 'turnPass', to: 's1' }]);
  });
});

describe('prompt context (DESIGN "Turn flow and confirmation": H holds only while a prompt is showing)', () => {
  const prompt = { id: 'r9', askedBy: 's1', durationMs: 5000, startSeq: 0, responses: {} };

  it('without a prompt, H moves the hovered card to hand and Enter focuses the chat', () => {
    const r = rig({ hovered: 'bf1' });
    r.press({ key: 'h' });
    r.press({ key: 'Enter' });
    expect(drafts(r)).toEqual([{ type: 'toZone', card: 'bf1', to: 'hand:s0', position: 'any' }]);
    expect(r.ui).toEqual([{ hook: 'focusChat', args: [] }]);
  });

  it('with a prompt, H and Esc hold and Enter answers OK, never touching the hovered card', () => {
    const r = rig({ hovered: 'bf1', confirm: prompt });
    r.press({ key: 'h' });
    expect(drafts(r)).toEqual([{ type: 'respond', round: 'r9', seat: 's0', response: 'hold' }]);
    const r2 = rig({ hovered: 'bf1', confirm: prompt });
    r2.press({ key: 'Enter' });
    expect(drafts(r2)).toEqual([{ type: 'respond', round: 'r9', seat: 's0', response: 'ok' }]);
    expect(r2.ui).toEqual([]);
  });

  it('the asker sees no prompt, so H still moves to hand', () => {
    const r = rig({ hovered: 'bf1', confirm: { ...prompt, askedBy: 's0' } });
    r.press({ key: 'h' });
    expect(drafts(r)[0]).toMatchObject({ type: 'toZone' });
  });

  it('once answered OK, the prompt is gone for this seat', () => {
    const r = rig({ hovered: 'bf1', confirm: { ...prompt, responses: { s0: 'ok' } } });
    r.press({ key: 'Escape' });
    expect(r.session.dispatched).toEqual([]);
  });
});

describe('cheat sheet lists every bound key (PLAN M0-P4)', () => {
  it('contains every binding of the canonical keymap, in the canonical groups', () => {
    const sheet = cheatSheet(MTG_KEYMAP);
    expect(sheet.map((g) => g.group)).toEqual(['Card', 'Zones', 'Library', 'Combat', 'Stack', 'Turn', 'Confirm', 'Table', 'Talk', 'View']);
    const listed = sheet.flatMap((g) => g.rows.flatMap((r) => r.chords.map((c) => `${r.context}:${r.action}:${chordToString(c)}`)));
    const bound = MTG_KEYMAP.map((b) => `${b.context}:${b.action}:${chordToString(b.chord)}`);
    expect(listed.sort()).toEqual([...bound].sort());
  });

  it('lists remapped keys instead of the defaults', () => {
    const km = applyOverrides(MTG_KEYMAP, [{ action: 'tap', context: 'table', chord: { key: 'j' } }]);
    const rows = cheatSheet(km).flatMap((g) => g.rows);
    expect(rows.find((r) => r.action === 'tap')!.chords).toEqual([{ key: 'j' }]);
  });
});

describe('remapping (DESIGN "Input and interaction design": all keys are remappable)', () => {
  it('an override replaces every default chord of the action in its context', () => {
    const km = applyOverrides(MTG_KEYMAP, [{ action: 'counterAdd', context: 'table', chord: { key: 'j' } }]);
    expect(km.filter((b) => b.action === 'counterAdd').map((b) => b.chord)).toEqual([{ key: 'j' }]);
    expect(km).toHaveLength(MTG_KEYMAP.length - 1);
  });

  it('the remapped key fires the action and the old key no longer does', () => {
    const km = applyOverrides(MTG_KEYMAP, [{ action: 'tap', context: 'table', chord: { key: 'j' } }]);
    const r = rig({ hovered: 'bf1', keymap: km });
    r.press({ key: 't' });
    expect(r.session.dispatched).toEqual([]);
    r.press({ key: 'j' });
    expect(drafts(r)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);
  });

  it('only the overridden context changes: remapping table H leaves the prompt H (hold) alone', () => {
    const km = applyOverrides(MTG_KEYMAP, [{ action: 'toHand', context: 'table', chord: { key: 'j' } }]);
    expect(km.filter((b) => b.chord.key === 'h').map((b) => `${b.context}:${b.action}`)).toEqual(['prompt:confirmHold']);
  });

  it('ignores overrides of unknown actions; the last override of an action wins', () => {
    const km = applyOverrides(MTG_KEYMAP, [
      { action: 'nope', context: 'table', chord: { key: 'j' } },
      { action: 'tap', context: 'table', chord: { key: 'j' } },
      { action: 'tap', context: 'table', chord: { key: 'k', ctrl: true } },
    ]);
    expect(km.filter((b) => b.action === 'tap').map((b) => b.chord)).toEqual([{ key: 'k', ctrl: true }]);
    expect(km.some((b) => (b.action as string) === 'nope')).toBe(false);
  });

  it('finds conflicts within a context only', () => {
    expect(findConflict(MTG_KEYMAP, { key: 'g' }, 'table', 'tap')?.action).toBe('toGraveyard');
    expect(findConflict(MTG_KEYMAP, { key: 'g' }, 'table', 'toGraveyard')).toBeNull();
    expect(findConflict(MTG_KEYMAP, { key: 'h' }, 'prompt', 'confirmOk')?.action).toBe('confirmHold');
    expect(findConflict(MTG_KEYMAP, { key: 'j' }, 'table', 'tap')).toBeNull();
  });

  it('builds a chord from a key event, dropping implied Shift and bare modifiers', () => {
    expect(chordFromEvent({ key: 'J', code: 'KeyJ', shiftKey: true })).toEqual({ key: 'j', shift: true });
    expect(chordFromEvent({ key: '?', code: 'Slash', shiftKey: true })).toEqual({ key: '?' });
    expect(chordFromEvent({ key: 'Shift', shiftKey: true })).toBeNull();
    expect(chordFromEvent({ key: 'k', metaKey: true })).toBeNull();
    expect(chordFromEvent({ key: 'Enter', ctrlKey: true })).toEqual({ key: 'Enter', ctrl: true });
  });
});

describe('stored overrides and reserved keys (DESIGN "Input and interaction design", Discoverable)', () => {
  it('keeps only well-formed overrides from settings, so a corrupt entry cannot break the keymap', () => {
    const loaded = validOverrides([
      { action: 'tap', context: 'table', chord: { key: 'j', shift: true, ctrl: 'yes' } },
      { action: 'flip', context: 'table' },
      { action: 'flip', context: 'table', chord: null },
      { action: 'flip', context: 'nowhere', chord: { key: 'k' } },
      { action: 7, context: 'table', chord: { key: 'k' } },
      null,
      'tap',
    ]);
    expect(loaded).toEqual([{ action: 'tap', context: 'table', chord: { key: 'j', shift: true } }]);
    expect(validOverrides({ tap: 'j' })).toEqual([]);
    expect(() => applyOverrides(MTG_KEYMAP, validOverrides([{ action: 'tap', context: 'table' }]))).not.toThrow();
  });

  it('the untap-and-draw offer key U is reserved in the table context', () => {
    expect(reservedConflict({ key: 'u' }, 'table')).toMatch(/untap all and draw/i);
    expect(reservedConflict({ key: 'u', ctrl: true }, 'table')).toBeNull();
    expect(reservedConflict({ key: 'u' }, 'prompt')).toBeNull();
    expect(MTG_KEYMAP.some((b) => b.context === 'table' && b.chord.key === 'u' && !b.chord.ctrl && !b.chord.alt && !b.chord.shift)).toBe(false);
  });
});
