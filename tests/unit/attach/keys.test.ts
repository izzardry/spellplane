/**
 * The keyboard and menu routes of attach and clips (PLAN Milestone 6, owner decisions: Tuck; Paperclips, Keyboard: 'a
 * "Clip" action … clips the selection together, or the focused card with the cards it overlaps; the context menu offers
 * "Clip together" for a selection'; Removing a clip: "the Clip key on a clipped card"; DECISIONS [M6-C]: attach and
 * clip are toggles, labelled by state in menus). Through the same key engine the HUD uses.
 */
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import type { ActionId } from '../../../src/games/types';
import { CARDS, drafts, rig } from '../ui/setup';

const chord = (a: ActionId) => MTG_KEYMAP.find((b) => b.action === a)!.chord;

/** bf1 overlaps ov1 (and ov2 overlaps ov1 only); a1 is attached to bf1. */
const cards = [
  ...CARDS,
  { id: 'ov1', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -180, y: -290, rot: 0 } },
  { id: 'ov2', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -130, y: -270, rot: 0 } },
  { id: 'a1', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: 300, y: -300, rot: 0 }, attachedTo: 'fd1' },
];

describe('attach key', () => {
  it('O on a card, then O on another card, attaches the first to the second (logged as attach)', () => {
    const r = rig({ cards, hovered: 'bf1' });
    r.press(chord('attach'));
    expect(drafts(r)).toEqual([]);
    r.view.hovered = 'opp1';
    r.press(chord('attach'));
    // Across battlefields it moves into the host's battlefield first, keeping its controller; one group, one undo step.
    expect(drafts(r)).toMatchObject([
      { type: 'move', card: 'bf1', to: 'battlefield:s1', pile: null, controller: 's0' },
      { type: 'attach', card: 'bf1', to: 'opp1' },
    ]);
    const groups = new Set(drafts(r).map((d) => d.group));
    expect(groups.size).toBe(1);
  });

  it('O on an attached card detaches it', () => {
    const r = rig({ cards, hovered: 'a1' });
    r.press(chord('attach'));
    expect(drafts(r)).toEqual([{ type: 'detach', card: 'a1' }]);
  });

  it('a second O on the same card, or another action in between, attaches nothing', () => {
    const r = rig({ cards, hovered: 'bf1' });
    r.press(chord('attach'));
    r.press(chord('attach'));
    expect(drafts(r)).toEqual([]);
    r.press(chord('attach'));
    r.view.hovered = 'dfc';
    r.press(chord('tap'));
    r.press(chord('attach'));
    expect(drafts(r)).toEqual([{ type: 'tap', card: 'dfc', tapped: true }]);
  });

  it('does nothing for a card off the battlefield', () => {
    const r = rig({ cards, hovered: 'h1' });
    r.press(chord('attach'));
    expect(drafts(r)).toEqual([]);
    expect(r.ui).toEqual([]);
  });
});

describe('clip key', () => {
  it('clips the hovered card with the cards it overlaps', () => {
    const r = rig({ cards, hovered: 'bf1' });
    r.press(chord('clip'));
    const d = drafts(r);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: 'clipAdd', cards: ['bf1', 'ov1'], anchor: { card: 'bf1' } });
  });

  it('clips the selection together', () => {
    const r = rig({ cards, hovered: 'ov2', selection: ['ov2', 'opp1', 'h1'] });
    r.press(chord('clip'));
    expect(drafts(r)).toMatchObject([{ type: 'clipAdd', cards: ['opp1', 'ov2'], anchor: { card: 'ov2' } }]);
  });

  it('on a clipped card it takes its clips off', () => {
    const r = rig({ cards, hovered: 'bf1' });
    const st = r.session.getState();
    st.clips = { k1: { id: 'k1', cards: ['bf1', 'ov1'], anchor: { card: 'bf1', x: 0, y: 0 }, by: 's1' }, k2: { id: 'k2', cards: ['bf1', 'dfc'], anchor: { card: 'bf1', x: 0, y: 0 }, by: 's0' } };
    r.press(chord('clip'));
    expect(drafts(r)).toMatchObject([
      { type: 'clipRemove', clip: 'k1' },
      { type: 'clipRemove', clip: 'k2' },
    ]);
  });

  it('says so when there is nothing to clip', () => {
    const r = rig({ cards, hovered: 'dfc' });
    r.press(chord('clip'));
    expect(drafts(r)).toEqual([]);
    expect(r.ui.map((u) => u.hook)).toEqual(['notify']);
  });
});

describe('menu labels follow the state', () => {
  it('attach reads Attach to… or Detach; clip reads Clip together, Clip to overlapping cards or Remove clip', () => {
    const r = rig({ cards, selection: ['bf1', 'ov1'] });
    const st = r.session.getState();
    expect(r.commands.menuLabel('attach', st.cards.bf1!)).toBe('Attach to…');
    expect(r.commands.menuLabel('attach', st.cards.a1!)).toBe('Detach');
    expect(r.commands.menuLabel('clip', st.cards.bf1!)).toBe('Clip together');
    expect(r.commands.menuLabel('clip', st.cards.dfc!)).toBe('Clip to overlapping cards');
    st.clips = { k1: { id: 'k1', cards: ['bf1', 'ov1'], anchor: { card: 'bf1', x: 0, y: 0 }, by: 's1' } };
    expect(r.commands.menuLabel('clip', st.cards.ov1!)).toBe('Remove clip');
    expect(r.commands.applies('clip', st.cards.h1!)).toBe(false);
  });
});
