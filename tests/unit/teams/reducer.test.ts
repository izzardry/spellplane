/**
 * The Two-Headed Giant reducer cases (PLAN M3-P2; DESIGN "Players, seats and formats", Two-Headed Giant: one shared life
 * total and one shared turn and phase marker; "Pre-game: draft, sealed and deck building", mode table: Two-Headed Giant
 * draft "Teams pick two cards per pack into a shared team pool; 6 packs per team", Two-Headed Giant sealed "8 packs per
 * team, shared pool"; "Specification: card data, packs and draft formats", Draft formats: "A team shares each pack and
 * pool; the team picks 2 cards per pass; passing goes team to team, alternating direction per round … After 3 rounds").
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import { draftDeadlines, pickTimerMs, TEAM_PICK_GRACE_MS } from '../../../src/core/drafting';
import { packRemaining } from '../../../src/core/reducer/pass';
import { formatSeatProblem } from '../../../src/core/stage';
import { activeSeats, draftMembers, opensInRound, teamDraftPackIndex, teamDraftRounds, teamMembers, teamSealedNumbers } from '../../../src/core/teams';
import { freshNetTable } from '../../../src/session/net';
import { mtg } from '../../../src/games/index';
import type { DraftState, TableState } from '../../../src/core/types';
import { act, no, ok } from '../draft/open/helpers';
import { cards, open, teamDraftTable, teamTable } from './helpers';

const DRAFT = { format: 'teamDraft', packs: 6, picks: 2 } as const;
const SEALED = { format: 'teamSealed', packs: 8 } as const;

const draftOf = (s: TableState): DraftState => s.draft!;

/** Both members of both teams open their pack of the current round (15 cards each). */
function openRound(state: TableState, size = 15): TableState {
  let s = state;
  const round = draftOf(s).round;
  const packs = (draftOf(s).settings as { packs: number }).packs;
  for (const team of draftOf(s).drafters) {
    const members = teamMembers(s, team);
    members.forEach((seat, j) => {
      if (opensInRound(packs, members.length, j, round)) s = open(s, seat, cards(size), round).state;
    });
  }
  return s;
}

/** The team's front pack: `by` picks the first `count` remaining ids. */
function pickFront(state: TableState, team: string, by: string): TableState {
  const d = draftOf(state);
  const packId = d.queues[team]![0]!;
  const pack = d.packs[packId]!;
  const count = Math.min(2, pack.count);
  return ok(state, act('pick', { packId, count, cards: packRemaining(d, pack).slice(0, count) }, by));
}

describe('Two-Headed Giant: shared life and turn marker', () => {
  it('a life change by either teammate updates the one team total, never a seat total or the other team', () => {
    let s = teamTable();
    expect(s.teams.t0!.life).toBe(30);
    expect(s.teams.t1!.life).toBe(30);
    s = ok(s, act('life', { seat: 's0', delta: -3 }, 's0'));
    s = ok(s, act('life', { seat: 's1', delta: -4 }, 's1'));
    // An opponent's damage to a seat of t0 lands on the same total.
    s = ok(s, act('life', { seat: 's1', delta: -2 }, 's2'));
    expect(s.teams.t0!.life).toBe(21);
    expect(s.teams.t1!.life).toBe(30);
    expect(s.seats.s0!.life).toBe(30);
    expect(s.seats.s1!.life).toBe(30);
  });

  it('the turn marker belongs to a team: both teammates are active, and passing the turn moves it to the other team', () => {
    let s = teamTable();
    expect(s.turn.active).toBe('t0');
    expect(activeSeats(s)).toEqual(['s0', 's1']);
    s = ok(s, act('turnPass', { to: 't1' }, 's1'));
    expect(s.turn.active).toBe('t1');
    expect(activeSeats(s)).toEqual(['s2', 's3']);
    s = ok(s, act('phaseSet', { phase: 'combat' }, 's3'));
    expect(s.turn.phase).toBe('combat');
  });
});

describe('Two-Headed Giant draft: opening', () => {
  it('drafts by team: each member opens one pack per round into its team\'s queue; the pack names its opener, the team holds it', () => {
    const t = teamDraftTable(DRAFT);
    expect(draftOf(t).drafters).toEqual(['t0', 't1']);
    expect(teamDraftRounds(6, 2)).toBe(3);
    let s = t;
    const a = open(s, 's0', cards(15), 0);
    s = a.state;
    const b = open(s, 's1', cards(15), 0);
    s = b.state;
    const d = draftOf(s);
    expect(d.queues.t0).toEqual([a.packId, b.packId]);
    expect(d.packs[a.packId]).toMatchObject({ opener: 's0', holder: 't0', count: 15, number: 0, picks: 0 });
    expect(d.packs[b.packId]).toMatchObject({ opener: 's1', holder: 't0' });
    // No identity enters shared state.
    expect(canonicalJson(s)).not.toContain('sid-');
    expect(canonicalJson(s)).not.toContain('salt-');
  });

  it('refuses a second pack of a member in a round, a pack of the next round and a pack of a seat without a drafting team', () => {
    let s = open(teamDraftTable(DRAFT), 's0', cards(15), 0).state;
    // A second pack of s0 in round 1 (fresh seed, same number).
    expect(() => open(s, 's0', cards(15), 0)).toThrow();
    no(s, act('packOpen', { packId: 'x', commits: [], count: 0 }, 's0'));
    expect(() => open(s, 's1', cards(15), 1)).toThrow();
    // A table whose seat 3 has left the team: Dan drafts for nobody.
    const lone = { ...s, seats: { ...s.seats, s3: { ...s.seats.s3!, team: undefined } } } as TableState;
    delete (lone.seats.s3 as { team?: string }).team;
    expect(() => open(lone, 's3', cards(15), 0)).toThrow();
    s = open(s, 's1', cards(15), 0).state;
    expect(draftOf(s).queues.t0).toHaveLength(2);
  });

  it('with an odd number of packs per team only the first member opens in the last round', () => {
    expect(teamDraftRounds(5, 2)).toBe(3);
    expect([0, 1].map((j) => opensInRound(5, 2, j, 2))).toEqual([true, false]);
    let s = teamDraftTable({ format: 'teamDraft', packs: 5, picks: 2 });
    for (let round = 0; round < 2; round++) {
      s = openRound(s, 4);
      while (!draftOf(s).done && draftOf(s).round === round) {
        for (const team of ['t0', 't1']) if (draftOf(s).queues[team]!.length > 0) s = pickFront(s, team, team === 't0' ? 's0' : 's2');
      }
    }
    expect(draftOf(s).round).toBe(2);
    expect(() => open(s, 's1', cards(4), 2)).toThrow(/s1 opens no pack/);
    s = open(s, 's0', cards(4), 2).state;
    s = open(s, 's2', cards(4), 2).state;
    while (!draftOf(s).done) for (const team of ['t0', 't1']) if (draftOf(s).queues[team]!.length > 0) s = pickFront(s, team, team === 't0' ? 's1' : 's3');
    // Ten packs of four: two picks each way per pack.
    expect(draftOf(s).pools).toEqual({ t0: 20, t1: 20 });
    expect(draftOf(s).done).toBe(true);
  });
});

describe('Two-Headed Giant draft: picking', () => {
  it('either teammate picks two named cards of the team\'s front pack; the rest goes straight to the other team\'s queue', () => {
    let s = openRound(teamDraftTable(DRAFT));
    const front = draftOf(s).queues.t0![0]!;
    const t1Packs = [...draftOf(s).queues.t1!];
    const ids = packRemaining(draftOf(s), draftOf(s).packs[front]!);
    // Ben (s1) picks from the pack Anna (s0) opened.
    s = ok(s, act('pick', { packId: front, count: 2, cards: [ids[3]!, ids[7]!] }, 's1'));
    const d = draftOf(s);
    expect(d.taken?.t0).toEqual([ids[3], ids[7]]);
    expect(d.pools.t0).toBe(2);
    expect(d.packs[front]).toMatchObject({ count: 13, picks: 1, holder: 't1' });
    expect(d.queues.t0).toHaveLength(1);
    expect(d.queues.t1).toEqual([...t1Packs, front]);
    expect(packRemaining(d, d.packs[front]!)).toEqual(ids.filter((id) => id !== ids[3] && id !== ids[7]));
  });

  it('refuses a pick without named cards, with the wrong count, a card twice, a card not in the pack, an opponent picking for the team, and packPass', () => {
    const s = openRound(teamDraftTable(DRAFT));
    const d = draftOf(s);
    const front = d.queues.t0![0]!;
    const ids = packRemaining(d, d.packs[front]!);
    const other = packRemaining(d, d.packs[d.queues.t0![1]!]!);
    no(s, act('pick', { packId: front, count: 2 }, 's0'), /names the cards/);
    no(s, act('pick', { packId: front, count: 1, cards: [ids[0]!] }, 's0'), /takes 2 cards/);
    no(s, act('pick', { packId: front, count: 2, cards: [ids[0]!] }, 's0'), /takes 2 cards/);
    no(s, act('pick', { packId: front, count: 2, cards: [ids[0]!, ids[0]!] }, 's0'), /twice/);
    no(s, act('pick', { packId: front, count: 2, cards: [ids[0]!, other[0]!] }, 's0'), /not in pack/);
    no(s, act('pick', { packId: d.queues.t0![1]!, count: 2, cards: other.slice(0, 2) }, 's0'), /picks from pack .* first/);
    // Cleo is on the other team: her front pack is t1's, not this one.
    no(s, act('pick', { packId: front, count: 2, cards: ids.slice(0, 2) }, 's2'), /picks from pack .* first/);
    no(s, act('packPass', { packId: front, to: 't1', count: 15 }, 's0'), /by itself/);
    const after = ok(s, act('pick', { packId: front, count: 2, cards: ids.slice(0, 2) }, 's0'));
    // A card the team already took cannot be taken again by the other team.
    const t1front = draftOf(after).queues.t1![0]!;
    no(after, act('pick', { packId: front, count: 2, cards: ids.slice(0, 2) }, 's2'), /picks from pack .* first|not in pack/);
    expect(t1front).not.toBe(front);
  });

  it('a full draft of 6 packs per team takes 3 rounds, alternates turns at each pack team to team, and leaves every card in exactly one team pool', () => {
    let s = teamDraftTable(DRAFT);
    const allIds = new Set<string>();
    let rounds = 0;
    const holders = new Map<string, string[]>();
    while (!draftOf(s).done) {
      expect(draftOf(s).round).toBe(rounds);
      s = openRound(s);
      for (const p of Object.values(draftOf(s).packs)) for (const id of p.commitment.instanceIds) allIds.add(id);
      expect(Object.values(draftOf(s).packs).filter((p) => p.number === rounds)).toHaveLength(4);
      while (!draftOf(s).done && draftOf(s).round === rounds) {
        for (const team of ['t0', 't1']) {
          const q = draftOf(s).queues[team]!;
          if (q.length === 0) continue;
          holders.set(q[0]!, [...(holders.get(q[0]!) ?? []), team]);
          // Alternate which teammate picks.
          const by = draftOf(s).pools[team]! % 4 === 0 ? (team === 't0' ? 's0' : 's2') : team === 't0' ? 's1' : 's3';
          s = pickFront(s, team, by);
        }
      }
      rounds++;
    }
    expect(rounds).toBe(3);
    const d = draftOf(s);
    expect(Object.keys(d.packs)).toHaveLength(12);
    expect(allIds.size).toBe(12 * 15);
    const taken = [...d.taken!.t0!, ...d.taken!.t1!];
    expect(taken).toHaveLength(allIds.size);
    expect(new Set(taken)).toEqual(allIds);
    expect(d.pools).toEqual({ t0: 90, t1: 90 });
    // 15 cards at 2 a pick: eight visits (2, 2, …, 2, 1), alternating between the teams from the opener's team.
    for (const [packId, visits] of holders) {
      expect(visits).toHaveLength(8);
      const opener = s.seats[d.packs[packId]!.opener]!.team!;
      visits.forEach((team, k) => expect(team).toBe(k % 2 === 0 ? opener : opener === 't0' ? 't1' : 't0'));
    }
    for (const p of Object.values(d.packs)) expect(p).toMatchObject({ count: 0, holder: null });
  });

  it('the pick timer times the team\'s front pack, and its fallback timeout takes the first remaining ids for the team', () => {
    let s = openRound(teamDraftTable(DRAFT, ['M19'], true));
    const deadlines = draftDeadlines(s);
    expect(deadlines.map((x) => x.emit[0])).toEqual(
      ['t0', 't1'].map((t) => ({ type: 'draftTimeout', packId: draftOf(s).queues[t]![0], picks: 0 })),
    );
    // The team's browsers pick the marked or first cards at expiry; the sequencer's timeout comes after a grace.
    expect(deadlines.map((x) => x.afterMs)).toEqual([pickTimerMs(0) + TEAM_PICK_GRACE_MS, pickTimerMs(0) + TEAM_PICK_GRACE_MS]);
    const front = draftOf(s).queues.t1![0]!;
    const before = packRemaining(draftOf(s), draftOf(s).packs[front]!);
    s = ok(s, act('draftTimeout', { packId: front, picks: 0 }, 's0'));
    expect(draftOf(s).taken?.t1).toEqual(before.slice(0, 2));
    expect(draftOf(s).packs[front]!.holder).toBe('t0');
    no(s, act('draftTimeout', { packId: front, picks: 0 }, 's0'), /not waiting|over/);
    no(openRound(teamDraftTable(DRAFT)), act('draftTimeout', { packId: front, picks: 0 }, 's0'), /pick timer is off|unknown pack/);
  });
});

describe('Two-Headed Giant draft: sets per team pack and frozen members', () => {
  // DESIGN Lobby settings: "set per pack (… a different set per pack is allowed)"; the lobby offers one slot per team pack.
  const SETS = ['M19', 'M20', 'DOM', 'GRN', 'RNA', 'WAR'];

  /** Every pack of the running round goes round its tables until the round ends (t0 picks by s0, t1 by s2). */
  function drainRound(state: TableState): TableState {
    let s = state;
    const round = draftOf(s).round;
    while (!draftOf(s).done && draftOf(s).round === round && (draftOf(s).queues.t0!.length > 0 || draftOf(s).queues.t1!.length > 0)) {
      for (const team of ['t0', 't1']) if (draftOf(s).queues[team]!.length > 0) s = pickFront(s, team, team === 't0' ? 's0' : 's2');
    }
    return s;
  }

  it('member j of m opens team pack round · m + j, of that slot\'s set, not the round\'s', () => {
    expect([0, 1, 2].flatMap((round) => [0, 1].map((j) => teamDraftPackIndex(2, j, round)))).toEqual([0, 1, 2, 3, 4, 5]);
    let s = teamDraftTable(DRAFT, SETS);
    for (let round = 0; round < 3; round++) {
      expect(draftOf(s).round).toBe(round);
      for (const [seat, j] of [['s0', 0], ['s1', 1], ['s2', 0], ['s3', 1]] as const) {
        const want = SETS[round * 2 + j]!;
        // The round's set (the old reading) is refused unless it is the slot's.
        if (SETS[round] !== want) expect(() => open(s, seat, cards(4), round, SETS[round])).toThrow(new RegExp(`team pack ${round * 2 + j + 1} is of set ${want}`));
        const o = open(s, seat, cards(4), round, want);
        s = o.state;
        expect(draftOf(s).packs[o.packId]!.set).toBe(want);
      }
      s = drainRound(s);
    }
    expect(draftOf(s).done).toBe(true);
    expect(Object.values(draftOf(s).packs).map((p) => p.set).sort()).toEqual([...SETS, ...SETS].sort());
  });

  it('a member who leaves the chair keeps the place: the round waits for their pack, and the team keeps its 3 rounds and set slots', () => {
    let s = teamDraftTable(DRAFT, SETS);
    for (const [seat, j] of [['s0', 0], ['s1', 1], ['s2', 0], ['s3', 1]] as const) s = open(s, seat, cards(4), 0, SETS[j]).state;
    // Ben leaves his chair after opening his round-1 pack.
    s = ok(s, act('seatLeave', { seat: 's1' }, 's1'));
    expect(teamMembers(s, 't0')).toEqual(['s0']);
    expect(draftMembers(s, draftOf(s), 't0')).toEqual(['s0', 's1']);
    s = drainRound(s);
    expect(draftOf(s).round).toBe(1);
    // Anna still opens team pack 3 (DOM), not pack 2 as a one-member team would, and Ben's turn is not hers.
    expect(() => open(s, 's0', cards(4), 1, 'M20')).toThrow(/set DOM/);
    for (const [seat, j] of [['s0', 0], ['s2', 0], ['s3', 1]] as const) s = open(s, seat, cards(4), 1, SETS[2 + j]).state;
    s = drainRound(s);
    // Three of the round's four packs are empty: the round waits for Ben's.
    expect(draftOf(s).round).toBe(1);
    expect(draftOf(s).done).toBe(false);
    no(s, act('packOpen', { packId: 'x', commits: [], count: 0 }, 's1'), /not seated/);
    s = ok(s, act('seatTake', { seat: 's1', name: 'Ben', colour: 1, peer: 'p1' }, 's1'));
    s = open(s, 's1', cards(4), 1, 'GRN').state;
    s = drainRound(s);
    expect(draftOf(s).round).toBe(2);
    for (const [seat, j] of [['s0', 0], ['s1', 1], ['s2', 0], ['s3', 1]] as const) s = open(s, seat, cards(4), 2, SETS[4 + j]).state;
    s = drainRound(s);
    expect(draftOf(s).done).toBe(true);
    expect(draftOf(s).pools).toEqual({ t0: 24, t1: 24 });
  });
});

describe('Two-Headed Giant tables: teams from the start and from formatSet agree', () => {
  it('a room created as 2hg and a 1v1 table switched to 2hg in the lobby give the same seats the same teams', () => {
    const fresh = freshNetTable(mtg, '2hg');
    let s = freshNetTable(mtg, '1v1');
    s = ok(s, act('seatTake', { seat: 's0', name: 'Anna', colour: 0, peer: 'p0' }, 's0'));
    s = ok(s, act('formatSet', { format: '2hg', life: 30 }, 's0'));
    const teamsOf = (t: TableState): Record<string, string | undefined> => Object.fromEntries(Object.values(t.seats).map((x) => [x.id, x.team]));
    expect(teamsOf(s)).toEqual(teamsOf(fresh));
    expect(teamsOf(s)).toEqual({ s0: 't0', s1: 't0', s2: 't1', s3: 't1' });
    expect(Object.values(s.teams).map((t) => [t.id, t.seats])).toEqual(Object.values(fresh.teams).map((t) => [t.id, t.seats]));
  });
});

describe('Two-Headed Giant sealed', () => {
  it('each member opens half of the team\'s 8 packs in order; the cards go to the team pool; done when both teams opened all', () => {
    expect(teamSealedNumbers(8, 2, 0)).toEqual([0, 2, 4, 6]);
    expect(teamSealedNumbers(8, 2, 1)).toEqual([1, 3, 5, 7]);
    let s = teamDraftTable(SEALED, ['M19', 'M20']);
    expect(draftOf(s).drafters).toEqual(['t0', 't1']);
    // s1's first pack is team pack 2 (number 1), of the second set.
    expect(() => open(s, 's1', cards(15), 0)).toThrow(/team pack 2/);
    expect(() => open(s, 's1', cards(15), 1, 'M19')).toThrow(/set M20/);
    for (let k = 0; k < 4; k++) {
      for (const [seat, j] of [['s0', 0], ['s1', 1], ['s2', 0], ['s3', 1]] as const) {
        const n = k * 2 + j;
        s = open(s, seat, cards(15), n, n === 0 ? 'M19' : 'M20').state;
      }
      expect(draftOf(s).done).toBe(k === 3);
    }
    const d = draftOf(s);
    expect(d.pools).toEqual({ t0: 120, t1: 120 });
    expect(Object.values(d.packs).every((p) => p.holder === null && p.count === 0)).toBe(true);
    expect(() => open(s, 's0', cards(15), 8)).toThrow();
    no(s, act('pick', { packId: Object.keys(d.packs)[0]!, count: 1 }, 's0'), /sealed has no picks|over/);
  });
});

describe('Two-Headed Giant drafts in the lobby', () => {
  it('are playable with four seated players in two teams, and refused without teams', () => {
    const t = teamTable();
    expect(formatSeatProblem(t, DRAFT)).toBeNull();
    expect(formatSeatProblem(t, SEALED)).toBeNull();
    const noTeams = { ...t, seats: Object.fromEntries(Object.entries(t.seats).map(([k, v]) => [k, { ...v, team: 't0' }])) };
    expect(formatSeatProblem(noTeams, DRAFT)).toMatch(/two teams/);
  });
});
