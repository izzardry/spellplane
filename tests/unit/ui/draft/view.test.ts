/**
 * The draft HUD's model (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction: waiting packs queue
 * visibly behind each seat so everyone sees who is holding things up; Rochester and Grid on the shared table;
 * "Specification: card data, packs and draft formats": pass direction left, right, left; pick timer 45 s − 3 s per
 * pick, 10 s floor), driven by the simulated draft of ui/draft/fakes.ts.
 */
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../../src/core/types';
import type { CardData } from '../../../../src/data/types';
import { DraftSim, LocalTable } from '../../../../src/ui/draft/fakes';
import { formatClock, remainingMs, SeqClock } from '../../../../src/ui/draft/timer';
import { draftStatus, liveMarks, onSharedTable, Prefetch, seatChips, shownSids, stepMark, surfaceView, waitingCounts, winstonSummary } from '../../../../src/ui/draft/view';
import m19 from '../../../fixtures/scryfall/m19.json';

const CARDS = m19 as unknown as CardData[];

function passDraft(names = ['Anna', 'Ben', 'Cleo'], extra: Partial<ConstructorParameters<typeof DraftSim>[1]> = {}) {
  const table = new LocalTable(names);
  const sim = new DraftSim(table, { format: 'pass', cards: CARDS, packSize: 4, ...extra });
  sim.start();
  return { table, sim };
}

describe('waiting packs per seat (DESIGN: "Waiting packs queue visibly behind each seat")', () => {
  it('counts the packs at each seat, the one being picked from included, and follows the passes', () => {
    const { table, sim } = passDraft();
    expect(waitingCounts(table.state)).toEqual({ s0: 1, s1: 1, s2: 1 });
    expect(sim.pick('s0', [sim.front('s0')!.cards[0]!.id])).toBe(true);
    // Round 1 passes left: Anna's pack goes to Ben.
    expect(waitingCounts(table.state)).toEqual({ s0: 0, s1: 2, s2: 1 });
    sim.autoPick('s1');
    expect(waitingCounts(table.state)).toEqual({ s0: 0, s1: 1, s2: 2 });
    sim.autoPick('s2');
    sim.autoPick('s2');
    expect(waitingCounts(table.state)).toEqual({ s0: 2, s1: 1, s2: 0 });
  });

  it('the seat strip names who the table waits for, with pack and pool counts', () => {
    const { table, sim } = passDraft();
    sim.pick('s0', [sim.front('s0')!.cards[0]!.id]);
    const chips = seatChips(table.state, sim.view('s0'), 's0');
    expect(chips.map((c) => [c.seat, c.packs, c.picking, c.pool, c.self])).toEqual([
      ['s0', 0, false, 1, true],
      ['s1', 2, true, 0, false],
      ['s2', 1, true, 0, false],
    ]);
    const st = draftStatus(table.state, sim.view('s0'), 's0');
    expect(st.prompt).toBe('Waiting for a pack: Ben and Cleo are picking.');
    expect(st.myTurn).toBe(false);
  });

  it('team drafters (Two-Headed Giant) show the team’s queue at each of its seats; no draft shows nothing', () => {
    const table = new LocalTable(['Anna', 'Ben', 'Cleo', 'Dan'], '2hg');
    expect(waitingCounts(table.state)).toEqual({});
    const st: TableState = structuredClone(table.state);
    const teams = ['t0', 't1'];
    for (const [seat, s] of Object.entries(st.seats)) s.team = seat === 's0' || seat === 's1' ? 't0' : 't1';
    st.draft = {
      settings: { format: 'teamDraft', packs: 6, picks: 2 },
      sets: ['M19'],
      pickTimer: false,
      drafters: teams,
      round: 0,
      packs: {},
      queues: { [teams[0]!]: ['a', 'b'], [teams[1]!]: [] },
      pools: { [teams[0]!]: 0, [teams[1]!]: 0 },
      startSeq: 1,
      done: false,
    };
    const counts = waitingCounts(st);
    expect(counts).toEqual({ s0: 2, s1: 2, s2: 0, s3: 0 });
  });
});

describe('status line (DESIGN "Pre-game", Drafting interaction; Draft formats: direction left, right, left)', () => {
  it('pack, pick number and direction: left in the first round, right in the second, left in the third', () => {
    const { table, sim } = passDraft(['Anna', 'Ben'], { packSize: 2 });
    const titles: string[] = [];
    for (let round = 0; round < 3; round++) {
      titles.push(draftStatus(table.state, sim.view('s0'), 's0').title);
      expect(draftStatus(table.state, sim.view('s0'), 's0').step).toBe('Pick 1');
      for (let k = 0; k < 2; k++) {
        sim.autoPick('s0');
        sim.autoPick('s1');
      }
    }
    expect(titles).toEqual(['Booster draft · pack 1 of 3 · passing left', 'Booster draft · pack 2 of 3 · passing right', 'Booster draft · pack 3 of 3 · passing left']);
    expect(table.state.draft!.done).toBe(true);
    expect(draftStatus(table.state, sim.view('s0'), 's0').prompt).toBe('The draft is complete.');
  });

  it('a held pack asks for a mark, then for the confirming click or Enter; Pick-Two asks for two', () => {
    const { table, sim } = passDraft();
    const id = sim.front('s0')!.cards[0]!.id;
    expect(draftStatus(table.state, sim.view('s0'), 's0')).toMatchObject({ prompt: 'Click a card to mark it, click again or press Enter to confirm.', confirmable: false, myTurn: true });
    sim.mark('s0', [id]);
    expect(draftStatus(table.state, sim.view('s0'), 's0')).toMatchObject({ prompt: 'Click the marked card again or press Enter to take it.', confirmable: true });
    // On a touch screen the prompt names taps and no keyboard (M5 gate).
    expect(draftStatus(table.state, sim.view('s0'), 's0', true)).toMatchObject({ prompt: 'Tap the marked card again to take it.', confirmable: true });
    const two = passDraft(['A', 'B', 'C', 'D'], { picks: 2, packs: 3 });
    const v = two.sim.view('s0');
    expect(draftStatus(two.table.state, v, 's0').title).toMatch(/^Pick-Two draft/);
    two.sim.mark('s0', [v.pack!.cards[0]!.id]);
    expect(draftStatus(two.table.state, two.sim.view('s0'), 's0')).toMatchObject({ prompt: 'Mark 2 cards (1 marked), then click a marked card again or press Enter.', confirmable: false });
    two.sim.mark('s0', [v.pack!.cards[0]!.id, v.pack!.cards[1]!.id]);
    expect(draftStatus(two.table.state, two.sim.view('s0'), 's0').confirmable).toBe(true);
  });

  it('Rochester: the pack lies on the shared table for everyone; only the seat whose turn it is is asked to pick', () => {
    const table = new LocalTable(['Anna', 'Ben']);
    const sim = new DraftSim(table, { format: 'rochester', cards: CARDS, packSize: 5, packs: 1 });
    sim.start();
    const mine = surfaceView(table.state, sim.view('s0'), false);
    const theirs = surfaceView(table.state, sim.view('s1'), false);
    expect(mine.pack).toMatchObject({ layout: 'fan', shared: true });
    // No packs are passed in Rochester: no waiting piles, the seat strip shows pools instead.
    expect(mine.waiting).toEqual({});
    expect(seatChips(table.state, sim.view('s0'), 's0').map((c) => [c.packs, c.picking])).toEqual([
      [null, true],
      [null, false],
    ]);
    expect(theirs.pack!.cards).toEqual(mine.pack!.cards);
    expect(draftStatus(table.state, sim.view('s1'), 's1')).toMatchObject({ prompt: 'Anna is picking.', myTurn: false });
    expect(draftStatus(table.state, sim.view('s0'), 's0').myTurn).toBe(true);
    // Not Ben's turn: refused; snake order Anna, Ben, Ben, Anna.
    expect(sim.autoPick('s1')).toBe(false);
    expect(sim.autoPick('s0')).toBe(true);
    expect(sim.autoPick('s1')).toBe(true);
    expect(sim.autoPick('s1')).toBe(true);
    expect(sim.autoPick('s0')).toBe(true);
    expect(sim.picks.map((p) => p.seat)).toEqual(['s0', 's1', 's1', 's0']);
  });

  it('Grid: the 3×3 comes from shared state; the first player takes, then the second; taken cells are gaps', () => {
    const table = new LocalTable(['Anna', 'Ben']);
    const sim = new DraftSim(table, { format: 'grid', cards: CARDS, grids: 2 });
    sim.start();
    const v = surfaceView(table.state, sim.view('s1'), false);
    expect(v.pack).toMatchObject({ layout: 'grid', shared: true, packId: 'grid:0' });
    expect(v.pack!.cards).toHaveLength(9);
    expect(draftStatus(table.state, sim.view('s0'), 's0')).toMatchObject({ prompt: 'Your turn: take a row or a column.', step: 'Grid 1 of 2' });
    expect(sim.gridTake('s1', 'row', 0)).toBe(false);
    expect(sim.gridTake('s0', 'row', 0)).toBe(true);
    const after = surfaceView(table.state, sim.view('s1'), false);
    expect(after.pack!.cards.slice(0, 3)).toEqual([null, null, null]);
    expect(draftStatus(table.state, sim.view('s0'), 's0').prompt).toBe('Ben is choosing.');
    expect(sim.gridTake('s1', 'row', 0)).toBe(false);
    expect(sim.gridTake('s1', 'col', 1)).toBe(true);
    // Next grid: Ben takes first.
    expect(table.state.draft!.grid).toMatchObject({ index: 1, first: 's1', taken: [] });
    expect(sim.view('s0').pool).toHaveLength(3);
    expect(sim.view('s1').pool).toHaveLength(2);
  });

  it('the surface sees only marks of the pack it shows', () => {
    const { table, sim } = passDraft();
    const v = { ...sim.view('s0'), marked: ['not-in-pack', sim.front('s0')!.cards[1]!.id] };
    expect(surfaceView(table.state, v, true)).toMatchObject({ marked: [sim.front('s0')!.cards[1]!.id], reducedMotion: true, picks: 1 });
  });

  it('a stale mark (a Rochester card another seat took) counts nowhere: not confirmable, the prompt asks for a mark', () => {
    // Anna marks X; Ben takes X. A driver that keeps the stale mark must not make the HUD offer to confirm it.
    const table = new LocalTable(['Anna', 'Ben']);
    const sim = new DraftSim(table, { format: 'rochester', cards: CARDS, packSize: 5, packs: 1 });
    sim.start();
    const x = sim.front('s0')!.cards[0]!.id;
    expect(sim.autoPick('s0')).toBe(true);
    // Ben's turn twice (snake order Anna, Ben, Ben, Anna): he takes the next card; then Anna marks a card Ben takes.
    expect(sim.autoPick('s1')).toBe(true);
    const y = sim.front('s1')!.cards[0]!.id;
    expect(sim.autoPick('s1')).toBe(true);
    const stale = { ...sim.view('s0'), marked: [y] };
    expect(stale.pack!.cards.some((c) => c.id === y)).toBe(false);
    expect(liveMarks(stale)).toEqual([]);
    expect(surfaceView(table.state, stale, false).marked).toEqual([]);
    expect(draftStatus(table.state, stale, 's0')).toMatchObject({ confirmable: false, prompt: 'Click a card to mark it, click again or press Enter to confirm.', myTurn: true });
    // A live mark next to the stale one still counts.
    const live = sim.front('s0')!.cards[0]!.id;
    const mixed = { ...sim.view('s0'), marked: [y, live] };
    expect(liveMarks(mixed)).toEqual([live]);
    expect(draftStatus(table.state, mixed, 's0').confirmable).toBe(true);
    expect(x).not.toBe(y);
  });

  it('Pick-Two: a stale mark does not count toward the two', () => {
    const { table, sim } = passDraft(['Anna', 'Ben'], { picks: 2 });
    const [a] = sim.front('s0')!.cards;
    const v = { ...sim.view('s0'), marked: ['gone', a!.id] };
    expect(draftStatus(table.state, v, 's0')).toMatchObject({ confirmable: false, prompt: 'Mark 2 cards (1 marked), then click a marked card again or press Enter.' });
  });

  it('Winston: the pile is shown, but takes no single card (picks 0); the turn alternates on take', () => {
    const table = new LocalTable(['Anna', 'Ben']);
    const sim = new DraftSim(table, { format: 'winston', cards: CARDS, packs: 1, packSize: 10 });
    sim.start();
    const v = surfaceView(table.state, sim.view('s0'), false);
    expect(v.pack).toMatchObject({ layout: 'fan', shared: false, packId: 'pile:0' });
    expect(v.pack!.cards).toHaveLength(1);
    expect(v.picks).toBe(0);
    // DESIGN mode table, Winston: "A shared face-down stack and three piles": the pile is named, and the status line
    // shows the stack and every pile's size.
    expect(v.packLabel).toBe('Pile 1');
    expect(onSharedTable(v)).toBe(false);
    expect(winstonSummary(table.state)).toBe(`Stack ${table.state.draft!.winston!.stack} · piles 1, 1, 1`);
    expect(draftStatus(table.state, sim.view('s0'), 's0').step).toBe(winstonSummary(table.state));
    expect(draftStatus(table.state, sim.view('s1'), 's1').step).toBe(winstonSummary(table.state));
    expect(draftStatus(table.state, sim.view('s0'), 's0')).toMatchObject({ prompt: 'Your turn: take this pile, or add a card to it and look at the next.', confirmable: false });
    expect(sim.view('s1').pile).toBeUndefined();
    expect(sim.pileLook('s1', true)).toBe(false);
    expect(sim.pileLook('s0', false)).toBe(true);
    expect(surfaceView(table.state, sim.view('s0'), false)).toMatchObject({ pack: { packId: 'pile:1' }, packLabel: 'Pile 2' });
    expect(winstonSummary(table.state)).toMatch(/ · piles 2, 1, 1$/);
    expect(sim.pileLook('s0', true)).toBe(true);
    expect(sim.view('s0').pool).toHaveLength(1);
    expect(table.state.draft!.winston).toMatchObject({ active: 's1', pile: 0, piles: [2, 1, 1] });
  });

  it('the grid takes no single card either (picks 0)', () => {
    const table = new LocalTable(['Anna', 'Ben']);
    const sim = new DraftSim(table, { format: 'grid', cards: CARDS, grids: 1 });
    sim.start();
    const v = surfaceView(table.state, sim.view('s0'), false);
    expect(v.picks).toBe(0);
    // The grid lies on the shared table: cursors are shared over it; no label beyond the surface's own.
    expect(onSharedTable(v)).toBe(true);
    expect(v.packLabel).toBeUndefined();
    expect(winstonSummary(table.state)).toBe('');
  });

  it('cursors are shared over a Rochester pack only, never over a pack passed in private', () => {
    const roch = new LocalTable(['Anna', 'Ben']);
    const rsim = new DraftSim(roch, { format: 'rochester', cards: CARDS, packs: 1, packSize: 6 });
    rsim.start();
    expect(onSharedTable(surfaceView(roch.state, rsim.view('s1'), false))).toBe(true);
    const { table, sim } = passDraft();
    expect(onSharedTable(surfaceView(table.state, sim.view('s0'), false))).toBe(false);
  });

  it('sealed: the pool opens at once and the prompt says so', () => {
    const table = new LocalTable(['Anna', 'Ben']);
    const sim = new DraftSim(table, { format: 'sealed', cards: CARDS, packs: 6 });
    sim.start();
    expect(sim.view('s0').pool).toHaveLength(90);
    expect(draftStatus(table.state, sim.view('s0'), 's0').prompt).toBe('The draft is complete.');
  });

  it('card data is requested once for every card shown', () => {
    const { table, sim } = passDraft();
    const sids = shownSids(table.state, sim.view('s0'));
    expect(sids.length).toBe(4);
    const p = new Prefetch();
    expect(p.take(sids, () => false)).toEqual(sids);
    expect(p.take(sids, () => false)).toEqual([]);
    expect(new Prefetch().take(sids, (s) => s === sids[0])).toEqual(sids.slice(1));
  });
});

describe('pick timer display (DESIGN "Specification: card data, packs and draft formats": 45 s, 3 s less per pick, 10 s floor)', () => {
  it('runs from the moment this browser applied the pack’s seq and counts down to 0:00', () => {
    const { table, sim } = passDraft(['Anna', 'Ben'], { pickTimer: true, packSize: 15 });
    const clock = new SeqClock();
    clock.observe(table.state.seq, 1000);
    const v = sim.view('s0');
    expect(v.timer).toEqual({ fromSeq: table.state.draft!.packs[v.pack!.packId]!.sinceSeq, ms: 45_000 });
    expect(remainingMs(v.timer, clock, 1000)).toBe(45_000);
    expect(formatClock(remainingMs(v.timer, clock, 1000 + 12_300)!)).toBe('0:33');
    expect(remainingMs(v.timer, clock, 1000 + 60_000)).toBe(0);
    expect(formatClock(0)).toBe('0:00');
    // The next pack has one pick taken: 42 s.
    sim.autoPick('s0');
    sim.autoPick('s1');
    clock.observe(table.state.seq, 5000);
    const w = sim.view('s0');
    expect(w.timer!.ms).toBe(42_000);
    expect(remainingMs(w.timer, clock, 5000)).toBe(42_000);
  });

  it('a seq this page has not seen yet shows the full time; one older than all it saw (a reload) counts from the first sighting', () => {
    const clock = new SeqClock();
    expect(remainingMs({ fromSeq: 5, ms: 30_000 }, clock, 100)).toBe(30_000);
    clock.observe(9, 1000);
    clock.observe(12, 4000);
    clock.observe(11, 9000);
    expect(clock.appliedAt(5)).toBe(1000);
    expect(clock.appliedAt(10)).toBe(4000);
    expect(clock.appliedAt(13)).toBeNull();
    expect(remainingMs(null, clock, 0)).toBeNull();
    expect(formatClock(9_001)).toBe('0:10');
    expect(formatClock(75_000)).toBe('1:15');
  });
});

describe('keyboard marking (DESIGN "Input and interaction design", Accessibility: every card action from the keyboard)', () => {
  const cards = ['a', 'b', 'c', 'd'];
  it('arrows mark the first or last card, then move the mark, wrapping', () => {
    expect(stepMark(cards, [], 1, 1, false)).toEqual(['a']);
    expect(stepMark(cards, [], 1, -1, false)).toEqual(['d']);
    expect(stepMark(cards, ['a'], 1, 1, false)).toEqual(['b']);
    expect(stepMark(cards, ['d'], 1, 1, false)).toEqual(['a']);
    expect(stepMark(cards, ['a'], 1, -1, false)).toEqual(['d']);
  });
  it('with Shift the next card joins the marks up to the picks per pass; moving skips marked cards', () => {
    expect(stepMark(cards, ['a'], 2, 1, true)).toEqual(['a', 'b']);
    expect(stepMark(cards, ['a', 'b'], 2, 1, true)).toEqual(['b', 'c']);
    expect(stepMark(cards, ['a', 'b'], 2, 1, false)).toEqual(['a', 'c']);
    expect(stepMark(cards, ['b', 'a'], 2, 1, false)).toEqual(['b', 'c']);
    expect(stepMark(['a'], ['a'], 1, 1, false)).toEqual(['a']);
    expect(stepMark([], ['a'], 1, 1, false)).toEqual([]);
    expect(stepMark(cards, ['gone'], 1, 1, false)).toEqual(['a']);
  });
});
