/**
 * Leak scenario of the solo session (CLAUDE.md: any code touching hidden information adds its scenario to the shared
 * leak test; PLAN "Quality gates": scan everything a peer could receive and every store for card ids it should not
 * know). In M0 nothing is sent, so the scan covers what milestone 1 will replicate (the shared state and the action
 * log) and every IndexedDB store except `secrets` (DESIGN "Multiplayer architecture": the secret store never leaves
 * this browser).
 *
 * Scenario: import, shuffle, draw seven, mulligan, scry one to the bottom, look at the top two, play a land, cast a
 * spell, return a card to the library, undo, mill one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { closeStores, stores, withDeck } from './helpers';

afterEach(closeStores);

describe('hidden information stays in the secret store', () => {
  it('no identity, salt or nonce of a card that never became public reaches shared state, the log or the shared stores', async () => {
    const db = await stores();
    const s = await withDeck(db);
    await s.shuffle();
    await s.draw(7);
    await s.mulligan();
    const looked = await s.lookAt('library:s0', 1);
    s.dispatch({ type: 'toZone', card: looked[0]!.id, to: 'library:s0', position: 'bottom' });
    await s.lookAt('library:s0', 2);
    const [land, spell, back] = s.secrets().hand;
    s.dispatch({ type: 'move', card: land!, to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });
    s.dispatch({ type: 'stackPush', item: 'si1', kind: 'spell', card: spell!, controller: 's0' });
    s.dispatch({ type: 'toZone', card: back!, to: 'library:s0', position: 'top' });
    s.undo();
    s.dispatch({ type: 'move', card: s.secrets().libraryOrder[0]!, to: 'graveyard:s0' });
    await s.whenSaved();

    const state = s.getState();
    const sec = s.secrets();
    const actions: Action[] = s.log().flatMap((e) => (e.kind === 'action' ? [e.action] : []));
    // Cards whose identity was published (reveal actions); every other own card must stay unknown.
    const revealed = new Set(actions.flatMap((a) => (a.type === 'reveal' ? [a.instanceId] : [])));
    expect(revealed.size).toBe(3);
    const publicSids = new Set([...revealed].map((id) => sec.identities[id]!.card.sid));
    const secretSids = new Set(Object.entries(sec.identities).flatMap(([id, v]) => (revealed.has(id) || publicSids.has(v.card.sid) ? [] : [v.card.sid])));
    const secretSalts = Object.entries(sec.identities).flatMap(([id, v]) => (revealed.has(id) ? [] : [v.salt]));
    const nonces = sec.audit.map((r) => (r.kind === 'shuffle' ? r.ownerNonce : r.nonce));
    expect(secretSids.size).toBeGreaterThan(5);

    // Everything outside the secret store, including the persisted table record and log.
    const shared = [
      canonicalJson(state),
      canonicalJson(actions),
      canonicalJson(await db.db.getAll('tables')),
      canonicalJson(await db.db.getAll('log')),
    ].join('\n');
    for (const sid of secretSids) expect(shared).not.toContain(sid);
    for (const salt of secretSalts) expect(shared).not.toContain(salt);
    for (const n of nonces) expect(shared).not.toContain(n);
    // The private library order is not derivable from shared state: hidden zones list ids sorted.
    for (const zone of ['library:s0', 'hand:s0']) {
      const ids = state.zones[zone]!.ids;
      expect(ids).toEqual([...ids].sort());
    }
    // The secrets store does hold them (it never leaves this browser).
    const stored = canonicalJson(await db.db.getAll('secrets'));
    for (const sid of secretSids) expect(stored).toContain(sid);
  });
});
