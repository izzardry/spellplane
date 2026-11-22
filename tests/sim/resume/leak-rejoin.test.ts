/**
 * Leak tests of rejoin (contracts.md Part A and Part G "Rejoin" item 8; persistence.md section 9). Owner: M8-P5.
 *
 * Real networked sessions on a LoopbackNetwork with delay, loss and reordering, under fake timers; the shared scanner
 * (tests/leak/leak.ts) over everything a browser received, holds in state, log and secret store and keeps in IndexedDB.
 * Every scenario is also run with its leak injected (a hidden card's identity put into the very message or record the
 * scenario is about) and the scanner must find it there: the scenario is not vacuous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { SecretStore, TableState } from '../../../src/core/types';
import { HEAD_KEYS } from '../../../src/net/validate';
import { PROTOCOL_VERSION } from '../../../src/net/messages';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { forbiddenFor, leakScan, type Disclosure, type LeakScanInput } from '../../leak/leak';
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
    const libraryBefore = p.a.secrets().libraryOrder.length;
    const sidOf = (sec: SecretStore, id: string): string => sec.identities[id]!.card.sid;
    const handSids = handBefore.map((id) => sidOf(p.a.secrets(), id));
    const bouncedSid = sidOf(p.a.secrets(), p.faceDown);
    const tuckedSid = sidOf(p.a.secrets(), p.spell);
    expect(handBefore.length).toBeGreaterThan(3);
    await leave(p.A);
    // Ben plays on: he bounces Ann's face-down permanent to her hand, puts her spell on top of her library, draws,
    // and plays thirty more actions.
    p.b.dispatch({ type: 'toZone', card: p.faceDown, to: 'hand:s0', position: 'any' });
    p.b.dispatch({ type: 'toZone', card: p.spell, to: 'library:s0', position: 'top' });
    await settle(p.b.draw(1));
    for (let i = 0; i < 30; i++) p.b.chat(`Ann is away ${i}`);
    await until(() => p.b.engine.pending().length === 0, 30_000, 'Ben plays');
    const a = await comeBack(network, p.A);
    await waitConverged([a, p.b], 'Ann back');
    // Her old hand plus the bounced card, the spell on top of her library, every id known to her browser.
    expect(a.secrets().hand.map((id) => sidOf(a.secrets(), id)).sort()).toEqual([...handSids, bouncedSid].sort());
    const st = a.engine.confirmedState();
    expect(st.zones['library:s0']!.ids.length).toBe(libraryBefore + 1);
    expect(sidOf(a.secrets(), a.secrets().libraryOrder[0]!)).toBe(tuckedSid);
    for (const id of [...st.zones['hand:s0']!.ids, ...st.zones['library:s0']!.ids]) expect(a.secrets().identities[id], id).toBeDefined();
    const lost = lostHiddenCards(st, a.secrets(), a.seat);
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
    // Every player's hidden cards, against what every other browser received on the control channel.
    for (const b of [ann!, ben!, cy!]) {
      const owner = { state: b.session!.engine.confirmedState(), secrets: b.session!.secrets() };
      const ctl = network.delivered.filter((d) => d.channel === 'ctl' && d.to !== b.peerId).map((d) => d.msg);
      const input = { observed: ctl, owner, disclosed: [] };
      // Injected: a head carrying a hidden card id and salt.
      cleanButSensitive(input, { ...heads[0], card: hiddenToken(owner) });
    }
  });

  describe('a lost browser brought back by link', () => {
    it('PL-3 and PL-4: the lost cards go to nobody, not even the claimant; the claim page holds no seat and none of Ann\'s cards; the rebuilt hand and library reach nobody else', async () => {
      const network = net({ seed: 303, ...FAULTS });
      const p = await playScript(network, browsers);
      // Ben's browser is replaced by a blank profile: what it held is the old owner.
      const old = frozen(p.b.engine.confirmedState(), p.b.secrets());
      expect(old.secrets.hand.length).toBeGreaterThan(3);
      const shownToBenEarlier = trackDisclosures(p.a, 's1');
      await loseSave(p.B);
      // The stage is the lobby in the script: a seat away in the lobby can be invited like any other.
      const link = await bringBack(p.A, 's1');
      expect(link).toMatch(/^(https?:\/\/[^?#]*)?#\/t\/[a-z]+-[a-z]+-[a-z]*-?\d+\/[\w-]{22}\/rejoin\/s[0-3]\/[\w-]{22}$/);
      const blank = await replaceBrowser(network, browsers, link, 'newben');
      // K1 (gate M8 round 4): the claim page holds no seat. No seat of the table is its own (not the empty secret store's
      // s0, Ann's), it holds no hand, and nothing of Ann's hidden cards reached it: only what she showed everyone.
      const ann = (): { state: TableState; secrets: SecretStore } => ({ state: p.a.engine.confirmedState(), secrets: p.a.secrets() });
      const annActions = (): Action[] => p.a.log().flatMap((e) => (e.kind === 'action' ? [e.action] : []));
      const shownToAll = (): Disclosure[] =>
        p.shownToB.filter((d) => annActions().some((a) => (a.type === 'reveal' && a.instanceId === d.instanceId) || (a.type === 'flip' && a.card === d.instanceId && a.ref !== undefined)));
      const pre = blank.session!;
      expect(pre.engine.seat()).toBeNull();
      expect(Object.keys(pre.getState().seats)).not.toContain(pre.seat);
      expect(pre.secrets().hand).toEqual([]);
      cleanButSensitive({ observed: await observedBy(network, blank), owner: ann(), disclosed: shownToAll() }, { t: 'syncRes', snapshot: null, tail: [], leak: hiddenToken(ann()) });
      await settle(blank.session!.claimSeat());
      await waitConverged([p.a, blank.session!], 'the claim');
      expect(blank.session!.seat).toBe('s1');
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
      // K1: seated at s1 and recovered, the new browser still holds nothing of Ann's hidden cards.
      cleanButSensitive({ observed: await observedBy(network, blank), owner: ann(), disclosed: shownToAll() }, { t: 'head', leak: hiddenToken(ann()) });
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
    // The same invite forged by Ben (an opponent too) straight onto the wire, past his page's own check: the sequencer
    // refuses it (a nack to Ben), and nothing is sequenced.
    const sequencer = [ann!, ben!, cy!].find((b) => b.session?.engine.isSequencer())!;
    expect(sequencer).toBe(ann);
    const seqBefore = ann!.session!.engine.seq();
    const sent = network.delivered.length;
    const forged = { type: 'seatInvite', seat: 's3', h: 'A'.repeat(43), exp: Date.now() + 60 * 60 * 1000, by: 's1', cid: 'forged-invite' };
    network.route('peer-b', 'act', { v: PROTOCOL_VERSION, t: 'propose', cid: 'forged-invite', action: forged, prev: null } as never, 'peer-a');
    await until(
      () => network.delivered.slice(sent).some((d) => d.to === 'peer-b' && (d.msg as { t?: string; cid?: string }).t === 'nack' && (d.msg as { cid?: string }).cid === 'forged-invite'),
      5000,
      "the sequencer's refusal",
    );
    const nack = network.delivered.slice(sent).find((d) => (d.msg as { cid?: string; t?: string }).cid === 'forged-invite' && (d.msg as { t?: string }).t === 'nack')!;
    expect((nack.msg as unknown as { reason: string }).reason).toMatch(/teammate/);
    expect(ann!.session!.engine.seq()).toBe(seqBefore);
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

  it('PL-7: a split where both sides advance: the copy with more moves wins over a longer one, own actions are replayed, nothing hidden crosses', async () => {
    const network = net({ seed: 307, delay: { min: 0, max: 100 } });
    const p = await playScript(network, browsers);
    const shownToA = trackDisclosures(p.b, 's0');
    const fork = p.a.engine.seq();
    network.kill('peer-a');
    await until(() => p.b.engine.peers().every((x) => x.status !== 'connected'), 15_000, 'the split on B');
    await until(() => p.a.engine.peers().every((x) => x.status !== 'connected'), 15_000, 'the split on A');
    // Ann alone draws two and plays one face down; Ben alone draws one.
    await settle(p.a.draw(2));
    p.a.playFaceDown(p.a.secrets().hand[0]!, 'battlefield:s0', { x: 140, y: -200, rot: 0 });
    await until(() => p.a.engine.pending().length === 0, 10_000, 'Ann alone');
    await settle(p.b.draw(1));
    // Ben's copy is the longer one (chat lines), Ann's has more moves.
    for (let i = 0; i < 6; i++) p.b.chat(`alone ${i}`);
    await until(() => p.b.engine.pending().length === 0, 10_000, 'Ben chats');
    const playA = p.a.engine.play!();
    const playB = p.b.engine.play!();
    expect(playA).toBeGreaterThan(playB);
    expect(p.b.engine.seq()).toBeGreaterThan(p.a.engine.seq());
    network.revive('peer-a');
    await waitConverged([p.a, p.b], 'the split healed');
    await settle(Promise.all([p.a.whenSaved(), p.b.whenSaved()]));
    // Ann's history sits right after the fork: the first action there that is not a sequencer's record is hers, and
    // every one of Ben's actions of the split comes after her moves (played again on top).
    const after = p.b.log().flatMap((e) => (e.kind === 'action' && e.seq > fork && e.action.type !== 'away' && e.action.type !== 'sequencerClaim' ? [e] : []));
    expect(after[0]!.kind === 'action' && after[0]!.action.by).toBe('s0');
    const lastAnn = after.findLastIndex((e) => e.kind === 'action' && e.action.by === 's0');
    const firstBen = after.findIndex((e) => e.kind === 'action' && e.action.by === 's1');
    expect(firstBen).toBeGreaterThan(lastAnn);
    expect(p.b.log().filter((e) => e.kind === 'action' && e.action.type === 'chat' && e.action.text.startsWith('alone ')).length).toBe(6);
    // Both sides' moves survive (the losing side's are played again on top).
    expect(p.a.engine.play!()).toBeGreaterThan(playA);
    expect(p.b.engine.play!()).toBe(p.a.engine.play!());
    const toB = { observed: await observedBy(network, p.B), owner: { state: p.a.engine.confirmedState(), secrets: p.a.secrets() }, disclosed: p.shownToB };
    cleanButSensitive(toB, { t: 'seq', leak: hiddenToken(toB.owner) });
    const toA = { observed: await observedBy(network, p.A), owner: { state: p.b.engine.confirmedState(), secrets: p.b.secrets() }, disclosed: shownToA };
    cleanButSensitive(toA, { t: 'seq', leak: hiddenToken(toA.owner) });
  });
});
