/**
 * PLAN M3-P2 acceptance: "the team draft pool is shared and complete" (DESIGN "Pre-game: draft, sealed and deck
 * building", mode table: Two-Headed Giant draft "Teams pick two cards per pack into a shared team pool; 6 packs per
 * team", "Team sees its own packs and pool"; Two-Headed Giant sealed "8 packs per team, shared pool"; "Specification:
 * card data, packs and draft formats", Draft formats: "A team shares each pack and pool; the team picks 2 cards per
 * pass; passing goes team to team, alternating direction per round … After 3 rounds").
 *
 * Four seats on a simulated network with delay, drop and reordering (also on the pair channel), a reload and an outage:
 * when the draft is over both teammates hold the same team pool, card for card in pick order, every card of every pack
 * is in exactly one team's pool with the identity its opener generated, and the builder's pool (SecretStore.pool) is
 * that pool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevealedCard } from '../../../src/core/commit';
import { close, generatedBy, poolOf, runTeamDraft, teamBot, teamNet, type TeamNet } from './net';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const FAULTY = { seed: 13, delay: { min: 0, max: 60 }, drop: 0.05 };

const key = (c: RevealedCard): string => `${c.instanceId}|${c.ref.sid}|${c.ref.foil === true ? 'f' : 'n'}|${c.salt}`;

/** Both teammates hold one identical, complete team pool, and the two pools split every generated card between them. */
function expectSharedAndComplete(t: TeamNet, cardsPerTeam: number): void {
  const generated = new Map(t.seats.flatMap(generatedBy).map((c) => [c.instanceId, c]));
  expect(generated.size).toBe(2 * cardsPerTeam);
  const pools = new Map<string, RevealedCard[]>();
  for (const s of t.seats) {
    const pool = poolOf(s);
    expect(pool, `${s.seat}'s pool`).toHaveLength(cardsPerTeam);
    expect(s.peer.state.draft!.pools[s.team]).toBe(cardsPerTeam);
    // The builder works from SecretStore.pool: the same cards.
    expect(s.secrets().pool).toEqual(pool.map((c) => c.ref));
    for (const c of pool) expect(key(c), 'a pool card is the card its opener generated').toBe(key(generated.get(c.instanceId)!));
    const mate = pools.get(s.team);
    if (mate === undefined) pools.set(s.team, pool);
    else expect(pool.map(key), `${s.seat} holds its teammate's pool`).toEqual(mate.map(key));
  }
  const all = [...pools.get('t0')!, ...pools.get('t1')!].map((c) => c.instanceId);
  expect(new Set(all).size).toBe(all.length);
  expect(new Set(all)).toEqual(new Set(generated.keys()));
}

describe('Two-Headed Giant draft: the team pool is shared and complete', () => {
  it('6 packs per team, 2 picks per pass, under delay, drop, a reload and an outage', async () => {
    const t = await teamNet({ format: 'teamDraft', packs: 6, picks: 2 }, FAULTY, ['M19', 'M20', 'M21']);
    const ben = t.seats[1]!;
    const dan = t.seats[3]!;
    let reloaded = false;
    let deadSince = -1;
    await runTeamDraft(t, teamBot(7), 1_500_000, (ms) => {
      if (!reloaded && ms > 3_000 && ben.driver.view().pack !== null) {
        reloaded = true;
        ben.reload();
      }
      // Dan drops off the network for 6 s in the second round; Cleo picks for the team meanwhile.
      if (deadSince < 0 && t.seats[0]!.peer.state.draft!.round === 1) {
        deadSince = ms;
        dan.idle = true;
        t.net.kill(dan.peer.peerId);
      }
      if (deadSince >= 0 && dan.idle && ms - deadSince > 6_000) {
        dan.idle = false;
        t.net.revive(dan.peer.peerId);
      }
    });
    expect(reloaded).toBe(true);
    expect(deadSince).toBeGreaterThan(0);
    const d = t.seats[0]!.peer.state.draft!;
    expect(d.round).toBe(2);
    expect(Object.keys(d.packs)).toHaveLength(12);
    // Pool order is pick order: the ids the team's picks named.
    for (const s of t.seats) expect(poolOf(s).map((c) => c.instanceId)).toEqual(d.taken![s.team]);
    expectSharedAndComplete(t, 6 * 15);
    close(t);
  }, 120_000);

  it('the pick timer picks for a team that does not, and the pool stays shared and complete', async () => {
    const t = await teamNet({ format: 'teamDraft', packs: 2, picks: 2 }, { seed: 3, delay: { min: 0, max: 30 } }, ['M19'], true);
    // Team t1 never picks: every one of its picks is the sequencer's draftTimeout.
    t.seats[2]!.idle = true;
    t.seats[3]!.idle = true;
    await runTeamDraft(t, teamBot(9), 3_000_000, undefined, 100);
    const log = t.seats[0]!.peer.log();
    expect(log.some((a) => a.type === 'draftTimeout')).toBe(true);
    expect(log.filter((a) => a.type === 'pick').every((a) => a.by === 's0' || a.by === 's1')).toBe(true);
    expectSharedAndComplete(t, 2 * 15);
    close(t);
  }, 120_000);
});

describe('Two-Headed Giant sealed: the team pool is shared and complete', () => {
  it('8 packs per team, under delay, drop and a reload', async () => {
    const t = await teamNet({ format: 'teamSealed', packs: 8 }, FAULTY, ['M19', 'M20']);
    let reloaded = false;
    await runTeamDraft(t, () => undefined, 900_000, (ms) => {
      if (!reloaded && ms > 2_000) {
        reloaded = true;
        t.seats[2]!.reload();
      }
    });
    const d = t.seats[0]!.peer.state.draft!;
    expect(Object.values(d.packs).filter((p) => p.opener === 's0').map((p) => p.number)).toEqual([0, 2, 4, 6]);
    expect(Object.values(d.packs).filter((p) => p.opener === 's3').map((p) => p.number)).toEqual([1, 3, 5, 7]);
    expect(Object.values(d.packs).map((p) => p.set).sort()).toEqual([...Array(2).fill('M19'), ...Array(14).fill('M20')]);
    expectSharedAndComplete(t, 8 * 15);
    // Sealed pool order: the team's packs in team pack order, each in pack order (rare first).
    for (const s of t.seats) {
      const packs = Object.values(d.packs)
        .filter((p) => t.start.seats[p.opener]!.team === s.team)
        .sort((a, b) => a.number - b.number);
      const owners = new Map(t.seats.flatMap((x) => (x.secrets().draft?.generated ?? []).map((g) => [g.packId, g.cards] as const)));
      expect(poolOf(s).map(key)).toEqual(packs.flatMap((p) => owners.get(p.id)!.map(key)));
    }
    close(t);
  }, 120_000);
});
