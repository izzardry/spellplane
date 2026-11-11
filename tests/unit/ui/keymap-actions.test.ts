/**
 * PLAN M0-P4 acceptance: every action in the canonical keymap dispatches the right action on the hovered card
 * (DESIGN "Input and interaction design", Canonical default keymap; the action semantics come from "Card manipulation",
 * "Combat and annotation", "The effect stack", "Turn flow and confirmation" and "Camera and navigation").
 * Each binding of MTG_KEYMAP is pressed as a browser would send it, through the same key engine the HUD uses.
 */
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP, chordToString } from '../../../src/games/mtg/keymap';
import type { ActionId, KeyBinding } from '../../../src/games/types';
import { drafts, rig, type Rig } from './setup';

const promptByBen = { id: 'r9', askedBy: 's1', durationMs: 5000, startSeq: 0, responses: {} };
const spellOnStack = { id: 'si9', kind: 'spell' as const, controller: 's0', card: 'bf1' };

interface Scenario {
  setup?: Parameters<typeof rig>[0];
  /** Hold the key down before checking (hold bindings), then release and check `after`. */
  hold?: boolean;
  expect(r: Rig): void | Promise<void>;
  after?(r: Rig): void;
}

const flush = () => new Promise((res) => setTimeout(res, 0));

const S: Record<ActionId, Scenario> = {
  // Card
  tap: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]) },
  flip: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'flip', card: 'bf1', face: 'down' }]) },
  transform: { setup: { hovered: 'dfc' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'transform', card: 'dfc', faceIndex: 1 }]) },
  rotate180: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'rotate', card: 'bf1', delta: 180 }]) },
  counterAdd: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'counter', card: 'bf1', kind: '+1/+1', delta: 1 }]) },
  counterRemove: {
    setup: { hovered: 'bf1', cards: [{ id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear', counters: { '+1/+1': 2 } }] },
    expect: (r) => expect(drafts(r)).toEqual([{ type: 'counter', card: 'bf1', kind: '+1/+1', delta: -1 }]),
  },
  note: { setup: { hovered: 'bf1' }, expect: (r) => expect(r.ui).toEqual([{ hook: 'openNote', args: [{ card: 'bf1' }] }]) },
  copy: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'copy', card: 'c1', of: 'bf1', pose: { x: -131, y: -300, rot: 0 } }]) },
  revealTo: { setup: { hovered: 'h1' }, expect: (r) => expect(r.ui).toEqual([{ hook: 'openRevealTo', args: [['h1']] }]) },
  peek: {
    setup: { hovered: 'fd1' },
    expect: (r) => {
      expect(drafts(r)).toEqual([{ type: 'lookAt', zone: 'battlefield:s0', count: 1, card: 'fd1' }]);
      expect(r.ui).toEqual([{ hook: 'inspect', args: ['fd1'] }]);
    },
  },
  ping: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'ping', target: { kind: 'card', id: 'bf1' } }]) },
  zoomTo: { setup: { hovered: 'bf1' }, expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.zoomTo', args: ['bf1'] }]) },
  inspect: {
    setup: { hovered: 'bf1' },
    hold: true,
    expect: (r) => expect(r.ui).toEqual([{ hook: 'inspect', args: ['bf1'] }]),
    after: (r) => expect(r.ui).toEqual([{ hook: 'inspect', args: ['bf1'] }, { hook: 'inspect', args: [null] }]),
  },
  // Zones
  toGraveyard: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'move', card: 'bf1', to: 'graveyard:s0' }]) },
  toExile: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'move', card: 'bf1', to: 'exile:s0' }]) },
  toHand: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'toZone', card: 'bf1', to: 'hand:s0', position: 'any' }]) },
  toLibraryTop: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'toZone', card: 'bf1', to: 'library:s0', position: 'top' }]) },
  toLibraryBottom: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'toZone', card: 'bf1', to: 'library:s0', position: 'bottom' }]) },
  cast: { setup: { hovered: 'h1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'stackPush', item: 'si1', kind: 'spell', card: 'h1', controller: 's0', round: 'r2' }]) },
  // Library
  draw: { expect: (r) => expect(r.session.calls).toEqual([{ method: 'draw', args: [1] }]) },
  drawN: { expect: (r) => expect(r.ui).toEqual([{ hook: 'openDrawN', args: [] }]) },
  shuffle: { expect: (r) => expect(r.session.calls).toEqual([{ method: 'shuffle', args: [] }]) },
  mulligan: { expect: (r) => expect(r.session.calls).toEqual([{ method: 'mulligan', args: [] }]) },
  // Combat: 110 mm toward the centre along the seat's forward axis (DESIGN "Specification: geometry, layout and motion")
  attack: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'moveTemp', card: 'bf1', pose: { x: -200, y: -190, rot: 0 }, combat: 'attack', tap: true }]) },
  attackNoTap: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'moveTemp', card: 'bf1', pose: { x: -200, y: -190, rot: 0 }, combat: 'attack', tap: false }]) },
  settle: { expect: (r) => expect(drafts(r)).toEqual([{ type: 'settle' }]) },
  // Stack
  ability: { setup: { hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'stackPush', item: 'si1', kind: 'ability', source: 'bf1', controller: 's0', round: 'r2' }]) },
  resolve: { setup: { stack: [spellOnStack] }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'stackResolve', item: 'si9' }]) },
  counterTop: { setup: { stack: [spellOnStack] }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'stackCounter', item: 'si9' }]) },
  // Turn
  nextPhase: { expect: (r) => expect(drafts(r)).toEqual([{ type: 'phaseSet', phase: 'combat' }]) },
  nextTurn: { expect: (r) => expect(drafts(r)).toEqual([{ type: 'turnPass', to: 's1' }]) },
  untapAll: { expect: (r) => expect(drafts(r)).toEqual([{ type: 'tap', card: 'bf2', tapped: false }]) },
  autoPass: { expect: (r) => expect(drafts(r)).toEqual([{ type: 'autoPass', on: true }]) },
  // Confirm
  ask: { expect: (r) => expect(drafts(r)).toEqual([{ type: 'ask', round: 'r1' }]) },
  confirmOk: { setup: { confirm: promptByBen, hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'respond', round: 'r9', seat: 's0', response: 'ok' }]) },
  confirmHold: { setup: { confirm: promptByBen, hovered: 'bf1' }, expect: (r) => expect(drafts(r)).toEqual([{ type: 'respond', round: 'r9', seat: 's0', response: 'hold' }]) },
  // Table
  tidy: {
    expect: (r) => {
      const d = drafts(r);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ type: 'tidy', seat: 's0' });
      expect(Object.keys((d[0] as { poses: object }).poses).sort()).toEqual(['bf1', 'bf2', 'dfc', 'fd1']);
    },
  },
  token: { setup: { hovered: 'bf2' }, expect: (r) => expect(r.ui).toEqual([{ hook: 'openTokenSearch', args: ['bf2'] }]) },
  rollDie: {
    expect: async (r) => {
      await flush();
      const d = drafts(r);
      expect(d.map((a) => a.type)).toEqual(['rngCommit', 'rngReveal']);
      expect(d[0]).toMatchObject({ purpose: 'die', n: 6 });
      expect(d[1]).toMatchObject({ rid: (d[0] as { rid: string }).rid });
    },
  },
  flipCoin: {
    expect: async (r) => {
      await flush();
      expect(drafts(r)[0]).toMatchObject({ type: 'rngCommit', purpose: 'coin', n: 2 });
    },
  },
  undo: { expect: (r) => expect(r.session.calls).toEqual([{ method: 'undo', args: [] }]) },
  // Talk
  talk: { hold: true, expect: (r) => expect(r.ui).toEqual([{ hook: 'voice', args: ['talk', 'start'] }]), after: (r) => expect(r.ui.at(-1)).toEqual({ hook: 'voice', args: ['talk', 'end'] }) },
  teamTalk: { hold: true, expect: (r) => expect(r.ui).toEqual([{ hook: 'voice', args: ['teamTalk', 'start'] }]), after: (r) => expect(r.ui.at(-1)).toEqual({ hook: 'voice', args: ['teamTalk', 'end'] }) },
  mute: { expect: (r) => expect(r.ui).toEqual([{ hook: 'voice', args: ['mute', 'start'] }]) },
  focusChat: { expect: (r) => expect(r.ui).toEqual([{ hook: 'focusChat', args: [] }]) },
  // View
  perspective: { expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.setRig', args: ['ego'] }]) },
  fitTable: { expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.fit', args: [true] }]) },
  seat1: { expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.goToSeat', args: ['s0'] }]) },
  seat2: { expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.goToSeat', args: ['s1'] }]) },
  seat3: { setup: { names: ['Anna', 'Ben', 'Cleo'] }, expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.goToSeat', args: ['s2'] }]) },
  seat4: { setup: { names: ['Anna', 'Ben', 'Cleo', 'Dag'] }, expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.goToSeat', args: ['s3'] }]) },
  ownSide: { expect: (r) => expect(r.scene.calls).toEqual([{ method: 'camera.goToSeat', args: ['s0'] }]) },
  help: { expect: (r) => expect(r.ui).toEqual([{ hook: 'toggleCheatSheet', args: [] }]) },
};

describe('canonical keymap: every binding dispatches its action (PLAN M0-P4)', () => {
  it('has a scenario for every action of the keymap', () => {
    expect(new Set(MTG_KEYMAP.map((b) => b.action))).toEqual(new Set(Object.keys(S)));
  });

  const name = (b: KeyBinding) => `${chordToString(b.chord)} → ${b.action}${b.context === 'prompt' ? ' (prompt showing)' : ''}`;
  for (const b of MTG_KEYMAP) {
    it(name(b), async () => {
      const sc = S[b.action];
      const r = rig(sc.setup);
      if (b.trigger === 'double') {
        expect(r.press(b.chord)).toBe(true);
        expect(r.session.dispatched).toEqual([]);
        r.clock.t += 200;
      }
      if (sc.hold) {
        expect(r.down(b.chord)).toBe(true);
        await sc.expect(r);
        r.up(b.chord);
        sc.after?.(r);
      } else {
        expect(r.press(b.chord)).toBe(true);
        await sc.expect(r);
      }
      // Every dispatched action is stamped by the local seat (CLAUDE.md: the session stamps by, cid and seq).
      for (const a of r.session.dispatched) expect(a.by).toBe('s0');
    });
  }
});

describe('hover plus key (DESIGN "Input and interaction design")', () => {
  it('acts on the hovered card only, not on a selection it is not part of', () => {
    const r = rig({ hovered: 'bf1', selection: ['dfc', 'fd1'] });
    r.press({ key: 't' });
    expect(drafts(r)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);
  });

  it('acts on the whole selection, as one group, when the hovered card is selected', () => {
    const r = rig({ hovered: 'bf1', selection: ['bf1', 'dfc'] });
    r.press({ key: 'g' });
    const acts = r.session.dispatched;
    expect(acts.map((a) => a.type === 'move' && a.card)).toEqual(['bf1', 'dfc']);
    expect(acts[0]!.group).toBeTruthy();
    expect(acts[1]!.group).toBe(acts[0]!.group);
  });

  it('acts on the selection when nothing is hovered', () => {
    const r = rig({ selection: ['bf1', 'dfc'] });
    r.press({ key: 'a' });
    expect(drafts(r).map((a) => [a.type, a.card])).toEqual([
      ['moveTemp', 'bf1'],
      ['moveTemp', 'dfc'],
    ]);
  });

  it('a single card action carries no group', () => {
    const r = rig({ hovered: 'bf1' });
    r.press({ key: 't' });
    expect(r.session.dispatched[0]!.group).toBeUndefined();
  });

  it('does nothing for card keys when no card is hovered or selected', () => {
    const r = rig();
    for (const key of ['t', 'f', 'g', 'e', 'h', 'c', 'x', 'n', 'a', 'q']) r.press({ key });
    expect(r.session.dispatched).toEqual([]);
    expect(r.ui).toEqual([]);
  });

  it('tapping a mixed selection taps the untapped cards; a fully tapped selection untaps', () => {
    const r = rig({ selection: ['bf1', 'bf2'] });
    r.press({ key: 't' });
    expect(drafts(r).map((a) => [a.card, a.tapped])).toEqual([['bf1', true]]);
    r.press({ key: 't' });
    expect(drafts(r).slice(1).map((a) => [a.card, a.tapped])).toEqual([
      ['bf1', false],
      ['bf2', false],
    ]);
  });

  it('flipping a face-down card turns it up', () => {
    const r = rig({ hovered: 'fd1' });
    r.press({ key: 'f' });
    expect(drafts(r)).toEqual([{ type: 'flip', card: 'fd1', face: 'up' }]);
  });

  it('transform needs a double-faced card', () => {
    const r = rig({ hovered: 'bf1' });
    r.press({ key: 'f', shift: true });
    expect(r.session.dispatched).toEqual([]);
  });

  it('− removes another counter kind when the card has no +1/+1 counters, and nothing when it has none', () => {
    const r = rig({ hovered: 'bf1', cards: [{ id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear', counters: { loyalty: 3 } }, { id: 'bf3', zone: 'battlefield:s0', sid: 'sid-bear' }] });
    r.press({ key: '-' });
    expect(drafts(r)).toEqual([{ type: 'counter', card: 'bf1', kind: 'loyalty', delta: -1 }]);
    r.view.hovered = 'bf3';
    r.press({ key: '-' });
    expect(r.session.dispatched).toHaveLength(1);
  });

  it('G and E send a card to its owner\'s graveyard and exile, also an opponent\'s card', () => {
    const r = rig({ hovered: 'opp1' });
    r.press({ key: 'g' });
    expect(drafts(r)).toEqual([{ type: 'move', card: 'opp1', to: 'graveyard:s1' }]);
  });

  it('cannot touch another player\'s hidden hand card', () => {
    const r = rig({ hovered: 'opph' });
    for (const key of ['g', 'e', 'c', 'w', 'l']) r.press({ key });
    expect(r.session.dispatched).toEqual([]);
    expect(r.ui).toEqual([]);
  });

  it('attack moves the opponent\'s creature toward the centre from its own side (seat at 180°)', () => {
    const r = rig({ hovered: 'opp1' });
    r.press({ key: 'a' });
    expect(drafts(r)).toEqual([{ type: 'moveTemp', card: 'opp1', pose: { x: 0, y: 190, rot: 180 }, combat: 'attack', tap: true }]);
  });

  it('attack ignores cards that are already attacking and cards outside the battlefield', () => {
    const r = rig({ selection: ['bf1', 'h1'], cards: [{ id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear', home: { x: 0, y: -300, rot: 0 }, combat: 'attack' }, { id: 'h1', zone: 'hand:s0', sid: 'sid-bolt' }] });
    r.press({ key: 'a' });
    expect(r.session.dispatched).toEqual([]);
  });

  it('B settles only the selection when there is one', () => {
    const r = rig({ selection: ['bf1'] });
    r.press({ key: 'b' });
    expect(drafts(r)).toEqual([{ type: 'settle', cards: ['bf1'] }]);
  });

  it('X on a spell on the stack puts a copy marker above it', () => {
    const r = rig({ hovered: 'st1', cards: [{ id: 'st1', zone: 'stack', sid: 'sid-bolt', owner: 's0' }], stack: [{ id: 'si5', kind: 'spell', controller: 's0', card: 'st1' }] });
    r.press({ key: 'x' });
    expect(drafts(r)).toEqual([{ type: 'stackPush', item: 'si1', kind: 'copy', copyOf: 'si5', controller: 's0', round: 'r2' }]);
  });

  it('N on a spell on the stack edits the stack item note', () => {
    const r = rig({ hovered: 'st1', cards: [{ id: 'st1', zone: 'stack', sid: 'sid-bolt', owner: 's0' }], stack: [{ id: 'si5', kind: 'spell', controller: 's0', card: 'st1' }] });
    r.press({ key: 'n' });
    expect(r.ui).toEqual([{ hook: 'openNote', args: [{ item: 'si5' }] }]);
  });

  it('peek on a face-down card this browser may not see is refused and not logged', () => {
    const r = rig({ hovered: 'fdx', cards: [{ id: 'fdx', zone: 'battlefield:s1', face: 'down', owner: 's1' }] });
    r.press({ key: 'f', alt: true });
    expect(r.session.dispatched).toEqual([]);
    expect(r.ui.map((u) => u.hook)).toEqual(['notify']);
  });

  it('cast is not offered for library or battlefield cards; from the graveyard it is (flashback)', () => {
    const r = rig({ hovered: 'lib1' });
    r.press({ key: 'c' });
    r.view.hovered = 'bf1';
    r.press({ key: 'c' });
    expect(r.session.dispatched).toEqual([]);
    r.view.hovered = 'gy1';
    r.press({ key: 'c' });
    expect(drafts(r)).toEqual([{ type: 'stackPush', item: 'si1', kind: 'spell', card: 'gy1', controller: 's0', round: 'r2' }]);
  });

  it('a ping needs a double press within 400 ms', () => {
    const r = rig({ hovered: 'bf1' });
    r.press({ key: 'i' });
    r.clock.t += 600;
    r.press({ key: 'i' });
    expect(r.session.dispatched).toEqual([]);
    r.clock.t += 100;
    r.press({ key: 'i' });
    expect(drafts(r)).toEqual([{ type: 'ping', target: { kind: 'card', id: 'bf1' } }]);
  });
});

describe('stack and turn keys (DESIGN "The effect stack", "Turn flow and confirmation")', () => {
  it('R before everyone passed needs a second press, which resolves with force', () => {
    const r = rig({ names: ['Anna', 'Ben'], stack: [spellOnStack], confirm: { id: 'r1', askedBy: 's0', about: 'si9', durationMs: 5000, startSeq: 0, responses: {} } });
    r.press({ key: 'r' });
    expect(r.session.dispatched).toEqual([]);
    expect(r.ui.map((u) => u.hook)).toEqual(['notify']);
    r.clock.t += 500;
    r.press({ key: 'r' });
    expect(drafts(r)).toEqual([{ type: 'stackResolve', item: 'si9', force: true }]);
  });

  it('R after everyone passed resolves at once', () => {
    const r = rig({ stack: [spellOnStack], confirm: { id: 'r1', askedBy: 's0', about: 'si9', durationMs: 5000, startSeq: 0, responses: { s1: 'timeout' } } });
    r.press({ key: 'r' });
    expect(drafts(r)).toEqual([{ type: 'stackResolve', item: 'si9' }]);
  });

  it('R with an empty stack does nothing', () => {
    const r = rig();
    r.press({ key: 'r' });
    r.press({ key: 'r', shift: true });
    expect(r.session.dispatched).toEqual([]);
  });

  it('Tab at the last step does not wrap; Ctrl+Enter passes the turn and offers untap-and-draw to the new active player', () => {
    const r = rig({ names: ['Anna'] });
    const st = r.session.getState();
    r.session.setState({ ...st, turn: { ...st.turn, phase: 'end' } });
    r.press({ key: 'Tab' });
    expect(r.session.dispatched).toEqual([]);
    r.press({ key: 'Enter', ctrl: true });
    expect(drafts(r)).toEqual([{ type: 'turnPass', to: 's0' }]);
    expect(r.ui.map((u) => u.hook)).toContain('offerUntapDraw');
  });

  it('untap-and-draw untaps everything the player controls and draws one card', () => {
    const r = rig();
    r.commands.untapAndDraw();
    expect(drafts(r)).toEqual([{ type: 'tap', card: 'bf2', tapped: false }]);
    expect(r.session.calls).toEqual([{ method: 'draw', args: [1] }]);
  });

  it('F6 toggles auto-pass off again', () => {
    const r = rig();
    r.press({ key: 'F6' });
    r.press({ key: 'F6' });
    expect(drafts(r)).toEqual([
      { type: 'autoPass', on: true },
      { type: 'autoPass', on: false },
    ]);
  });

  it('Enter while holding the floor releases the hold', () => {
    const r = rig({ confirm: { ...promptByBen, holder: 's0', responses: { s0: 'hold' } } });
    r.press({ key: 'Enter' });
    expect(drafts(r)).toEqual([{ type: 'respond', round: 'r9', seat: 's0', response: 'release' }]);
  });

  it('seat 2 to 4 do nothing when the table has fewer seats', () => {
    const r = rig({ names: ['Anna'] });
    r.press({ key: '2' });
    r.press({ key: '4' });
    expect(r.scene.calls).toEqual([]);
  });

  it('Ctrl+Z with nothing to undo says so', () => {
    const r = rig();
    r.session.undoResult = false;
    r.press({ key: 'z', ctrl: true });
    expect(r.ui.map((u) => u.hook)).toEqual(['notify']);
  });
});
