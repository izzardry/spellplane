/**
 * PLAN M1-P6: the attribution flash when someone touches another player's card (DESIGN "Decision log", Permissions:
 * anyone may touch any public card, with attribution; the log and the seat-colour flash keep it honest), and the M0-G
 * log findings: the owner's own log names the card it bottoms after a mulligan while peers still see "a card"; a
 * library search reads "searches their library".
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { attributions, cardsMentioned, touchedCards } from '../../../src/core/log';
import type { InstanceId, LogEntry, SecretStore, TableState } from '../../../src/core/types';
import { explain, reduce } from '../../../src/core/reducer/index';
import { logLines } from '../../../src/ui/describe';
import { FakeCardData, tableWith } from '../../../src/ui/fakes';
import { FLASH_HISTORY, LogWatch } from '../../../src/ui/chat/watch';

type Draft = Partial<Action> & { type: Action['type'] };
let cid = 0;
const act = (a: Draft, by = 's0'): Action => ({ by, cid: `x${++cid}`, ...a }) as Action;

const CARDS = [
  { id: 'mine', zone: 'battlefield:s0', sid: 'sid-bear' },
  { id: 'theirs', zone: 'battlefield:s1', sid: 'sid-bear' },
  { id: 'theirs2', zone: 'battlefield:s1', sid: 'sid-land' },
  { id: 'stolen', zone: 'battlefield:s0', sid: 'sid-caller', owner: 's1', controller: 's0' },
  { id: 'lent', zone: 'battlefield:s1', sid: 'sid-dfc', owner: 's0', controller: 's1' },
  { id: 'h1', zone: 'hand:s0', sid: 'sid-bolt' },
  { id: 'h2', zone: 'hand:s0', sid: 'sid-land' },
  { id: 'lib1', zone: 'library:s0', sid: 'sid-dfc' },
  { id: 'opph', zone: 'hand:s1' },
];

describe('attributions (core/log.ts)', () => {
  const { state } = tableWith(['Anna', 'Ben'], CARDS);

  it('touching another player\'s card is attributed to the toucher; own cards are not', () => {
    expect(attributions(act({ type: 'tap', card: 'theirs', tapped: true }), state)).toEqual([{ card: 'theirs', of: 's1', by: 's0' }]);
    expect(attributions(act({ type: 'tap', card: 'mine', tapped: true }), state)).toEqual([]);
    expect(attributions(act({ type: 'tap', card: 'mine', tapped: true }, 's1'), state)).toEqual([{ card: 'mine', of: 's0', by: 's1' }]);
  });

  it('whose card it is follows its controller: a stolen card is its new controller\'s to use, taking it back is touching theirs', () => {
    expect(attributions(act({ type: 'tap', card: 'stolen', tapped: true }), state)).toEqual([]);
    expect(attributions(act({ type: 'move', card: 'stolen', to: 'battlefield:s1' }, 's1'), state)).toEqual([{ card: 'stolen', of: 's0', by: 's1' }]);
    expect(attributions(act({ type: 'move', card: 'lent', to: 'battlefield:s0' }), state)).toEqual([{ card: 'lent', of: 's1', by: 's0' }]);
  });

  it('every action that changes a card counts; pointing, lines, copies and abilities only refer to it', () => {
    const changes: Draft[] = [
      { type: 'move', card: 'theirs', to: 'graveyard:s1' },
      { type: 'moveTemp', card: 'theirs', pose: { x: 0, y: 0, rot: 0 } },
      { type: 'flip', card: 'theirs', face: 'down' },
      { type: 'transform', card: 'theirs', faceIndex: 1 },
      { type: 'rotate', card: 'theirs', delta: 180 },
      { type: 'counter', card: 'theirs', kind: '+1/+1', delta: 1 },
      { type: 'note', card: 'theirs', text: 'x' },
      { type: 'attach', card: 'theirs', to: 'mine' },
      { type: 'detach', card: 'theirs' },
      { type: 'pile', card: 'theirs', pile: null },
      { type: 'toZone', card: 'theirs', to: 'library:s1', position: 'top' },
      { type: 'remove', card: 'theirs' },
      { type: 'hide', card: 'theirs' },
      { type: 'settle', cards: ['theirs'] },
      { type: 'tidy', seat: 's1', poses: { theirs: { x: 0, y: 0, rot: 0 } } },
      { type: 'stackPush', item: 'i', kind: 'spell', card: 'theirs' },
      { type: 'lookAt', zone: 'battlefield:s1', count: 1, card: 'theirs' },
    ];
    for (const d of changes) expect(attributions(act(d), state).map((a) => a.card), d.type).toEqual(['theirs']);
    const refers: Draft[] = [
      { type: 'ping', target: { kind: 'card', id: 'theirs' } },
      { type: 'lineAdd', line: 'l', kind: 'target', from: { kind: 'card', id: 'mine' }, to: { kind: 'card', id: 'theirs' } },
      { type: 'copy', card: 'tok', of: 'theirs', pose: { x: 0, y: 0, rot: 0 } },
      { type: 'stackPush', item: 'i', kind: 'ability', source: 'theirs' },
      { type: 'attach', card: 'mine', to: 'theirs' },
      { type: 'settle' },
      { type: 'chat', text: '[[theirs]]', channel: 'table' },
    ];
    for (const d of refers) expect(attributions(act(d), state), d.type).toEqual([]);
  });

  it('an undo is attributed like the action it reverts; each card once, in action order', () => {
    const inverse = { type: 'tap', by: 's0', cid: 'i', card: 'theirs', tapped: false } as const;
    expect(attributions(act({ type: 'undo', of: 'x', inverse }), state)).toEqual([{ card: 'theirs', of: 's1', by: 's0' }]);
    expect(touchedCards(act({ type: 'settle', cards: ['theirs', 'theirs2', 'theirs'] }))).toEqual(['theirs', 'theirs2', 'theirs']);
    expect(attributions(act({ type: 'settle', cards: ['theirs', 'theirs2', 'theirs', 'mine'] }), state).map((a) => a.card)).toEqual(['theirs', 'theirs2']);
  });

  it('a card the action created or removed is looked up in the other state', () => {
    const after = structuredClone(state);
    delete after.cards.theirs;
    expect(attributions(act({ type: 'remove', card: 'theirs' }), state, after)).toEqual([{ card: 'theirs', of: 's1', by: 's0' }]);
    expect(attributions(act({ type: 'remove', card: 'theirs' }), after, state)).toEqual([{ card: 'theirs', of: 's1', by: 's0' }]);
    expect(attributions(act({ type: 'remove', card: 'gone' }), state)).toEqual([]);
  });

  it('cardsMentioned lists every card an action names, touched or only referred to', () => {
    expect(cardsMentioned(act({ type: 'attach', card: 'mine', to: 'theirs' }), state)).toEqual(['mine', 'theirs']);
    expect(cardsMentioned(act({ type: 'ping', target: { kind: 'card', id: 'theirs' } }), state)).toEqual(['theirs']);
    expect(cardsMentioned(act({ type: 'toZone', card: 'h1', to: 'library:s0', position: 'bottom' }), state)).toEqual(['h1']);
    expect(cardsMentioned(act({ type: 'phaseSet', phase: 'main1' }), state)).toEqual([]);
  });
});

/** The HUD's view of a state: what this browser may name (ui/Hud.svelte refOf: public, own hand, own face-down, received; never a library face). */
function viewer(state: TableState, secrets: SecretStore, me: string) {
  const data = new FakeCardData();
  return (id: InstanceId): string | null => {
    const c = state.cards[id];
    if (!c) return null;
    let ref = c.identity ?? null;
    if (!ref && !c.zone.startsWith('library')) ref = (c.owner === me ? secrets.identities[id]?.card : undefined) ?? secrets.received[id]?.card ?? null;
    return ref ? (data.peek(ref.sid)?.name ?? 'Card') : null;
  };
}

/** One browser's HUD: applies actions through the reducer, lets the watch observe, describes the log like the HUD. */
function hud(me: string, start: TableState, secrets: SecretStore) {
  let st = structuredClone(start);
  const log: LogEntry[] = [];
  const watch = new LogWatch(() => 1234);
  watch.start(log);
  const self = {
    watch,
    apply(a: Action) {
      const stamped = { ...a, seq: st.seq + 1 } as Action;
      const why = explain(st, stamped);
      if (why) throw new Error(`refused ${a.type}: ${why}`);
      const next = reduce(st, stamped);
      log.push({ kind: 'action', seq: next.seq, at: 0, action: stamped });
      watch.observe(log, st, next, viewer(st, secrets, me));
      st = next;
      // The HUD describes the log on every update, which freezes each line's names (ui/describe.ts).
      self.lines();
    },
    lines() {
      const name = viewer(st, secrets, me);
      return logLines(log, { state: st, cardName: name, phaseLabel: (p) => p, names: watch.names }).map((l) => `${l.actor} ${l.segs.map((s) => ('card' in s ? s.name : s.text)).join('')}`);
    },
  };
  return self;
}

describe('the log names what this browser knew (M0-G findings)', () => {
  const both = () => {
    const anna = tableWith(['Anna', 'Ben'], CARDS, 's0');
    const ben = tableWith(['Anna', 'Ben'], CARDS, 's1');
    return { anna: hud('s0', anna.state, anna.secrets), ben: hud('s1', ben.state, ben.secrets) };
  };

  it('the owner\'s own log names the card it puts from its hand on the bottom of its library; the peer reads "a card"', () => {
    const { anna, ben } = both();
    const bottom = act({ type: 'toZone', card: 'h1', to: 'library:s0', position: 'bottom' });
    anna.apply(bottom);
    ben.apply(bottom);
    expect(anna.lines()).toEqual(['Anna puts Spark Jolt on the bottom of their library']);
    expect(ben.lines()).toEqual(['Anna puts a card on the bottom of their library']);
  });

  it('a public card bounced into a hand keeps its name for everyone; a card moved inside hidden zones is never named for the peer', () => {
    const { anna, ben } = both();
    const bounce = act({ type: 'toZone', card: 'theirs', to: 'hand:s1', position: 'any' });
    const handToLib = act({ type: 'toZone', card: 'h2', to: 'library:s0', position: 'top' });
    for (const a of [bounce, handToLib]) {
      anna.apply(a);
      ben.apply(a);
    }
    expect(anna.lines()).toEqual(["Anna puts Test Bear into Ben's hand", 'Anna puts Verdant Field on the top of their library']);
    expect(ben.lines()).toEqual(["Anna puts Test Bear into Ben's hand", 'Anna puts a card on the top of their library']);
  });

  it('a library card is never named from the owner\'s secrets: a peek, a library move or a draw stays unnamed', () => {
    const { anna } = both();
    anna.apply(act({ type: 'lookAt', zone: 'library:s0', count: 1, card: 'lib1' }));
    anna.apply(act({ type: 'toZone', card: 'lib1', to: 'library:s0', position: 'bottom' }));
    anna.apply(act({ type: 'draw', instanceId: 'lib1' }));
    expect(anna.lines()).toEqual(['Anna peeks at a card', 'Anna puts a card on the bottom of their library', 'Anna draws a card']);
  });

  it('a look at the whole library reads "searches their library"; a look at the top N stays as it was, also later', () => {
    const { anna, ben } = both();
    const search = act({ type: 'lookAt', zone: 'library:s0', count: 1 });
    anna.apply(search);
    ben.apply(search);
    expect(anna.lines()).toEqual(['Anna searches their library']);
    expect(ben.lines()).toEqual(['Anna searches their library']);
    // Two more cards go into the library: the old line keeps its word, a new top-1 look is a look.
    anna.apply(act({ type: 'toZone', card: 'h1', to: 'library:s0', position: 'top' }));
    anna.apply(act({ type: 'toZone', card: 'h2', to: 'library:s0', position: 'top' }));
    anna.apply(act({ type: 'lookAt', zone: 'library:s0', count: 1 }));
    expect(anna.lines()[0]).toBe('Anna searches their library');
    expect(anna.lines().at(-1)).toBe('Anna looks at the top 1 card of their library');
  });

  it('a search of another seat\'s library names that seat', () => {
    const { state } = tableWith(['Anna', 'Ben'], [{ id: 'olib', zone: 'library:s1' }, { id: 'olib2', zone: 'library:s1' }]);
    const lines = logLines([{ kind: 'action', seq: 1, at: 0, action: act({ type: 'lookAt', zone: 'library:s1', count: 2 }) }], { state, cardName: () => null, phaseLabel: (p) => p });
    expect(lines[0]!.segs.map((s) => ('card' in s ? s.name : s.text)).join('')).toBe("searches Ben's library");
  });
});

describe('attribution flashes as the log grows (ui/chat/watch.ts)', () => {
  it('flashes on every browser when someone touches another player\'s card, with seq and cid', () => {
    const anna = tableWith(['Anna', 'Ben'], CARDS, 's0');
    const ben = tableWith(['Anna', 'Ben'], CARDS, 's1');
    const a = hud('s0', anna.state, anna.secrets);
    const b = hud('s1', ben.state, ben.secrets);
    const seen: string[] = [];
    b.watch.onFlash((f) => seen.push(`${f.by}->${f.card}`));
    const touch = act({ type: 'counter', card: 'theirs', kind: '+1/+1', delta: 1 });
    const own = act({ type: 'tap', card: 'mine', tapped: true });
    for (const x of [touch, own]) {
      a.apply(x);
      b.apply(x);
    }
    expect(seen).toEqual(['s0->theirs']);
    for (const w of [a.watch, b.watch]) expect(w.flashes()).toEqual([{ id: 'f1', card: 'theirs', of: 's1', by: 's0', seq: 1, cid: touch.cid, at: 1234 }]);
  });

  it('entries already in the log when the HUD mounts never flash; a shorter log after a rollback flashes nothing twice', () => {
    const { state } = tableWith(['Anna', 'Ben'], CARDS);
    const w = new LogWatch(() => 0);
    const old: LogEntry = { kind: 'action', seq: 1, at: 0, action: act({ type: 'tap', card: 'theirs', tapped: true }) };
    w.start([old]);
    expect(w.observe([old], state, state, () => null)).toEqual([]);
    const next: LogEntry = { kind: 'action', seq: 2, at: 0, action: act({ type: 'tap', card: 'theirs2', tapped: true }) };
    expect(w.observe([old, next], state, state, () => null).map((f) => f.card)).toEqual(['theirs2']);
    expect(w.observe([old], state, state, () => null)).toEqual([]);
    expect(w.observe([old, next], state, state, () => null).map((f) => f.card)).toEqual(['theirs2']);
  });

  it('keeps the last FLASH_HISTORY flashes', () => {
    const { state } = tableWith(['Anna', 'Ben'], CARDS);
    const w = new LogWatch(() => 0);
    const log: LogEntry[] = [];
    for (let i = 1; i <= FLASH_HISTORY + 5; i++) {
      log.push({ kind: 'action', seq: i, at: 0, action: act({ type: 'tap', card: 'theirs', tapped: i % 2 === 1 }) });
      w.observe(log, state, state, () => null);
    }
    expect(w.flashes()).toHaveLength(FLASH_HISTORY);
    expect(w.flashes()[0]!.seq).toBe(6);
  });
});
