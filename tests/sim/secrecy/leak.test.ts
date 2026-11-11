/**
 * The shared leak test (PLAN M1-P2: after a scripted game, no message received by peer B and no field in B's state
 * or stores contains the card id of any card that stayed in A's hand or library; CLAUDE.md: hidden information never
 * leaves its owner's browser except through the design's reveal paths).
 *
 * Two seats on LoopbackNetwork with delay and reordering. The script: deck import (Ready), both shuffle, both draw
 * seven, A mulligans and bottoms one, A scries two, A plays a land, A reveals a hand card to B only, A plays a card
 * face down and peeks at it, A plays a second card face down and turns it up, B looks at A's top card through A,
 * A returns its land to the hand (fresh opaque ids for the hand: the M0-G finding), A searches its library and
 * shuffles, both roll a die, B plays a land. The scanner (tests/leak/leak.ts) then checks every message B received,
 * B's state, B's SecretStore and every record of B's IndexedDB. A negative control without the re-issue shows the
 * scanner catches the link it is there to catch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceId, TableState } from '../../../src/core/types';
import { STORE_NAMES } from '../../../src/store/db';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { fixtureDeck, netTable, testEntropy, type NetTable } from '../../leak/fixtures';
import { privateReorder } from '../../../src/core/secrets';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { until, type Player } from '../../leak/minitable';
import type { RevealedCard } from '../../../src/core/commit';

beforeEach(() => {
  // fake-indexeddb completes its requests with setImmediate, which stays real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const ROOM = 'leak-room';
let dbCounter = 0;

/** B persists every sequenced action, its snapshot and its secret store, as the session does (DESIGN "Local persistence"). */
function persist(b: Player, db: LocalStores): Promise<void>[] {
  const writes: Promise<void>[] = [];
  b.peer.onSequenced((a) => {
    const state: TableState = b.state;
    writes.push(
      db.tables.saveAction(
        ROOM,
        { roomId: ROOM, seq: a.seq, action: a, at: 0 },
        { roomId: ROOM, roomKey: 'key', lastSeq: a.seq, snapshot: state, snapshotSeq: a.seq, seat: 's1', stage: state.stage, updatedAt: 0 },
        b.secrets,
      ),
    );
  });
  return writes;
}

async function dump(db: LocalStores): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const name of STORE_NAMES) out.push(...(await db.db.getAll(name)));
  return out;
}

interface Played {
  t: NetTable;
  a: Player;
  b: Player;
  db: LocalStores;
  land: InstanceId;
  shownToB: InstanceId;
  faceDown: InstanceId;
}

async function script(reissueOnReturn: boolean): Promise<Played> {
  const t = await netTable(['Anna', 'Ben'], { seed: 11, delay: { min: 0, max: 120 } });
  await until(() => t.peers.every((p) => p.peers().length === 1), 5_000, 'peers');
  const [a, b] = t.players as [Player, Player];
  a.reissueOnReturn = reissueOnReturn;
  const db = await openStores(`leak-b-${++dbCounter}`);
  const writes = persist(b, db);

  await a.importDeck(await fixtureDeck('gw-m19-60.txt'));
  await b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt'));
  await a.shuffle();
  await b.shuffle();
  await a.draw(7);
  await b.draw(7);
  await a.mulligan(1);
  await a.scry(2);

  const sid = (id: InstanceId): string => a.secrets.identities[id]!.card.sid;
  const isLand = (id: InstanceId): boolean => ['Forest', 'Plains'].some((n) => sid(id).length > 0 && LAND_SIDS.get(n)?.has(sid(id)));
  // Draw until a land is in hand (the fixture deck has 24).
  while (!a.secrets.hand.some(isLand)) await a.draw(1);
  const land = a.secrets.hand.find(isLand)!;
  await a.play(land, { x: 0, y: -200, rot: 0 });

  const nonLands = (): InstanceId[] => a.secrets.hand.filter((id) => !isLand(id));
  while (nonLands().length < 3) await a.draw(1);
  const [shownToB, faceDown, turnedUp] = nonLands();
  await a.revealTo(shownToB!, ['s1']);
  await until(() => Object.hasOwn(b.secrets.received, shownToB!), 5_000, 'B to receive the targeted reveal');
  await a.playFaceDown(faceDown!, { x: 70, y: -200, rot: 0 });
  await a.peek(faceDown!);
  await a.playFaceDown(turnedUp!, { x: 140, y: -200, rot: 0 });
  await a.flipUp(turnedUp!);

  // B looks at A's top card (an effect that allows it): the public lookAt, then A answers B on the pair channel.
  await b.peer.act({ type: 'lookAt', zone: 'library:s0', count: 1 });
  let looked: RevealedCard[] | null = null;
  void b.channel.requestLook('s0', 'library:s0', 1).then((r) => (looked = r));
  await until(() => looked !== null, 5_000, 'the look answer');

  // The M0-G finding: a public card returns to the hand; the hand gets fresh opaque ids.
  await a.returnToHand(land);
  await a.search((ids) => ids[ids.length - 1]!);
  await a.roll(20);
  const bLand = b.secrets.hand.find((id) => /Island|Mountain/.test(B_NAMES.get(b.secrets.identities[id]!.card.sid) ?? '')) ?? b.secrets.hand[0]!;
  await b.play(bLand, { x: 0, y: 200, rot: 180 });
  await a.draw(1);

  await until(() => b.state.seq === a.state.seq, 10_000, 'B to catch up');
  await vi.advanceTimersByTimeAsync(1_000);
  await Promise.all(writes);
  return { t, a, b, db, land, shownToB: shownToB!, faceDown: faceDown! };
}

/** What B could have seen: every delivered message, its own received log, its state, its SecretStore and its IndexedDB. */
async function observedByB(p: Played): Promise<unknown[]> {
  const delivered = p.t.net.delivered.filter((d) => d.to === p.b.peer.peerId).map((d) => d.msg);
  return [...delivered, ...p.b.peer.received.map((r) => r.msg), p.b.state, p.b.secrets, ...(await dump(p.db))];
}

// Names of the fixture lands, to steer the script (Scryfall ids of the fixture printings).
const LAND_SIDS = new Map<string, Set<string>>();
const B_NAMES = new Map<string, string>();

beforeEach(async () => {
  if (LAND_SIDS.size) return;
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const cards = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/scryfall/m19.json', import.meta.url)), 'utf8')) as { id: string; name: string }[];
  for (const c of cards) {
    if (c.name === 'Forest' || c.name === 'Plains') LAND_SIDS.set(c.name, (LAND_SIDS.get(c.name) ?? new Set()).add(c.id));
    B_NAMES.set(c.id, c.name);
  }
});

describe('leak test: a scripted two-seat game', () => {
  it('B never holds the identity, salt or id mapping of a card that stayed hidden in A’s hand or library', async () => {
    const p = await script(true);
    const { a, b } = p;
    const log = b.peer.log();
    // The script exercised every path the test is about.
    const types = new Set(log.map((x) => x.type));
    for (const ty of ['ready', 'shuffleCommit', 'shuffleNonce', 'shuffleDone', 'draw', 'mulligan', 'lookAt', 'reorder', 'reveal', 'revealTo', 'flip', 'toZone', 'rngCommit', 'rngReveal'] as const) {
      expect(types, ty).toContain(ty);
    }
    expect(log.some((x) => x.type === 'reorder' && x.reissue !== undefined && x.zone === 'hand:s0')).toBe(true);
    // Only A's last shuffle re-issues: its library held the card B had looked at. The others keep the Ready ids, so
    // the deck commitment still vouches for every later reveal.
    const reissued = log.flatMap((x) => (x.type === 'shuffleDone' ? [`${x.by}:${x.reissue !== undefined}`] : []));
    expect(reissued).toEqual(['s0:false', 's1:false', 's0:false', 's0:true']);
    // B saw what it was meant to see, and only that.
    expect(b.state.cards[p.faceDown]).toMatchObject({ face: 'down', zone: 'battlefield:s0' });
    expect(b.state.cards[p.faceDown]!.identity).toBeUndefined();
    expect(b.state.cards[p.land]).toBeUndefined();
    expect(b.state.cards[p.shownToB]).toBeUndefined();
    expect(b.secrets.received).toEqual({});

    const observed = await observedByB(p);
    const input = { observed, owner: { state: a.state, secrets: a.secrets }, disclosed: a.disclosed.s1 ?? [] };
    const forbidden = forbiddenFor(input);
    // The scan is not vacuous: it looks for the hidden cards' ids, salts and nonces, and for the re-issue links.
    expect(forbidden.tokens.length).toBeGreaterThan(40);
    expect(forbidden.pairs.filter((x) => x.why === 'relink').length).toBeGreaterThan(40);
    const report = leakScan(input);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    p.db.close();
  });

  it('a look request without its public lookAt, or a peek at a hand card, gets nothing out of A', async () => {
    const p = await script(true);
    const { a, b } = p;
    const handCard = a.secrets.hand[0]!;
    const before = a.disclosed.s1?.length ?? 0;
    // B asks for A's top cards without the logged lookAt, and peeks at a hand card under a lookAt that names it.
    void b.channel.requestLook('s0', 'library:s0', 3);
    await b.peer.act({ type: 'lookAt', zone: 'hand:s0', count: 1, card: handCard });
    let peeked: RevealedCard[] | null = null;
    void b.channel.requestLook('s0', 'hand:s0', 1, handCard).then((r) => (peeked = r));
    b.peer.sendPrivate('s0', { v: 1, t: 'lookReq', lookId: 'raw', zone: 'library:s0', count: 1, card: handCard });
    await until(() => peeked !== null, 5_000, 'the refused peek');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(peeked).toEqual([]);
    expect(a.disclosed.s1?.length ?? 0).toBe(before);
    const report = leakScan({ observed: await observedByB(p), owner: { state: a.state, secrets: a.secrets }, disclosed: a.disclosed.s1 ?? [] });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    p.db.close();
  });

  it('a look answers with the cards at its lookAt: not after A drew them, not after A shuffled', async () => {
    const p = await script(true);
    const { a, b } = p;
    const ask = async (): Promise<RevealedCard[]> => {
      let got: RevealedCard[] | null = null;
      void b.channel.requestLook('s0', 'library:s0', 1).then((r) => (got = r));
      await until(() => got !== null, 5_000, 'the look answer');
      return got!;
    };
    // B's lookAt of A's top card is sequenced; A draws that card before B's request reaches A.
    await b.peer.act({ type: 'lookAt', zone: 'library:s0', count: 1 });
    await a.draw(1);
    expect(await ask()).toEqual([]);
    // B's lookAt is sequenced, A shuffles, and only then B asks: the look does not cover the new order.
    await b.peer.act({ type: 'lookAt', zone: 'library:s0', count: 1 });
    await a.shuffle();
    expect(await ask()).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    const report = leakScan({ observed: await observedByB(p), owner: { state: a.state, secrets: a.secrets }, disclosed: a.disclosed.s1 ?? [] });
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    p.db.close();
  });

  it('a look is not answered from a scry the owner has not had sequenced yet (B owns, A is the sequencer)', async () => {
    const p = await script(true);
    const { a, b } = p;
    const lib = 'library:s1';
    const [y1, y2] = b.secrets.libraryOrder;
    // B scries its top card to the bottom: its store holds the new order at once, its `reorder` is in flight.
    const r = privateReorder(b.secrets, b.state, lib, [...b.secrets.libraryOrder.slice(1), y1!], 1, testEntropy(77));
    b.secrets = r.secrets;
    // A's request may overtake its lookAt (it then waits at B for it), so B binds the look while its scry is pending.
    let got: RevealedCard[] | null = null;
    void a.channel.requestLook('s1', lib, 1).then((x) => (got = x));
    let scried: string | null | undefined;
    void b.peer.propose(b.peer.stamp(r.action)).then((x) => (scried = x));
    // A (the sequencer) logs its look at B's top card first: the look is at y1, never at y2.
    await a.peer.act({ type: 'lookAt', zone: lib, count: 1 });
    await until(() => got !== null, 5_000, 'the look answer');
    expect(got).toEqual([]);
    await until(() => scried !== undefined, 5_000, "B's reorder");
    expect(scried).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    const toA = [...p.t.net.delivered.filter((d) => d.to === a.peer.peerId).map((d) => d.msg), ...a.peer.received.map((x) => x.msg)];
    const report = leakScan({ observed: toA, owner: { state: b.state, secrets: b.secrets }, disclosed: b.disclosed.s0 ?? [] });
    expect(report.tokens.filter((h) => JSON.stringify(h).includes(b.secrets.identities[y2!]!.salt))).toEqual([]);
    expect(JSON.stringify(toA)).not.toContain(b.secrets.identities[y2!]!.salt);
    p.db.close();
  });

  it('negative control: without fresh ids for the hand, the returned land is still linkable and the scanner says so', async () => {
    const p = await script(false);
    const { a } = p;
    expect(a.state.cards[p.land]?.zone).toBe('hand:s0');
    const report = leakScan({ observed: await observedByB(p), owner: { state: a.state, secrets: a.secrets }, disclosed: a.disclosed.s1 ?? [] });
    expect(report.pairs.some((h) => h.why === 'mapping' && h.pair[0] === p.land)).toBe(true);
    p.db.close();
  });

  it('negative control: an identity sent outside the reveal paths is found', async () => {
    const p = await script(true);
    const { a, b } = p;
    const hidden = a.secrets.libraryOrder[5]!;
    const id = a.secrets.identities[hidden]!;
    // A buggy client sends a library card to B as if it were a look answer B never asked for.
    a.peer.sendPrivate('s1', { v: 1, t: 'look', lookId: 'bogus', cards: [{ instanceId: hidden, ref: id.card, salt: id.salt }] });
    await vi.advanceTimersByTimeAsync(500);
    const report = leakScan({ observed: await observedByB(p), owner: { state: a.state, secrets: a.secrets }, disclosed: a.disclosed.s1 ?? [] });
    expect(report.tokens.map((h) => h.token)).toEqual(expect.arrayContaining([id.salt]));
    expect(report.pairs.some((h) => h.why === 'mapping' && h.pair[0] === hidden)).toBe(true);
    expect(b.secrets.received[hidden]).toBeUndefined();
    p.db.close();
  });
});
