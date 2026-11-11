/**
 * The session's private effects and reveal paths (PLAN M0-P7; DESIGN "Table model" Hidden cards, "Card manipulation"
 * Library actions, "Multiplayer architecture" Private looks, "Specification: network protocol and secrecy").
 */
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import type { Action } from '../../../src/core/actions';
import type { HiddenZone, ReorderRecord } from '../../../src/core/types';
import { privateFaces } from '../../../src/session/index';
import { json, withDeck } from './helpers';

const LIB = 'library:s0';
const HAND = 'hand:s0';
const BF = 'battlefield:s0';

function actions(log: ReturnType<Awaited<ReturnType<typeof withDeck>>['log']>): Action[] {
  return log.flatMap((e) => (e.kind === 'action' ? [e.action] : []));
}

describe('reveal when a card becomes public', () => {
  it('playing a hand card publishes its identity with ref and salt first, and the reveal matches the commitment', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    const { card, salt } = s.secrets().identities[id]!;
    const n = s.log().length;
    s.dispatch({ type: 'move', card: id, to: BF, pose: { x: 0, y: 120, rot: 0 } });
    const added = actions(s.log().slice(n));
    expect(added.map((a) => a.type)).toEqual(['reveal', 'move']);
    expect(added[0]).toMatchObject({ type: 'reveal', instanceId: id, ref: card, salt });
    const c = s.getState().cards[id]!;
    expect(c.zone).toBe(BF);
    expect(c.face).toBe('up');
    expect(c.identity).toEqual(card);
    expect(s.secrets().hand).toEqual([]);
    expect(s.getState().commitments.s0!.commits).toContain(await sha256(`${id}|${card.sid}|${card.foil ? 'f' : 'n'}|${salt}`));
    expect(checkInvariants(s.getState())).toEqual([]);
  });

  it('casting a hand card onto the stack reveals it', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    s.dispatch({ type: 'stackPush', item: 'si1', kind: 'spell', card: id, controller: 's0' });
    expect(s.getState().cards[id]!.zone).toBe('stack');
    expect(s.getState().cards[id]!.identity).toEqual(s.secrets().identities[id]!.card);
    expect(s.getState().stack.map((i) => i.id)).toEqual(['si1']);
  });

  it('milling the top library card reveals it in the graveyard and removes it from the private order', async () => {
    const s = await withDeck();
    await s.shuffle();
    const top = s.secrets().libraryOrder[0]!;
    s.dispatch({ type: 'move', card: top, to: 'graveyard:s0' });
    expect(s.getState().cards[top]!.identity).toEqual(s.secrets().identities[top]!.card);
    expect(s.secrets().libraryOrder).not.toContain(top);
    expect(s.secrets().libraryOrder).toHaveLength(59);
  });

  it('turning an own face-down card up reveals it; turning it down again keeps it public', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    s.dispatch({ type: 'move', card: id, to: BF, pose: { x: 0, y: 120, rot: 0 } });
    s.dispatch({ type: 'flip', card: id, face: 'down' });
    expect(s.getState().cards[id]!.face).toBe('down');
    s.dispatch({ type: 'flip', card: id, face: 'up' });
    expect(s.getState().cards[id]!.face).toBe('up');
  });

  it('turning up an own face-down card whose identity is hidden emits the reveal first', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    s.dispatch({ type: 'move', card: id, to: BF, pose: { x: 0, y: 120, rot: 0 } });
    s.dispatch({ type: 'hide', card: id });
    expect(s.getState().cards[id]!.identity).toBeUndefined();
    const n = s.log().length;
    s.dispatch({ type: 'flip', card: id, face: 'up' });
    expect(actions(s.log().slice(n)).map((a) => a.type)).toEqual(['reveal', 'flip']);
    expect(s.getState().cards[id]!).toMatchObject({ face: 'up', identity: s.secrets().identities[id]!.card });
    // Tapping a face-down card does not reveal it.
    s.dispatch({ type: 'hide', card: id });
    const m = s.log().length;
    s.dispatch({ type: 'tap', card: id, tapped: true });
    expect(actions(s.log().slice(m)).map((a) => a.type)).toEqual(['tap']);
    expect(s.getState().cards[id]!.identity).toBeUndefined();
  });

  it('a refused action publishes nothing: no reveal, no seq, a warning in the log', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    const sid = s.secrets().identities[id]!.card.sid;
    const before = json(s.getState());
    const n = s.log().length;
    s.dispatch({ type: 'move', card: id, to: 'nowhere:s0' });
    s.dispatch({ type: 'attach', card: id, to: 'missing' });
    expect(json(s.getState())).toBe(before);
    expect(actions(s.log().slice(n))).toEqual([]);
    expect(json(s.log())).not.toContain(sid);
    expect(s.log().at(-1)).toMatchObject({ kind: 'system', level: 'warn' });
  });

  it('moving a card between hidden zones never reveals it', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    const sid = s.secrets().identities[id]!.card.sid;
    s.dispatch({ type: 'toZone', card: id, to: LIB, position: 'bottom' });
    expect(s.secrets().libraryOrder.at(-1)).toBe(id);
    expect(s.secrets().hand).toEqual([]);
    expect(json(s.getState())).not.toContain(sid);
    expect(json(s.log())).not.toContain(sid);
  });

  it('refuses private-effect actions sent through dispatch', async () => {
    const s = await withDeck();
    await s.draw(7);
    const before = json(s.getState());
    s.dispatch({ type: 'mulligan', count: 1 });
    s.dispatch({ type: 'reorder', zone: LIB, count: 1, orderHash: 'x' });
    s.dispatch({ type: 'ready', commits: [], instanceIds: [], zone: LIB });
    expect(json(s.getState())).toBe(before);
    expect(s.secrets().hand).toHaveLength(7);
  });
});

describe('face-down placement', () => {
  it('puts a hand card onto the battlefield face down without publishing its identity; the owner still sees it', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    const { sid } = s.secrets().identities[id]!.card;
    const { salt } = s.secrets().identities[id]!;
    const n = s.log().length;
    const done = s.playFaceDown(id, BF, { x: 20, y: 100, rot: 0 });
    expect(done.seq).toBe(s.getState().seq);
    expect(actions(s.log().slice(n)).map((a) => a.type)).toEqual(['move']);
    expect(s.getState().cards[id]).toMatchObject({ zone: BF, face: 'down' });
    expect(s.getState().cards[id]!.identity).toBeUndefined();
    expect(json(s.getState())).not.toContain(sid);
    expect(json(s.log())).not.toContain(salt);
    expect(privateFaces(s.getState(), s.secrets())[id]).toEqual(s.secrets().identities[id]!.card);
    // Turning it face up reveals it then.
    s.dispatch({ type: 'flip', card: id, face: 'up' });
    expect(actions(s.log().slice(n + 1)).map((a) => a.type)).toEqual(['reveal', 'flip']);
    expect(s.getState().cards[id]!.identity).toEqual(s.secrets().identities[id]!.card);
  });

  it('exiles the top library card face down and can be undone back to the top', async () => {
    const s = await withDeck();
    const order = [...s.secrets().libraryOrder];
    s.playFaceDown(order[0]!, 'exile:s0');
    expect(s.getState().cards[order[0]!]).toMatchObject({ zone: 'exile:s0', face: 'down' });
    expect(s.getState().cards[order[0]!]!.identity).toBeUndefined();
    expect(s.secrets().libraryOrder).toEqual(order.slice(1));
    expect(s.undo()).toBe(true);
    expect(s.secrets().libraryOrder).toEqual(order);
  });

  it('refuses cards that are not in an own hidden zone and hidden destinations', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    const before = json(s.getState());
    s.playFaceDown(id, LIB);
    s.playFaceDown('missing', BF);
    expect(json(s.getState())).toBe(before);
    expect(s.log().at(-1)).toMatchObject({ kind: 'system', level: 'warn' });
  });
});

describe('cards returning to hidden zones', () => {
  it('a public card put on top of the library loses its public identity and is drawn next', async () => {
    const s = await withDeck();
    await s.draw();
    const id = s.secrets().hand[0]!;
    s.dispatch({ type: 'move', card: id, to: BF, pose: { x: 0, y: 120, rot: 0 } });
    s.dispatch({ type: 'toZone', card: id, to: LIB, position: 'top' });
    expect(s.getState().cards[id]!.identity).toBeUndefined();
    expect(s.secrets().libraryOrder[0]).toBe(id);
    await s.draw();
    expect(s.secrets().hand).toEqual([id]);
  });

  it('a public card returned to the hand is appended to the private hand', async () => {
    const s = await withDeck();
    await s.draw(2);
    const [a, b] = s.secrets().hand;
    s.dispatch({ type: 'move', card: a!, to: BF, pose: { x: 0, y: 120, rot: 0 } });
    s.dispatch({ type: 'toZone', card: a!, to: HAND, position: 'any' });
    expect(s.secrets().hand).toEqual([b, a]);
  });
});

describe('private reorder (scry)', () => {
  it('putting a looked-at card at the bottom is a private reorder with a public trace and an audit record', async () => {
    const s = await withDeck();
    await s.shuffle();
    const order = [...s.secrets().libraryOrder];
    const looked = await s.lookAt(LIB, 2);
    const before = json({ ...s.getState(), seq: 0 });
    s.dispatch({ type: 'toZone', card: looked[0]!.id, to: LIB, position: 'bottom' });
    expect(s.secrets().libraryOrder).toEqual([...order.slice(1), order[0]]);
    expect(json({ ...s.getState(), seq: 0 })).toBe(before);
    const last = actions(s.log()).at(-1)!;
    expect(last).toMatchObject({ type: 'reorder', zone: LIB, count: 1 });
    expect(json(last)).not.toContain(looked[0]!.id);
    const rec = s.secrets().audit.at(-1) as ReorderRecord;
    expect(rec).toMatchObject({ kind: 'reorder', zone: LIB, count: 1, order: s.secrets().libraryOrder });
    expect(last.type === 'reorder' && last.orderHash).toBe(await sha256(`${rec.order.join(',')}|${rec.nonce}`));
  });
});

describe('look at', () => {
  it('returns the top n cards with their identities and logs only the fact and the count', async () => {
    const s = await withDeck();
    await s.shuffle();
    const order = [...s.secrets().libraryOrder];
    const before = json({ ...s.getState(), seq: 0 });
    const looked = await s.lookAt(LIB, 3);
    expect(looked.map((l) => l.id)).toEqual(order.slice(0, 3));
    for (const l of looked) expect(l.ref).toEqual(s.secrets().identities[l.id]!.card);
    expect(json({ ...s.getState(), seq: 0 })).toBe(before);
    const last = actions(s.log()).at(-1)!;
    expect(last).toMatchObject({ type: 'lookAt', zone: LIB, count: 3, by: 's0' });
    for (const l of looked) expect(json(s.log())).not.toContain(l.ref.sid);
    expect(s.canUndo()).toBe(false);
  });

  it('clamps to the library size and refuses zones that are not own hidden zones', async () => {
    const s = await withDeck();
    expect(await s.lookAt(LIB, 100)).toHaveLength(60);
    await expect(s.lookAt(BF, 1)).rejects.toThrow();
    await expect(s.lookAt('library:s1', 1)).rejects.toThrow();
  });
});

describe('London mulligan', () => {
  it('shuffles the hand into the library and draws seven; it cannot be undone', async () => {
    const s = await withDeck();
    await s.shuffle();
    await s.draw(7);
    const firstHand = [...s.secrets().hand];
    const n = s.log().length;
    await s.mulligan();
    const added = actions(s.log().slice(n));
    expect(added.map((a) => a.type)).toEqual(['mulligan', 'reorder', ...Array<string>(7).fill('draw')]);
    expect(added[0]).toMatchObject({ type: 'mulligan', count: 1 });
    expect(s.secrets().hand).toHaveLength(7);
    expect((s.getState().zones[HAND] as HiddenZone).count).toBe(7);
    expect((s.getState().zones[LIB] as HiddenZone).count).toBe(53);
    expect(s.secrets().libraryOrder).toHaveLength(53);
    // Every first-hand card went back into the library before the shuffle.
    const shuffle = s.secrets().audit.at(-1)!;
    expect(shuffle.kind).toBe('shuffle');
    for (const id of firstHand) expect(shuffle.order).toContain(id);
    expect(s.canUndo()).toBe(false);
    for (const id of s.secrets().hand) expect(s.getState().cards[id]!.identity).toBeUndefined();

    await s.mulligan();
    expect(actions(s.log()).filter((a) => a.type === 'mulligan').at(-1)).toMatchObject({ count: 2 });
    expect(checkInvariants(s.getState())).toEqual([]);
  });
});

describe('private faces', () => {
  it('shows the owner their hand and own face-down cards, never library cards', async () => {
    const s = await withDeck();
    await s.draw(2);
    const [a, b] = s.secrets().hand;
    s.dispatch({ type: 'move', card: b!, to: BF, pose: { x: 0, y: 120, rot: 0 } });
    s.dispatch({ type: 'hide', card: b! });
    const faces = privateFaces(s.getState(), s.secrets());
    expect(Object.keys(faces).sort()).toEqual([a!, b!].sort());
    expect(faces[a!]).toEqual(s.secrets().identities[a!]!.card);
    for (const id of s.secrets().libraryOrder) expect(faces[id]).toBeUndefined();
  });
});

describe('subscribe and dispose', () => {
  it('notifies listeners after applied actions and undo, and stops after unsubscribe and dispose', async () => {
    const s = await withDeck();
    const seen: number[] = [];
    const off = s.subscribe((st) => seen.push(st.seq));
    await s.draw();
    s.undo();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBe(s.getState().seq);
    off();
    const count = seen.length;
    await s.draw();
    expect(seen).toHaveLength(count);
    s.subscribe(() => seen.push(-1));
    s.dispose();
    s.dispatch({ type: 'life', seat: 's0', delta: 1 });
    expect(seen).toHaveLength(count);
    await expect(s.draw()).rejects.toThrow();
  });

  it('stamps by, a unique cid and consecutive seqs', async () => {
    const s = await withDeck();
    await s.draw(3);
    const acts = actions(s.log());
    expect(new Set(acts.map((a) => a.cid)).size).toBe(acts.length);
    acts.forEach((a, i) => {
      expect(a.by).toBe('s0');
      if (i > 0) expect(a.seq).toBe(acts[i - 1]!.seq! + 1);
    });
    const stamped = s.dispatch({ type: 'life', seat: 's0', delta: -1 });
    expect(stamped).toMatchObject({ by: 's0', seq: s.getState().seq });
  });
});
