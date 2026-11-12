/**
 * The evening's stage machine (PLAN M2-P7; DESIGN "Specification: card data, packs and draft formats", Evening stages:
 * `lobby → draft → build → match → build → match …`; the host advances from lobby, the draft advances automatically,
 * build advances when all seated players are Ready, from a match any player proposes "next game" or "new draft" and
 * the others confirm; "Pre-game", Deck building: between games players return to the builder to sideboard).
 *
 * Every state here is reached through the real reducer, except a finished draft (its picks are M2-P2's and M2-P3's
 * business), which is set on the state directly.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { createDraftState } from '../../../src/core/drafting';
import { canonicalJson } from '../../../src/core/hash';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { actingHost, enterStage, FORMAT_SEATS, GAME_START, STAGE_EDGES, STAGE_ROUND_LABELS, STAGES, stageProblem } from '../../../src/core/stage';
import type { Format, LobbySettings, SeatId, Stage, TableState } from '../../../src/core/types';
import { DRAFT_PRESETS } from '../../../src/draft/types';
import { mtg } from '../../../src/games/index';

let cid = 0;
function stamp(by: SeatId, a: ActionDraft, seq: number): Action {
  return { ...a, by, cid: `c${++cid}`, seq } as Action;
}

/** Apply an action that must apply (fails with the reducer's reason otherwise). */
function ok(s: TableState, by: SeatId, a: ActionDraft): TableState {
  const action = stamp(by, a, s.seq + 1);
  expect(explain(s, action), `${a.type} by ${by}`).toBeNull();
  return reduce(s, action);
}

/** An action that must not apply: the same state back, and the reason. */
function no(s: TableState, by: SeatId, a: ActionDraft, reason?: RegExp): string {
  const action = stamp(by, a, s.seq + 1);
  expect(reduce(s, action)).toBe(s);
  const why = explain(s, action) ?? '';
  expect(why).not.toBe('');
  if (reason) expect(why).toMatch(reason);
  return why;
}

const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];
const FORMATS: Record<number, Format> = { 2: '1v1', 3: 'ffa3', 4: 'ffa4' };

/** A table of `seated` players (of `chairs` chairs) in the lobby. */
function table(seated: number, chairs = seated): TableState {
  return createTable({ game: mtg, format: FORMATS[chairs]!, seats: Array.from({ length: chairs }, (_, i) => ({ name: i < seated ? NAMES[i]! : '', colour: i, peer: `p${i}` })) });
}

function withLobby(s: TableState, lobby: Partial<LobbySettings>): TableState {
  return ok(s, 's0', { type: 'lobbySet', lobby: { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false, ...lobby } });
}

/** Ready with a two-card deck (commitments and two library instances). */
function ready(s: TableState, seat: SeatId): TableState {
  return ok(s, seat, { type: 'ready', commits: [`h-${seat}-1`, `h-${seat}-2`], instanceIds: [`${seat}-a`, `${seat}-b`], zone: `library:${seat}` });
}

/** A two-seat table in the build stage of a finished draft. */
function inBuild(): TableState {
  let s = ok(withLobby(table(2), {}), 's0', { type: 'stageSet', stage: 'draft' });
  s = { ...s, draft: { ...s.draft!, done: true } };
  return ok(s, 's1', { type: 'stageSet', stage: 'build' });
}

/** Both Ready in the build stage and the match started; a game played a little (draw, life, a token, a line, an ask). */
function inMatch(): TableState {
  let s = inBuild();
  s = ok(ready(ready(s, 's0'), 's1'), 's0', { type: 'stageSet', stage: 'match' });
  s = ok(s, 's0', { type: 'draw', instanceId: 's0-a' });
  s = ok(s, 's1', { type: 'life', seat: 's1', delta: -6 });
  s = ok(s, 's0', { type: 'createToken', card: 'tok1', ref: { sid: 'goblin' }, zone: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
  s = ok(s, 's0', { type: 'lineAdd', line: 'l1', kind: 'mark', from: { kind: 'card', id: 'tok1' }, to: { kind: 'seat', id: 's1' } });
  s = ok(s, 's1', { type: 'playerCounter', seat: 's1', kind: 'poison', delta: 2 });
  return s;
}

/** A passed round proposing `event`, asked by `by`. */
function proposed(s: TableState, by: SeatId, event: keyof typeof STAGE_ROUND_LABELS, round = `r-${event}`): TableState {
  s = ok(s, by, { type: 'ask', round, label: STAGE_ROUND_LABELS[event] });
  for (const seat of Object.keys(s.seats).filter((id) => id !== by && s.seats[id]!.name !== '')) s = ok(s, seat, { type: 'respond', round, seat, response: 'ok' });
  return s;
}

describe('the edges of the evening', () => {
  it('refuses every move that is not an edge, and staying put', () => {
    const at: Record<Stage, TableState> = { lobby: withLobby(table(2), {}), draft: ok(withLobby(table(2), {}), 's0', { type: 'stageSet', stage: 'draft' }), build: inBuild(), match: inMatch() };
    for (const from of STAGES) {
      no(at[from], 's0', { type: 'stageSet', stage: from }, /already/);
      for (const to of STAGES) if (to !== from && !STAGE_EDGES[from].includes(to)) no(at[from], 's0', { type: 'stageSet', stage: to }, /does not go/);
    }
    no(at.lobby, 's0', { type: 'stageSet', stage: 'pub' as Stage }, /invalid stage/);
  });

  it('only a seated player moves the evening on', () => {
    const s = withLobby(table(2, 4), {});
    no(s, 's3', { type: 'stageSet', stage: 'draft' }, /seated/);
    no(s, 'x9', { type: 'stageSet', stage: 'draft' }, /seated/);
  });
});

describe('lobby: the host starts', () => {
  it('starts the draft the lobby chose, with the draft state, on a cleared table', () => {
    let s = withLobby(table(3), { draft: { format: 'pass', packs: 2, picks: 1 }, sets: ['M19', 'M20'] });
    s = ready(s, 's1'); // a deck committed in the lobby does not survive into the draft
    no(s, 's1', { type: 'stageSet', stage: 'draft' }, /host/);
    const d = ok(s, 's0', { type: 'stageSet', stage: 'draft' });
    expect(d.stage).toBe('draft');
    expect(d.draft).toEqual(createDraftState(s, s.lobby!, s.seq + 1));
    expect(d.draft!.drafters).toEqual(['s0', 's1', 's2']);
    expect(d.draft!.startSeq).toBe(d.seq);
    expect(d.commitments).toEqual({});
    expect(Object.keys(d.cards)).toEqual([]);
    expect(d.seats.s1!.ready).toBe(false);
    expect(d.games).toBeUndefined();
  });

  it('an away host is skipped: the next seated player present is the host', () => {
    let s = withLobby(table(2), {});
    s = ok(s, 's1', { type: 'away', seat: 's0', away: true });
    expect(actingHost(s)).toBe('s1');
    no(s, 's0', { type: 'stageSet', stage: 'draft' }, /host/);
    expect(ok(s, 's1', { type: 'stageSet', stage: 'draft' }).stage).toBe('draft');
  });

  it('refuses a draft the seated players do not suit, and a lobby without a draft', () => {
    for (const p of Object.values(DRAFT_PRESETS)) {
      for (const n of [2, 3, 4]) {
        const s = withLobby(table(n), { draft: p.settings });
        const range = FORMAT_SEATS[p.settings.format];
        const fits = n >= range.min && n <= range.max && p.settings.format !== 'teamDraft' && p.settings.format !== 'teamSealed';
        const why = explain(s, stamp('s0', { type: 'stageSet', stage: 'draft' }, s.seq + 1));
        expect(why === null, `${p.id} with ${n}: ${why}`).toBe(fits);
      }
    }
    no(withLobby(table(3), { draft: { format: 'winston', packs: 6 } }), 's0', { type: 'stageSet', stage: 'draft' }, /for 2 players, and 3 are seated/);
    no(withLobby(table(4), { draft: { format: 'teamDraft', packs: 6, picks: 2 } }), 's0', { type: 'stageSet', stage: 'draft' }, /Two-Headed Giant/);
    no(withLobby(table(2), { draft: null }), 's0', { type: 'stageSet', stage: 'draft' }, /constructed/);
    // A lone player cannot draft.
    no(withLobby(table(1, 2), {}), 's0', { type: 'stageSet', stage: 'draft' }, /1 is seated/);
  });

  it('goes straight to a match with constructed decks and counts the game', () => {
    let s = withLobby(table(2), { draft: null });
    s = ready(ready(s, 's0'), 's1');
    no(s, 's1', { type: 'stageSet', stage: 'match' }, /host/);
    const m = ok(s, 's0', { type: 'stageSet', stage: 'match' });
    expect(m.stage).toBe('match');
    expect(m.games).toBe(1);
    // The decks committed in the lobby stay: this is the game they were committed for.
    expect(m.commitments).toEqual(s.commitments);
    expect(m.zones['library:s0']!.ids).toEqual(s.zones['library:s0']!.ids);
  });
});

describe('draft → build → match', () => {
  it('the draft advances only once it is done; any seated player may send it', () => {
    let s = ok(withLobby(table(2), {}), 's0', { type: 'stageSet', stage: 'draft' });
    no(s, 's1', { type: 'stageSet', stage: 'build' }, /not finished/);
    s = { ...s, draft: { ...s.draft!, done: true } };
    const b = ok(s, 's1', { type: 'stageSet', stage: 'build' });
    expect(b.stage).toBe('build');
    expect(b.draft).toEqual(s.draft); // pools stay countable through build and match
  });

  it('only the host abandons a draft; the draft and its pack-seed rounds go', () => {
    let s = ok(withLobby(table(2), {}), 's0', { type: 'stageSet', stage: 'draft' });
    s = ok(s, 's1', { type: 'shuffleCommit', sid: 'pk1', zone: 'pack:s1', h: 'h', purpose: 'pack' });
    no(s, 's1', { type: 'stageSet', stage: 'lobby' }, /host/);
    const l = ok(s, 's0', { type: 'stageSet', stage: 'lobby' });
    expect(l.stage).toBe('lobby');
    expect('draft' in l).toBe(false);
    expect(l.shuffles).toEqual({});
  });

  it('build advances to the match when every seated player is Ready, and counts the game', () => {
    let s = inBuild();
    no(s, 's0', { type: 'stageSet', stage: 'match' }, /waiting for Anna, Ben/);
    s = ready(s, 's0');
    no(s, 's0', { type: 'stageSet', stage: 'match' }, /waiting for Ben/);
    s = ready(s, 's1');
    const m = ok(s, 's1', { type: 'stageSet', stage: 'match' });
    expect(m.stage).toBe('match');
    expect(m.games).toBe(1);
    expect(m.commitments).toEqual(s.commitments);
  });
});

describe('leaving a match: a player proposes, the others confirm', () => {
  it('next game needs a passed round labelled for it', () => {
    const s = inMatch();
    no(s, 's0', { type: 'stageSet', stage: 'build' }, /confirm/);
    no(s, 's0', { type: 'stageSet', stage: 'build', round: 'nope' }, /not the current/);
    // A round about something else never moves the evening.
    const other = ok(ok(s, 's0', { type: 'ask', round: 'atk', label: 'attacks?' }), 's1', { type: 'respond', round: 'atk', seat: 's1', response: 'ok' });
    no(other, 's0', { type: 'stageSet', stage: 'build', round: 'atk' }, /does not propose the next game/);
    // Asked, not yet confirmed; then held.
    const asked = ok(s, 's0', { type: 'ask', round: 'ng', label: STAGE_ROUND_LABELS.nextGame });
    no(asked, 's0', { type: 'stageSet', stage: 'build', round: 'ng' }, /not everyone/);
    const held = ok(asked, 's1', { type: 'respond', round: 'ng', seat: 's1', response: 'hold' });
    no(held, 's0', { type: 'stageSet', stage: 'build', round: 'ng' }, /not everyone/);
    // A new-draft round does not take the table to the builder, nor a next-game round to the lobby.
    no(proposed(s, 's1', 'newDraft'), 's1', { type: 'stageSet', stage: 'build', round: 'r-newDraft' }, /next game/);
    no(proposed(s, 's1', 'nextGame'), 's1', { type: 'stageSet', stage: 'lobby', round: 'r-nextGame' }, /new draft/);
  });

  it('silence counts as OK: a timed-out answer confirms too', () => {
    let s = ok(inMatch(), 's1', { type: 'ask', round: 'ng', label: STAGE_ROUND_LABELS.nextGame });
    s = ok(s, 's0', { type: 'respond', round: 'ng', seat: 's0', response: 'timeout' });
    expect(ok(s, 's1', { type: 'stageSet', stage: 'build', round: 'ng' }).stage).toBe('build');
  });

  it('next game returns to the builder with the game table cleared for sideboarding', () => {
    const s = proposed(inMatch(), 's1', 'nextGame');
    const b = ok(s, 's0', { type: 'stageSet', stage: 'build', round: 'r-nextGame' });
    expect(b.stage).toBe('build');
    expect(b.cards).toEqual({});
    for (const z of Object.values(b.zones)) {
      expect(z.ids, z.id).toEqual([]);
      if (z.visibility !== 'public') expect(z.count, z.id).toBe(0);
    }
    expect(b.stack).toEqual([]);
    expect(b.lines).toEqual({});
    expect(b.confirm).toBeNull();
    expect(b.commitments).toEqual({});
    for (const seat of Object.values(b.seats)) {
      expect(seat.ready).toBe(false);
      expect(seat.life).toBe(20);
      expect(seat.counters).toEqual({});
      expect(seat.autoPass).toBe(false);
    }
    expect(b.turn).toEqual({ number: 1, active: 's0', phase: 'untap' });
    // Kept: the chairs, the draft and its count of games.
    expect(b.draft).toEqual(s.draft);
    expect(b.games).toBe(1);
    expect(b.seats.s1!.name).toBe('Ben');
    // Game two: Ready again, and the match counts it.
    const m2 = ok(ready(ready(b, 's1'), 's0'), 's0', { type: 'stageSet', stage: 'match' });
    expect(m2.games).toBe(2);
  });

  it('a new draft from a match or the builder goes back to the lobby and drops the draft', () => {
    for (const s of [inMatch(), inBuild()]) {
      const p = proposed(s, 's1', 'newDraft');
      const l = ok(p, 's1', { type: 'stageSet', stage: 'lobby', round: 'r-newDraft' });
      expect(l.stage).toBe('lobby');
      expect('draft' in l).toBe(false);
      expect(l.cards).toEqual({});
      expect(l.commitments).toEqual({});
      expect(l.lobby).toEqual(s.lobby);
      // And the host can start the next draft on the same link.
      const d = ok(l, 's0', { type: 'stageSet', stage: 'draft' });
      expect(d.draft!.startSeq).toBe(d.seq);
      expect(d.draft!.done).toBe(false);
    }
    no(inBuild(), 's0', { type: 'stageSet', stage: 'lobby' }, /confirm/);
  });

  it('keeps the pack-seed rounds of the draft through the next game, and drops the game ones', () => {
    let s = inMatch();
    // A shuffle still open freezes its zone (M1-P2): the next game waits until it is done.
    const shuffling = ok(s, 's0', { type: 'shuffleCommit', sid: 'sh0', zone: 'library:s0', h: 'h' });
    no(proposed(shuffling, 's0', 'nextGame'), 's0', { type: 'stageSet', stage: 'build', round: 'r-nextGame' }, /being shuffled/);
    s = {
      ...s,
      shuffles: {
        ...s.shuffles,
        sh1: { id: 'sh1', zone: 'library:s0', owner: 's0', purpose: 'shuffle', h: 'h', startSeq: 4, nonces: {}, orderHash: 'o' },
        pk1: { id: 'pk1', zone: 'pack:s1', owner: 's1', purpose: 'pack', h: 'h', startSeq: 3, nonces: {}, orderHash: 'o' },
      },
    };
    s = ok(s, 's1', { type: 'rngCommit', rid: 'r1', purpose: 'die', n: 6, h: 'x' });
    const b = ok(proposed(s, 's0', 'nextGame'), 's0', { type: 'stageSet', stage: 'build', round: 'r-nextGame' });
    expect(Object.keys(b.shuffles)).toEqual(['pk1']);
    expect(b.rng).toEqual({});
  });
});

describe('purity', () => {
  it('stageSet is deterministic, total and leaves its input alone', () => {
    const s = proposed(inMatch(), 's1', 'nextGame');
    const before = canonicalJson(s);
    const a = stamp('s0', { type: 'stageSet', stage: 'build', round: 'r-nextGame' }, s.seq + 1);
    expect(canonicalJson(reduce(s, a))).toBe(canonicalJson(reduce(s, a)));
    expect(canonicalJson(s)).toBe(before);
    expect(JSON.parse(JSON.stringify(reduce(s, a)))).toEqual(reduce(s, a));
    for (const junk of [{ stage: 7 }, { stage: 'build', round: 5 }, { stage: 'build', round: null }, {}] as unknown[]) {
      expect(() => stageProblem(s, { type: 'stageSet', by: 's0', cid: 'j', ...(junk as object) } as never)).not.toThrow();
      expect(reduce(s, { type: 'stageSet', by: 's0', cid: 'j', ...(junk as object) } as never)).toBe(s);
    }
  });

  it('enterStage never changes a table already in that stage', () => {
    const s = inBuild();
    expect(enterStage(s, 'build', 99)).toBe(s);
  });

  it('the game start values match the Magic definition', () => {
    for (const f of ['1v1', 'ffa3', 'ffa4', '2hg'] as Format[]) expect(GAME_START.mtg!.life[f]).toBe(mtg.startingLife(f));
    expect(GAME_START.mtg!.phase).toBe(mtg.phases[0]!.id);
  });
});
