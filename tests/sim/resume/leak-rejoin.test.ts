/**
 * Leak tests of rejoin (contracts.md Part A and Part G "Rejoin" item 8; persistence.md section 9). Owner: M8-P5.
 *
 * Real networked sessions on a LoopbackNetwork with delay, loss and reordering, under fake timers; the shared scanner
 * (tests/leak/leak.ts) over everything a browser received, holds in state, log and secret store and keeps in IndexedDB.
 * Every scenario is also run with its leak injected (a hidden card's identity put into the very message or record the
 * scenario is about) and the scanner must find it there: the scenario is not vacuous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore, TableState } from '../../../src/core/types';
import { HEAD_KEYS } from '../../../src/net/validate';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { forbiddenFor, leakScan, type LeakScanInput } from '../../leak/leak';
import { closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, settle, trackDisclosures, until, waitConverged, type Browser } from '../session/harness';
import { playScript } from '../session/script';
import { lostHiddenCards } from '../../../src/session/resume';
import { loseSave } from './helpers';
import { bringBack, comeBack, leave, replaceBrowser, seated } from './rejoin-helpers';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 200 }, drop: 0.03, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

/** A copy of the owner's data as it was (a browser that is about to be lost). */
const frozen = (state: TableState, secrets: SecretStore): { state: TableState; secrets: SecretStore } => structuredClone({ state, secrets });

/** A hidden card of the owner with its identity and salt, as a leak would carry it. */
function hiddenToken(owner: { secrets: SecretStore }): { instanceId: string; sid: string; salt: string } {
  const [id, s] = Object.entries(owner.secrets.identities).find(([iid]) => owner.secrets.hand.includes(iid) || owner.secrets.libraryOrder.includes(iid))!;
  return { instanceId: id, sid: s.card.sid, salt: s.salt };
}

/** The scan is clean, and the same scan with `injected` added to what was observed is not. */
function cleanButSensitive(input: LeakScanInput, injected: unknown): void {
  expect(forbiddenFor(input).tokens.length).toBeGreaterThan(5);
  const report = leakScan(input);
  expect(report.tokens).toEqual([]);
  expect(report.pairs).toEqual([]);
  const leaky = leakScan({ ...input, observed: [...input.observed, injected] });
  expect(leaky.tokens.length + leaky.pairs.length).toBeGreaterThan(0);
}

describe('rejoin leaks (M8-P5)', () => {
  it('PL-1: Ann leaves with hidden cards, Ben plays on, Ann returns from her save: nothing of her hand reaches Ben; her hand is kept, no recovery', async () => {
    const network = net({ seed: 301, ...FAULTS });
    const p = await playScript(network, browsers);
    const handBefore = [...p.a.secrets().hand];
    expect(handBefore.length).toBeGreaterThan(3);
    await leave(p.A);
    await settle(p.b.draw(1));
    p.b.chat('Ann is away');
    await until(() => p.b.engine.pending().length === 0, 10_000, 'Ben plays');
    const a = await comeBack(network, p.A);
    await waitConverged([a, p.b], 'Ann back');
    expect(a.secrets().hand).toEqual(handBefore);
    const lost = lostHiddenCards(a.engine.confirmedState(), a.secrets(), a.seat);
    expect(lost.hand).toEqual([]);
    expect(lost.library).toEqual([]);
    await settle(Promise.all([a.whenSaved(), p.b.whenSaved()]));
    const input = { observed: await observedBy(network, p.B), owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: p.shownToB };
    // Injected: Ann's returning hello carrying a hand card.
    cleanButSensitive(input, { t: 'hello', leak: hiddenToken(input.owner) });
  });

  it('PL-2: head announcements during a three-player gathering carry exactly v, t, seq, play, h, turn, stage, live, saving', async () => {
    const network = net({ seed: 302, delay: { min: 0, max: 150 } });
    const [ann, ben, cy] = await seated(network, browsers, 3, 'ffa3');
    for (const b of [ann!, ben!, cy!]) {
      await settle(b.session!.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'ready');
    }
    await settle(ann!.session!.shuffle(), 60_000, 'shuffle');
    await settle(ann!.session!.draw(7));
    for (const b of [ann!, ben!, cy!]) await settle(b.session!.whenSaved());
    // Every tab closes without a word: each copy shows the others present, so whoever comes back gathers.
    for (const b of [ann!, ben!, cy!]) {
      network.kill(b.peerId);
      b.session!.dispose();
      b.session = null;
    }
    await comeBack(network, ben!);
    await comeBack(network, cy!);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ben!.session!.muster.muster().live).toBe(false);
    await comeBack(network, ann!);
    await vi.advanceTimersByTimeAsync(3000);
    const heads = network.delivered.filter((d) => (d.msg as { t?: string }).t === 'head').map((d) => d.msg as Record<string, unknown>);
    expect(heads.length).toBeGreaterThan(3);
    for (const h of heads) expect(Object.keys(h).sort()).toEqual([...HEAD_KEYS].sort());
    const owner = { state: ann!.session!.engine.confirmedState(), secrets: ann!.session!.secrets() };
    const ctl = network.delivered.filter((d) => d.channel === 'ctl' && d.to !== 'peer-a').map((d) => d.msg);
    const input = { observed: ctl, owner, disclosed: [] };
    // Injected: a head carrying a hidden card id and salt.
    cleanButSensitive(input, { ...heads[0], card: hiddenToken(owner) });
  });

  describe('a lost browser brought back by link', () => {
    it('PL-3 and PL-4: the lost cards go to nobody, not even the claimant; the rebuilt hand and library reach nobody else', async () => {
      const network = net({ seed: 303, ...FAULTS });
      const p = await playScript(network, browsers);
      // Ben's browser is replaced by a blank profile: what it held is the old owner.
      const old = frozen(p.b.engine.confirmedState(), p.b.secrets());
      expect(old.secrets.hand.length).toBeGreaterThan(3);
      const shownToBenEarlier = trackDisclosures(p.a, 's1');
      await loseSave(p.B);
      // The stage is the lobby in the script: a seat away in the lobby can be invited like any other.
      const link = await bringBack(p.A, 's1');
      expect(link).toMatch(/^.*#\/t\/[a-z]+-[a-z]+-[a-z]*-?\d+\/[\w-]{22}\/rejoin\/s[0-3]\/[\w-]{22}$/);
      const blank = await replaceBrowser(network, browsers, link, 'newben');
      await settle(blank.session!.claimSeat());
      await waitConverged([p.a, blank.session!], 'the claim');
      // PL-3: none of old Ben's hidden cards in Ann's or the new browser's observed data.
      const oldBen = { state: old.state, secrets: old.secrets };
      const toNew = { observed: await observedBy(network, blank), owner: oldBen, disclosed: [] };
      // Injected: the syncRes to the claimant carrying one of the lost hand's identities.
      cleanButSensitive(toNew, { t: 'syncRes', snapshot: null, tail: [], leak: hiddenToken(oldBen) });
      const toAnn = { observed: await observedBy(network, p.A), owner: oldBen, disclosed: shownToBenEarlier };
      expect(leakScan(toAnn).tokens).toEqual([]);
      // PL-4: the new browser rebuilds in public; Ann agrees; nothing of the new hand or library reaches Ann.
      const b = blank.session!;
      const lost = lostHiddenCards(b.engine.confirmedState(), b.secrets(), b.seat);
      expect(lost.hand.length + lost.library.length).toBeGreaterThan(0);
      const shownToAnn = trackDisclosures(b, 's0');
      await settle(b.recover(await fixtureDeck('ur-m19-60.mtga.txt'), 5), 120_000, 'the recovery');
      await waitConverged([p.a, b], 'the recovery');
      await settle(Promise.all([p.a.whenSaved(), b.whenSaved()]));
      expect(b.secrets().hand.length).toBe(5);
      const rebuilt = { state: b.engine.confirmedState(), secrets: b.secrets() };
      const input = { observed: await observedBy(network, p.A), owner: rebuilt, disclosed: shownToAnn };
      cleanButSensitive(input, { t: 'head', leak: hiddenToken(rebuilt) });
    });
  });

  it('PL-6 and PL-9: 2HG with team B away: an opponent cannot invite a B seat; a claimed seat gets no teamHand until the teammate says SHOW', async () => {
    const network = net({ seed: 306, delay: { min: 0, max: 120 } });
    const [ann, ben, cy, dana] = await seated(network, browsers, 4, '2hg');
    await settle(cy!.session!.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'Cy ready');
    await settle(cy!.session!.shuffle(), 60_000, 'Cy shuffles');
    await settle(cy!.session!.draw(7));
    // Both of team B (s2 Cy, s3 Dana) away; Dana's browser is lost.
    await loseSave(dana!);
    await leave(cy!);
    await until(() => ['s2', 's3'].every((s) => ann!.session!.getState().seats[s]!.away === true), 10_000, 'team B away');
    await vi.advanceTimersByTimeAsync(31_000);
    // PL-6: the opponent's invite is refused by the reducer (and so never sequenced), even with the whole team away.
    await expect(settle(ann!.session!.muster.invite('s3'))).rejects.toThrow(/teammate/);
    expect(ann!.session!.getState().seats.s3!.invite).toBeUndefined();
    // Cy comes back and makes the link herself.
    const c = await comeBack(network, cy!);
    await waitConverged([ann!.session!, c]);
    const link = await bringBack(cy!, 's3');
    const sentBefore = network.delivered.length;
    const blank = await replaceBrowser(network, browsers, link, 'newdana');
    await settle(blank.session!.claimSeat());
    await waitConverged([c, blank.session!]);
    await vi.advanceTimersByTimeAsync(3000);
    const toNew = (): unknown[] => network.delivered.slice(sentBefore).filter((d) => d.to === 'peer-newdana' && d.channel === 'prv').map((d) => d.msg);
    expect(toNew().filter((m) => (m as { t?: string }).t === 'teamHand')).toEqual([]);
    const owner = { state: c.engine.confirmedState(), secrets: c.secrets() };
    const input = { observed: [...toNew(), blank.session!.getState(), blank.session!.secrets()], owner, disclosed: [] };
    cleanButSensitive(input, { t: 'teamHand', cards: [hiddenToken(owner)] });
    // SHOW: from now on the hand goes to the new browser (the designed reveal path).
    expect(c.team!.withheld!().map((w) => w.seat)).toEqual(['s3']);
    c.team!.showHand!('s3');
    await until(() => toNew().some((m) => (m as { t?: string }).t === 'teamHand'), 5000, 'the hand after SHOW');
    void ben;
  });

  it('PL-7: a split where both sides advance: the copy with more moves wins, own actions are replayed, nothing hidden crosses', async () => {
    const network = net({ seed: 307, delay: { min: 0, max: 100 } });
    const p = await playScript(network, browsers);
    const shownToA = trackDisclosures(p.b, 's0');
    network.kill('peer-a');
    await until(() => p.b.engine.peers().every((x) => x.status !== 'connected'), 15_000, 'the split on B');
    await until(() => p.a.engine.peers().every((x) => x.status !== 'connected'), 15_000, 'the split on A');
    // Ann alone draws two and plays one face down; Ben alone draws one.
    await settle(p.a.draw(2));
    p.a.playFaceDown(p.a.secrets().hand[0]!, 'battlefield:s0', { x: 140, y: -200, rot: 0 });
    await until(() => p.a.engine.pending().length === 0, 10_000, 'Ann alone');
    await settle(p.b.draw(1));
    const playA = p.a.engine.play!();
    const playB = p.b.engine.play!();
    expect(playA).toBeGreaterThan(playB);
    network.revive('peer-a');
    await waitConverged([p.a, p.b], 'the split healed');
    await settle(Promise.all([p.a.whenSaved(), p.b.whenSaved()]));
    // Both sides' moves survive (the losing side's are played again on top).
    expect(p.a.engine.play!()).toBeGreaterThanOrEqual(playA);
    const toB = { observed: await observedBy(network, p.B), owner: { state: p.a.engine.confirmedState(), secrets: p.a.secrets() }, disclosed: p.shownToB };
    cleanButSensitive(toB, { t: 'seq', leak: hiddenToken(toB.owner) });
    const toA = { observed: await observedBy(network, p.A), owner: { state: p.b.engine.confirmedState(), secrets: p.b.secrets() }, disclosed: shownToA };
    cleanButSensitive(toA, { t: 'seq', leak: hiddenToken(toA.owner) });
  });
});
