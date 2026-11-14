/**
 * PLAN Milestone 5, owner decisions, Installable on iPad: a saved table exported to a file and imported again brings
 * its player back to the chair (Safari deletes a site's storage after 7 days without a visit). Real networked sessions
 * (session/net.ts) on a LoopbackNetwork under fake timers, each browser with its own fake IndexedDB
 * (tests/sim/session/harness.ts).
 *
 * Also the backup's scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its
 * scenario): the file B exports holds B's own hidden cards (it is B's copy) and none of A's — scanned with the shared
 * scanner against A's state and secret store and what A deliberately showed B.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceId } from '../../../src/core/types';
import { backupText, exportBackup, readBackupText, restoreBackup } from '../../../src/store/backup';
import { generateIdentity } from '../../../src/store/identity';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { handHash, libraryHash } from '../../sim/resume/helpers';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, hashOf, net, open, settle, trackDisclosures, typeOf, until, waitConverged, type Browser, type NetTable } from '../../sim/session/harness';

vi.mock('../../../src/net/identity', async () => (await import('../../sim/net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const isLand = (sid: string): boolean => /\bLand\b/.test(typeOf(sid));

function playLand(s: NetTable, seat: 's0' | 's1', y: number): InstanceId {
  const sec = s.secrets();
  const land = sec.hand.find((id) => isLand(sec.identities[id]!.card.sid)) ?? sec.hand[0]!;
  s.dispatch({ type: 'move', card: land, to: `battlefield:${seat}`, pose: { x: 0, y, rot: 0 } });
  return land;
}

describe('backup of a networked table', () => {
  it('B exports mid-game, loses all storage, restores the file and returns to its chair with the same hand; the file holds none of A’s hidden cards', async () => {
    const network = net({ seed: 23, delay: { min: 0, max: 80 } });
    // B's real key pair: the file carries it, and the restored browser reclaims the chair with it.
    const ben = await settle(generateIdentity());
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', ben.peerId, 'Ben', 5);
    browsers.push(A, B);
    await settle(B.stores.db.put('identity', { ...ben, nickname: 'Ben', seatColour: 5 }));

    const a = await open(network, A);
    const b = await open(network, B);
    await waitConverged([a, b], 'both seated');
    const shownToB = trackDisclosures(a, 's1');
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'A ready');
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'B ready');
    await settle(Promise.all([a.shuffle(), b.shuffle()]), 60_000, 'both shuffles');
    await settle(a.draw(7));
    await settle(b.draw(7));
    const aLand = playLand(a, 's0', -200);
    playLand(b, 's1', 200);
    await until(() => a.engine.confirmedState().cards[aLand]?.identity !== undefined, 20_000, 'A’s land to be turned up');
    await waitConverged([a, b], 'the opening');
    await settle(Promise.all([a.whenSaved(), b.whenSaved()]));
    const before = { seat: b.seat, hand: handHash(b), library: libraryHash(b), handSize: b.secrets().hand.length };
    expect(before.handSize).toBe(6);

    const file = await settle(exportBackup(B.stores, { decks: true, tables: 'all', settings: true }, Date.now()));
    expect(file.identity?.peerId).toBe(ben.peerId);
    const saved = file.tables.find((t) => t.table.roomKey !== '')!;
    expect(saved.secrets).toEqual(b.secrets());

    // The leak scenario: everything in B's file against A's hidden cards (A showed B only its land).
    const toB = { observed: [file, backupText(file)], owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: shownToB };
    expect(shownToB.map((d) => d.instanceId)).toEqual([aLand]);
    expect(forbiddenFor(toB).tokens.length).toBeGreaterThan(40);
    expect(leakScan(toB)).toEqual({ tokens: [], pairs: [] });

    // Safari wipes B's storage; A plays on meanwhile.
    b.leave();
    B.session = null;
    a.chat('are you there?');
    await waitConverged([a], 'A alone');
    const B2 = await browser('ben-restored', ben.peerId, 'Ben', 5);
    browsers.push(B2);
    const data = readBackupText(backupText(file));
    expect(data.errors).toEqual([]);
    expect(await settle(restoreBackup(B2.stores, data, { replaceIdentity: true, overwrite: false }))).toEqual({ errors: [] });
    expect((await settle(B2.stores.db.get('identity', 'me')))?.peerId).toBe(ben.peerId);

    const back = await open(network, B2, { settleMs: 200 });
    await waitConverged([a, back], 'the restored rejoin');
    expect(back.seat).toBe(before.seat);
    expect(handHash(back)).toBe(before.hand);
    expect(libraryHash(back)).toBe(before.library);
    expect(hashOf(back.engine.confirmedState())).toBe(hashOf(a.engine.confirmedState()));
    // It plays on from the restored library: a draw takes the top card the file remembered.
    const top = back.secrets().libraryOrder[0]!;
    await settle(back.draw(1));
    await waitConverged([a, back], 'the draw');
    expect(back.secrets().hand).toContain(top);
  });
});
