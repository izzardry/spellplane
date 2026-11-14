/**
 * PLAN M5-P2 acceptance on LoopbackNetwork: "the audit detects a tampered library order in a simulated game and
 * passes an honest one" (DESIGN "Multiplayer architecture", Hidden information 6: "At game end each browser can
 * publish its nonces and order history. Peers replay them and confirm that every draw came from the committed order";
 * PLAN Milestone 5, owner decisions: automatic at game end; verdicts in the log and the panel; missing records are
 * "could not be checked", never a mismatch). Real networked sessions; a cheating client is the real session with a
 * patched core/secrets.ts (tests/sim/audit/cheat.ts) or with its private lists rewritten, as devtools would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditGames } from '../../../src/core/audit';
import type { Action } from '../../../src/core/actions';
import { orderHash, shuffleOutcome, shuffleSeed } from '../../../src/core/rng';
import type { ReorderRecord, SecretStore, ShuffleRecord } from '../../../src/core/types';
import { AUDIT_WAIT_MS } from '../../../src/net/audit';
import { tamperNextBundle, type SessionAudit } from '../../../src/session/audit';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { closeAll, FAKE_TIMERS, net, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { cheat, honest } from './cheat';
import { endGame, playMiddle, startGame, startThree, verdictOf, verdictsIn } from './game';
import { reload } from '../flow/evening';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);
vi.mock('../../../src/core/secrets', async (importOriginal) => (await import('./cheat')).secretsWithCheats(await importOriginal()));

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 300 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  honest();
});
afterEach(() => {
  honest();
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const actions = (s: NetTable): Action[] => s.log().flatMap((e) => (e.kind === 'action' ? [e.action] : []));
const auditLines = (s: NetTable): string[] => s.log().flatMap((e) => (e.kind === 'system' && e.text.startsWith('Audit of game') ? [e.text] : []));
/** Rewrite a session's private lists, as a player with devtools could. */
const setSecrets = (s: NetTable, f: (sec: SecretStore) => SecretStore): void => {
  const t = s as unknown as { sec: SecretStore };
  t.sec = f(t.sec);
};

describe('the post-game audit on a simulated network', () => {
  it.each([4, 11])('passes an honest game: both seats verified on both browsers, published automatically at game end (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const g = await startGame(network, browsers);
    await playMiddle(g);
    // Nothing is published while the game is played.
    expect(actions(g.a).some((x) => x.type === 'auditPublish')).toBe(false);
    expect(g.a.audit!.verdicts()).toEqual([]);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      const a = verdictOf(s, 's0');
      const b = verdictOf(s, 's1');
      expect(a).toMatchObject({ status: 'verified', game: 1 });
      expect(b).toMatchObject({ status: 'verified', game: 1 });
      // Anna: the first shuffle, the mulligan's, the re-issuing shuffle; Ben: one. Every draw from a committed order is checked.
      expect(a!.status === 'verified' && a!.shuffles).toBe(3);
      expect(b!.status === 'verified' && b!.shuffles).toBe(1);
      expect(b!.status === 'verified' && b!.draws).toBe(9);
      expect(a!.status === 'verified' && a!.draws).toBeGreaterThanOrEqual(10);
      // No draw of an honest game goes unchecked (the panel shows the ✓; M5 review).
      for (const v of [a!, b!]) expect(v.status === 'verified' && v.draws === v.drawn).toBe(true);
    }
    // Every peer computes the same verdicts from the same log.
    expect(g.b.audit!.verdicts()).toEqual(g.a.audit!.verdicts());
    // Each browser published once, after the game ended, its own bundle only.
    const log = actions(g.a);
    const game = auditGames(log)[0]!;
    const pubs = log.filter((x): x is Extract<Action, { type: 'auditPublish' }> => x.type === 'auditPublish');
    expect(pubs.map((p) => p.by).sort()).toEqual(['s0', 's1']);
    for (const p of pubs) {
      expect(p.seq!).toBeGreaterThan(game.toSeq);
      expect(p.bundle.seat).toBe(p.by);
      expect(p.bundle.game).toEqual(game);
      expect(p.bundle.incomplete).toBeUndefined();
    }
    expect(g.a.audit!.published()).toEqual([pubs.find((p) => p.by === 's0')!.bundle]);
    // Anna's bundle: her three shuffles (one re-issuing her library) and her reorders (the scry, the search, the hand re-issue).
    const anna = pubs.find((p) => p.by === 's0')!.bundle;
    expect(anna.records.filter((r) => r.kind === 'shuffle')).toHaveLength(3);
    expect(anna.records.filter((r) => r.kind === 'reorder').length).toBeGreaterThanOrEqual(3);
    expect(anna.records.some((r) => r.kind === 'shuffle' && r.reissue !== undefined)).toBe(true);
    expect(anna.records.some((r) => r.kind === 'reorder' && r.reissue !== undefined)).toBe(true);
    // The verdicts are in the log of both browsers.
    for (const s of [g.a, g.b]) {
      const lines = auditLines(s);
      expect(lines).toHaveLength(2);
      expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^Audit of game 1: Anna — verified: 3 shuffles and \d+ draws checked$/), 'Audit of game 1: Ben — verified: 1 shuffle and 9 draws checked']));
    }
  });

  it('detects a tampered library order: a shuffle whose order was stacked instead of following the seed', async () => {
    const network = net({ seed: 21 });
    // Ben's patched client reverses the order the seed gives and commits to the stacked order instead.
    cheat.seat = 's1';
    cheat.finish = (r) => {
      if (r.action.reissue) return r;
      const rec = r.secrets.audit.find((x): x is ShuffleRecord => x.kind === 'shuffle' && x.sid === r.action.sid)!;
      const stacked = [...rec.order].reverse();
      const audit = r.secrets.audit.map((x) => (x === rec ? { ...rec, order: stacked } : x));
      return { secrets: { ...r.secrets, libraryOrder: stacked, audit }, action: { ...r.action, orderHash: orderHash(stacked, rec.ownerNonce) } };
    };
    const g = await startGame(network, browsers);
    honest();
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      expect(verdictOf(s, 's0')).toMatchObject({ status: 'verified', shuffles: 1, draws: 7 });
      const v = verdictOf(s, 's1')!;
      expect(v.status).toBe('mismatch');
      if (v.status !== 'mismatch') continue;
      // One finding: the order does not follow from the seed. Ben's draws came from the order he committed to.
      expect(v.mismatches.map((m) => m.kind)).toEqual(['order']);
      expect(v.mismatches[0]!.detail).toMatch(/does not follow from the seed: position 1 should hold/);
      expect(auditLines(s)).toContainEqual(expect.stringMatching(/^Audit of game 1: Ben — mismatch: Shuffle of library:s1 \(action \d+\): the recorded order does not follow from the seed/));
    }
    expect(g.a.log().find((e) => e.kind === 'system' && e.text.startsWith('Audit of game 1: Ben'))).toMatchObject({ level: 'warn' });
  });

  it('the test-only tamper hook (debug hook audit.tamper; M5 gate) makes the published library order disagree: a mismatch for that seat', async () => {
    const network = net({ seed: 21 });
    const g = await startGame(network, browsers);
    // As the gate does through window.__spellplane.audit.tamper on Anna's page.
    tamperNextBundle((g.a as unknown as { auditImpl: SessionAudit }).auditImpl);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      expect(verdictOf(s, 's1')).toMatchObject({ status: 'verified' });
      expect(verdictOf(s, 's0')!.status).toBe('mismatch');
    }
  });

  it('detects a draw that was not the top card of the committed order, naming expected and drawn card', async () => {
    const network = net({ seed: 22 });
    const g = await startGame(network, browsers);
    // Ben swaps his top two cards in his own browser (the table cannot see that) and draws.
    const [top, second] = g.b.secrets().libraryOrder;
    setSecrets(g.b, (sec) => ({ ...sec, libraryOrder: [second!, top!, ...sec.libraryOrder.slice(2)] }));
    await settle(g.b.draw(1));
    await waitConverged([g.a, g.b]);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      expect(verdictOf(s, 's0')!.status).toBe('verified');
      const v = verdictOf(s, 's1')!;
      expect(v.status).toBe('mismatch');
      if (v.status !== 'mismatch') continue;
      expect(v.mismatches).toHaveLength(1);
      expect(v.mismatches[0]).toMatchObject({ kind: 'draw', ref: 'library:s1' });
      expect(v.mismatches[0]!.detail).toContain('The 8th draw of the game');
      expect(v.mismatches[0]!.detail).toContain(`took ${second!.slice(0, 8)}`);
      expect(v.mismatches[0]!.detail).toContain('position 2');
      expect(v.mismatches[0]!.detail).toContain(`the top of the committed library was ${top!.slice(0, 8)}`);
    }
  });

  it('detects a forged owner nonce: a shuffle seeded with a nonce other than the committed one', async () => {
    const network = net({ seed: 23 });
    // Anna's patched client picks another nonce once it has seen Ben's (grinding for a better order).
    cheat.seat = 's0';
    cheat.finish = (r) => {
      if (r.action.reissue) return r;
      const rec = r.secrets.audit.find((x): x is ShuffleRecord => x.kind === 'shuffle' && x.sid === r.action.sid)!;
      const forged = `${rec.ownerNonce}-again`;
      const order = shuffleOutcome(shuffleSeed(forged, rec.peerNonces), rec.order).order;
      const audit = r.secrets.audit.map((x) => (x === rec ? { ...rec, ownerNonce: forged, order } : x));
      return { secrets: { ...r.secrets, libraryOrder: order, audit }, action: { ...r.action, orderHash: orderHash(order, forged) } };
    };
    const g = await startGame(network, browsers);
    honest();
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      const v = verdictOf(s, 's0')!;
      expect(v.status).toBe('mismatch');
      if (v.status === 'mismatch') expect(v.mismatches.map((m) => m.kind)).toEqual(['commit']);
      expect(verdictOf(s, 's1')!.status).toBe('verified');
    }
  });

  it('detects a tampered reorder: a scry of one card that stacked the whole library', async () => {
    const network = net({ seed: 24 });
    const g = await startGame(network, browsers);
    // Anna's patched client turns her scry into a stack: the rest of her library in reverse.
    cheat.seat = 's0';
    cheat.reorder = (r) => {
      const rec = r.secrets.audit.at(-1) as ReorderRecord;
      const stacked = [...rec.order.slice(1).reverse(), rec.order[0]!];
      const audit = [...r.secrets.audit.slice(0, -1), { ...rec, order: stacked }];
      return { secrets: { ...r.secrets, libraryOrder: stacked, audit }, action: { ...r.action, orderHash: orderHash(stacked, rec.nonce) } };
    };
    const [seen] = await settle(g.a.lookAt('library:s0', 1));
    g.a.dispatch({ type: 'toZone', card: seen!.id, to: 'library:s0', position: 'bottom' });
    honest();
    await waitConverged([g.a, g.b]);
    await settle(g.a.draw(3));
    await waitConverged([g.a, g.b]);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      const v = verdictOf(s, 's0')!;
      expect(v.status).toBe('mismatch');
      if (v.status !== 'mismatch') continue;
      expect(v.mismatches.map((m) => m.kind)).toEqual(['order']);
      expect(v.mismatches[0]!.detail).toMatch(/a reorder of 1 card moved \d+ cards of the library/);
    }
  });

  it('detects a whole-library "reorder" that stacks the library (count = library size; M5 review)', async () => {
    const network = net({ seed: 25 });
    const g = await startGame(network, browsers);
    // Anna's patched client turns her scry into a reorder of every card of her library, in an order she chose.
    cheat.seat = 's0';
    cheat.reorder = (r) => {
      const rec = r.secrets.audit.at(-1) as ReorderRecord;
      const stacked = [...rec.order].reverse();
      const audit = [...r.secrets.audit.slice(0, -1), { ...rec, count: stacked.length, order: stacked }];
      return { secrets: { ...r.secrets, libraryOrder: stacked, audit }, action: { ...r.action, count: stacked.length, orderHash: orderHash(stacked, rec.nonce) } };
    };
    const [seen] = await settle(g.a.lookAt('library:s0', 1));
    g.a.dispatch({ type: 'toZone', card: seen!.id, to: 'library:s0', position: 'bottom' });
    honest();
    await waitConverged([g.a, g.b]);
    const size = g.a.secrets().libraryOrder.length;
    expect(actions(g.a).at(-1)).toMatchObject({ type: 'reorder', zone: 'library:s0', count: size });
    await settle(g.a.draw(3));
    await waitConverged([g.a, g.b]);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      const v = verdictOf(s, 's0')!;
      expect(v.status).toBe('mismatch');
      if (v.status !== 'mismatch') continue;
      expect(v.mismatches.map((m) => m.kind)).toEqual(['order']);
      expect(v.mismatches[0]!.detail).toMatch(new RegExp(`a reorder of the top ${size} cards rearranged \\d+ cards nobody had looked at`));
      expect(verdictOf(s, 's1')!.status).toBe('verified');
    }
  });

  it('a card put back with position "any" keeps the library order followed: draws from the bottom afterwards are caught (M5 review)', async () => {
    const network = net({ seed: 26 });
    const g = await startGame(network, browsers);
    // Ben's modified client puts a hand card back with 'any' (the honest UI never sends it) ...
    const back = g.b.secrets().hand[0]!;
    g.b.dispatch({ type: 'toZone', card: back, to: 'library:s1', position: 'any' });
    await waitConverged([g.a, g.b]);
    // ... his browser places it on top, as every honest one does ...
    expect(g.b.secrets().libraryOrder[0]).toBe(back);
    // ... and then he draws his bottom card, which his own browser now calls the top.
    const bottom = g.b.secrets().libraryOrder.at(-1)!;
    setSecrets(g.b, (sec) => ({ ...sec, libraryOrder: [bottom, ...sec.libraryOrder.slice(0, -1)] }));
    await settle(g.b.draw(1));
    await waitConverged([g.a, g.b]);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      expect(verdictOf(s, 's0')!.status).toBe('verified');
      const v = verdictOf(s, 's1')!;
      expect(v.status).toBe('mismatch');
      if (v.status !== 'mismatch') continue;
      expect(v.mismatches.map((m) => m.kind)).toEqual(['draw']);
      expect(v.mismatches[0]!.detail).toContain(`took ${bottom.slice(0, 8)}`);
      expect(v.mismatches[0]!.detail).toContain(`the top of the committed library was ${back.slice(0, 8)}`);
    }
  });

  it('shows a player who left before the game ended as "could not be checked: records missing", never as a mismatch; the others hold their records until the player is back', async () => {
    const network = net({ seed: 25 });
    const g = await startGame(network, browsers);
    g.b.leave();
    // Anna ends the game alone (Ben's chair answers the round by the pass timer).
    const proposal = g.a.evening!.propose('nextGame');
    expect(await settle(proposal, 60_000, 'the next game')).toBe(true);
    // Ben has not acknowledged the end: Anna's history may still lose to one in which he plays on, so she holds her
    // records back (they would show her library orders there); her own row waits and says for whom, his says "could
    // not be checked".
    await vi.advanceTimersByTimeAsync(AUDIT_WAIT_MS + 1000);
    expect(actions(g.a).some((x) => x.type === 'auditPublish')).toBe(false);
    expect(g.a.audit!.published()).toEqual([]);
    expect(g.a.audit!.games()[0]!.seats.find((x) => x.seat === 's0')).toMatchObject({ verdict: null, note: "Published once Ben (away) has the game's end" });
    expect(g.a.audit!.verdicts().map((v) => v.seat)).toEqual(['s1']);
    expect(verdictOf(g.a, 's1')).toMatchObject({ status: 'unverifiable', reason: 'recordsMissing', checked: 0 });
    expect(auditLines(g.a)).toEqual(['Audit of game 1: Ben — could not be checked: records missing (none published so far; records published later are still checked)']);

    // Ben comes back with his save: his browser publishes the records it kept, and once his browser reports the end in
    // Anna's history she publishes hers; both verdicts become the real ones.
    await reload(network, g.B);
    const b = g.B.session!;
    await until(() => verdictOf(g.a, 's1')?.status === 'verified' && verdictOf(g.a, 's0')?.status === 'verified', 60_000, 'both bundles on Anna’s side');
    await until(() => verdictOf(b, 's1')?.status === 'verified' && verdictOf(b, 's0')?.status === 'verified', 60_000, 'Ben’s own verdicts');
    expect(auditLines(g.a).filter((l) => l.startsWith('Audit of game 1: Ben'))).toEqual([expect.stringContaining('could not be checked'), expect.stringContaining('verified')]);
    expect(auditLines(g.a).filter((l) => l.startsWith('Audit of game 1: Anna'))).toEqual([expect.stringContaining('verified')]);
    expect(g.a.audit!.published()).toHaveLength(1);
  });

  it('three players, two of whom let "Next game?" pass on the default pass timer: every browser publishes and every player is verified', async () => {
    const network = net({ seed: 31, ...FAULTS });
    const t = await startThree(network, browsers);
    expect(t.a.engine.confirmedState().settings.passTimerMs).toBeGreaterThan(0);
    for (const s of t.all) await settle(s.draw(1));
    await waitConverged(t.all, 'a draw each');
    // Anna asks; Ben and Cara say nothing, the sequencer answers for them when the timer runs out.
    expect(await settle(t.a.evening!.propose('nextGame'), 60_000, 'the next game')).toBe(true);
    await until(() => t.all.every((s) => s.engine.confirmedState().stage === 'build'), 30_000, 'the builder');
    const timeouts = actions(t.a).filter((x) => x.type === 'respond' && x.response === 'timeout');
    expect(timeouts.map((x) => (x as { seat: string }).seat).sort()).toEqual(['s1', 's2']);
    await verdictsIn(t.all, 1, 3);
    for (const s of t.all) {
      for (const seat of ['s0', 's1', 's2']) expect(verdictOf(s, seat)).toMatchObject({ status: 'verified', shuffles: 1, draws: 8 });
      expect(auditLines(s).some((l) => l.includes('could not be checked'))).toBe(false);
      expect(s.audit!.published()).toHaveLength(1);
    }
    expect(t.b.audit!.verdicts()).toEqual(t.a.audit!.verdicts());
    expect(t.c.audit!.verdicts()).toEqual(t.a.audit!.verdicts());
  });

  it('a browser whose audit records were lost publishes what it has: "could not be checked", not a mismatch', async () => {
    const network = net({ seed: 26 });
    const g = await startGame(network, browsers);
    await settle(g.b.shuffle(), 60_000, 'Ben’s second shuffle');
    await settle(g.b.draw(2));
    await waitConverged([g.a, g.b]);
    // Ben's stored records are gone (cleared storage): only the second shuffle's survived.
    setSecrets(g.b, (sec) => ({ ...sec, audit: sec.audit.slice(-1) }));
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    for (const s of [g.a, g.b]) {
      expect(verdictOf(s, 's1')).toMatchObject({ status: 'unverifiable', reason: 'recordsMissing', checked: 1 });
      // The unrecorded shuffle is named, so a selective gap shows; the draws after it went unchecked.
      const first = actions(s).find((x) => x.type === 'shuffleDone' && x.by === 's1')!.seq;
      const v = verdictOf(s, 's1')!;
      expect(v.status === 'unverifiable' && v.detail).toBe(`1 of 2 shuffles and reorders checked; the rest could not be checked (no record of action ${first}); 2 of 9 draws checked.`);
      expect(verdictOf(s, 's0')!.status).toBe('verified');
    }
    const pub = actions(g.a).find((x): x is Extract<Action, { type: 'auditPublish' }> => x.type === 'auditPublish' && x.by === 's1')!;
    expect(pub.bundle.incomplete).toBe(true);
  });

  it('a reload after the game rebuilds the same verdicts from the saved log, and does not publish twice', async () => {
    const network = net({ seed: 27 });
    const g = await startGame(network, browsers);
    await endGame(g);
    await verdictsIn([g.a, g.b]);
    const before = g.b.audit!.verdicts();
    const b = await reload(network, g.B);
    await waitConverged([g.a, b]);
    await verdictsIn([b]);
    expect(b.audit!.verdicts()).toEqual(before);
    expect(b.audit!.published()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(actions(b).filter((x) => x.type === 'auditPublish')).toHaveLength(2);
    expect(auditLines(b)).toHaveLength(2);
  });
});
