// Two-Headed Giant teams by chair (PLAN Milestone 5, owner decisions, Folded into M5: "M5-P5 forms Two-Headed Giant
// teams by chair when a room is created as Two-Headed Giant without passing through the lobby" — M3 gate follow-up;
// DESIGN "Players, seats and formats", Two-Headed Giant: "2 + 2", teammates side by side on one long edge, one shared
// life total and one shared turn marker). Real networked sessions on a LoopbackNetwork under fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSeatProblem } from '../../../src/core/stage';
import type { TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import { freshNetTable } from '../../../src/session/net';
import { act, ok } from '../draft/open/helpers';
import { browser, closeAll, FAKE_TIMERS, net, open, waitConverged, type Browser } from '../../sim/session/harness';

vi.mock('../../../src/net/identity', async () => (await import('../../sim/net/fake-identity')).fakeIdentityModule);

const teamsOf = (t: TableState): Record<string, string | undefined> => Object.fromEntries(Object.values(t.seats).map((s) => [s.id, s.team]));

describe('a table created as Two-Headed Giant, without the lobby\'s format choice', () => {
  it('has both teams from seq 0: chairs 1+2 and 3+4, one life total of 30 each, the first team\'s turn', () => {
    const t = freshNetTable(mtg, '2hg');
    expect(teamsOf(t)).toEqual({ s0: 't0', s1: 't0', s2: 't1', s3: 't1' });
    expect(Object.values(t.teams).map((x) => [x.id, x.seats, x.life])).toEqual([
      ['t0', ['s0', 's1'], 30],
      ['t1', ['s2', 's3'], 30],
    ]);
    expect(t.turn.active).toBe('t0');
  });

  it('a player who sits down joins the team of that chair, and a Two-Headed Giant draft may start without a formatSet', () => {
    let t = freshNetTable(mtg, '2hg');
    const names = ['Anna', 'Ben', 'Cleo', 'Dan'];
    names.forEach((name, i) => {
      t = ok(t, act('seatTake', { seat: `s${i}`, name, colour: i as 0, peer: `p${i}` }, `s${i}`));
    });
    expect(teamsOf(t)).toEqual({ s0: 't0', s1: 't0', s2: 't1', s3: 't1' });
    expect(formatSeatProblem(t, { format: 'teamDraft', packs: 6, picks: 2 } as never)).toBeNull();
    // A life change on one teammate is the team's life.
    t = ok(t, act('life', { seat: 's1', delta: -3 }, 's1'));
    expect(t.teams.t0!.life).toBe(27);
  });
});

describe('over the network', () => {
  let browsers: Browser[] = [];
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
  });
  afterEach(() => {
    closeAll(browsers);
    browsers = [];
    vi.useRealTimers();
  });

  it('four browsers opening a Two-Headed Giant room each sit in a chair of a team and agree on the teams', async () => {
    const network = net({ seed: 3 });
    const all = await Promise.all(['anna', 'ben', 'cleo', 'dan'].map((n, i) => browser(n, `peer-${n}`, n[0]!.toUpperCase() + n.slice(1), i)));
    browsers.push(...all);
    for (const b of all) await open(network, b, {}, { format: '2hg' });
    await waitConverged(all.map((b) => b.session!));
    const st = all[0]!.session!.getState();
    expect(st.format).toBe('2hg');
    expect(Object.values(st.seats).filter((s) => s.peer).length).toBe(4);
    expect(teamsOf(st)).toEqual({ s0: 't0', s1: 't0', s2: 't1', s3: 't1' });
    for (const team of Object.values(st.teams)) expect(team.seats).toHaveLength(2);
    // Each browser's team view knows its teammate.
    for (const b of all) {
      const me = b.session!.seat;
      const team = st.seats[me]!.team!;
      expect(st.teams[team]!.seats).toContain(me);
      expect(b.session!.team).toBeDefined();
    }
  });
});
