/**
 * The Two-Headed Giant draft and sealed through the real sessions (PLAN M3-P2 with M2-P7's evening, session/draft.ts):
 * four browsers at a Two-Headed Giant table, the host chooses the mode in the lobby and starts, the drivers of
 * draft/team.ts run over the session's DraftHost (pack seeds, `draftCards` on the pair channel), the stage machine
 * moves on to build once the draft is done, and each teammate's builder offers the whole team pool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbySettings } from '../../../src/core/types';
import { TEAM_POOL } from '../../../src/draft/team';
import { EVENING_OPTS } from '../flow/evening';
import { closeAll, FAKE_TIMERS, net, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { seatedTeams } from './session';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const poolIds = (s: NetTable): string[] => (s.secrets().draft?.held[TEAM_POOL] ?? []).map((c) => `${c.instanceId}|${c.ref.sid}|${c.salt}`);

async function start(sessions: NetTable[], lobby: LobbySettings): Promise<void> {
  const host = sessions[0]!;
  host.evening!.setLobby(lobby);
  await waitConverged(sessions, 'the lobby settings');
  host.evening!.start();
  await until(() => sessions.every((s) => s.engine.confirmedState().stage === 'draft'), 20_000, 'the draft stage');
}

describe('Two-Headed Giant through the sessions', () => {
  it('a team draft from the lobby to the builder: either teammate picks, both builders offer the same complete team pool', async () => {
    const network = net({ seed: 21 });
    const t = await seatedTeams(network, browsers, EVENING_OPTS);
    const s = t.sessions;
    await start(s, { draft: { format: 'teamDraft', packs: 2, picks: 2 }, sets: ['M19'], pickTimer: false });
    expect(s[0]!.engine.confirmedState().draft!.drafters).toEqual(['t0', 't1']);
    for (let ms = 0; ms < 600_000 && !s.every((x) => x.engine.confirmedState().stage === 'build'); ms += 50) {
      // The teammates take turns at picking for their team.
      for (const x of s) {
        if (x.engine.pending().length > 0) continue;
        const v = x.draft!.view();
        const first = x.seat === 's0' || x.seat === 's2';
        const taken = x.engine.confirmedState().draft!.pools[first ? (x.seat === 's0' ? 't0' : 't1') : x.seat === 's1' ? 't0' : 't1']!;
        if (v.pack === null || v.picks === 0 || (taken % 4 === 0) !== first) continue;
        x.draft!.pick(v.pack.cards.slice(-v.picks).map((c) => c.id));
      }
      await vi.advanceTimersByTimeAsync(50);
    }
    await waitConverged(s, 'the build stage');
    const d = s[0]!.engine.confirmedState().draft!;
    expect(d.done).toBe(true);
    expect(d.pools).toEqual({ t0: 30, t1: 30 });
    const picks = s[0]!.log().filter((e) => e.kind === 'action' && e.action.type === 'pick').map((e) => (e.kind === 'action' ? e.action.by : ''));
    expect(new Set(picks)).toEqual(new Set(['s0', 's1', 's2', 's3']));
    await until(() => s.every((x) => poolIds(x).length === 30), 20_000, 'every pool');
    expect(poolIds(s[1]!)).toEqual(poolIds(s[0]!));
    expect(poolIds(s[3]!)).toEqual(poolIds(s[2]!));
    expect(new Set([...poolIds(s[0]!), ...poolIds(s[2]!)]).size).toBe(60);
    // Both teammates' builders hold the whole team pool.
    for (const x of s) expect(x.draft!.build()!.cards).toHaveLength(30);
  }, 120_000);

  it('team sealed: each team’s eight packs open into one pool both teammates hold', async () => {
    const network = net({ seed: 22 });
    const t = await seatedTeams(network, browsers, EVENING_OPTS);
    const s = t.sessions;
    await start(s, { draft: { format: 'teamSealed', packs: 8 }, sets: ['M19'], pickTimer: false });
    await until(() => s.every((x) => x.engine.confirmedState().stage === 'build'), 300_000, 'the build stage');
    await until(() => s.every((x) => poolIds(x).length === 120), 20_000, 'every pool');
    expect(poolIds(s[1]!)).toEqual(poolIds(s[0]!));
    expect(poolIds(s[3]!)).toEqual(poolIds(s[2]!));
    expect(new Set([...poolIds(s[0]!), ...poolIds(s[2]!)]).size).toBe(240);
    const build = s[1]!.draft!.build()!;
    expect(build.cards).toHaveLength(120);
    // Ready with 40 of them: the deck commitment goes the usual way.
    s[1]!.draft!.setBuild({ ...build, main: build.cards.slice(0, 40).map((c) => c.id) });
    await settle(s[1]!.draft!.ready(), 30_000, 'Ben ready');
    await waitConverged(s, 'Ben’s commitment');
    expect(s[0]!.engine.confirmedState().commitments.s1!.instanceIds).toHaveLength(40);
  }, 120_000);
});
