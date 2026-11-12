/**
 * The draft HUD's model (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction: the pack as a fan or
 * grid, click to mark and again or Enter to confirm, pool sorted by colour, waiting packs per seat; Rochester and Grid on
 * the shared table; "Specification: card data, packs and draft formats", pass direction and pick timer). Pure: maps
 * shared state plus this browser's DraftPrivateView to what the surface draws and what the status line says.
 */
import { passDirection } from '../../core/drafting';
import { seatsInOrder } from '../../core/selectors';
import type { DrafterId, DraftState, InstanceId, SeatId, TableState } from '../../core/types';
import type { DraftPrivateView } from '../../draft/types';
import { canConfirm, picksNeeded, type DraftSurfaceViewWithLabel } from '../../scene/draft';

/** The drafter a seat drafts as: the seat, or its team in the Two-Headed Giant formats (DraftState.drafters). */
export function drafterOf(state: TableState, draft: DraftState, seat: SeatId): DrafterId | null {
  if (draft.drafters.includes(seat)) return seat;
  const team = state.seats[seat]?.team;
  return team !== undefined && draft.drafters.includes(team) ? team : null;
}

/**
 * Packs at each drafting seat (DESIGN: "Waiting packs queue visibly behind each seat so everyone sees who is holding
 * things up"): the length of the seat's drafter queue in shared state, the pack being picked from included. Seats of
 * one team show the team's queue. Empty outside a draft.
 */
export function waitingCounts(state: TableState): Record<SeatId, number> {
  const draft = state.draft;
  const out: Record<SeatId, number> = {};
  if (!draft) return out;
  for (const seat of seatsInOrder(state)) {
    const d = drafterOf(state, draft, seat);
    if (d === null) continue;
    out[seat] = draft.queues[d]?.length ?? 0;
  }
  return out;
}

/** Formats whose packs travel from seat to seat and queue at the receiver (the waiting indicator applies to these). */
export function passesPacks(state: TableState): boolean {
  const f = state.draft?.settings.format;
  return f === 'pass' || f === 'teamDraft';
}

/**
 * The marks that still count: the marked cards still in the pack being picked from (a Rochester card another seat took,
 * or a stale mark the driver kept, is dropped), so the HUD, the surface and Enter agree on what a confirm takes.
 */
export function liveMarks(view: DraftPrivateView): InstanceId[] {
  if (!view.pack) return [];
  const ids = new Set(view.pack.cards.map((c) => c.id));
  return view.marked.filter((id) => ids.has(id));
}

/**
 * What the draft surface draws (scene/types.ts DraftSurfaceView); waiting packs only where packs are passed. The grid
 * and a Winston pile take no single cards, so their `picks` is 0 and the surface ignores card clicks on them. A Winston
 * pile is labelled with its number ("Pile 2"), not as the own pack.
 */
export function surfaceView(state: TableState, view: DraftPrivateView, reducedMotion: boolean): DraftSurfaceViewWithLabel {
  let pack: DraftSurfaceViewWithLabel['pack'] = null;
  let packLabel: string | undefined;
  let picks = 0;
  const grid = state.draft?.grid;
  if (view.pack) {
    picks = view.picks;
    pack = { packId: view.pack.packId, cards: view.pack.cards, layout: 'fan', shared: view.pack.public };
  } else if (view.format === 'grid' && grid && grid.cells.length === 9 && grid.cells.some((c) => c !== null)) {
    // The Grid draft's 3×3 lies face up on the shared table (DESIGN "Pre-game", Grid draft: None hidden).
    pack = { packId: `grid:${grid.index}`, cards: grid.cells, layout: 'grid', shared: true };
  } else if (view.format === 'winston' && view.pile && view.pile.length > 0) {
    const index = state.draft?.winston?.pile ?? 0;
    pack = { packId: `pile:${index}`, cards: view.pile, layout: 'fan', shared: false };
    packLabel = `Pile ${index + 1}`;
  }
  const ids = new Set((pack?.cards ?? []).filter((c) => c).map((c) => c!.id));
  return {
    pack,
    marked: view.marked.filter((id) => ids.has(id)),
    picks,
    pool: view.pool,
    waiting: passesPacks(state) ? waitingCounts(state) : {},
    reducedMotion,
    ...(packLabel ? { packLabel } : {}),
  };
}

/**
 * The Winston table at a glance (DESIGN mode table, Winston: "A shared face-down stack and three piles"): the cards left
 * in the stack and the size of each pile, e.g. "Stack 78 · piles 1, 2, 1". Empty outside a Winston draft.
 */
export function winstonSummary(state: TableState): string {
  const w = state.draft?.winston;
  if (!w) return '';
  return `Stack ${w.stack} · piles ${w.piles.join(', ')}`;
}

/** Whether the pack shown lies on the shared table (a Rochester pack, the Grid), where cursors are shared. */
export function onSharedTable(view: Pick<DraftSurfaceViewWithLabel, 'pack'>): boolean {
  return view.pack?.shared === true;
}

/** One seat in the HUD's seat strip. */
export interface SeatChip {
  seat: SeatId;
  name: string;
  colour: number;
  /** Packs at the seat (waitingCounts); null in formats that pass no packs (sealed, Rochester, Winston, Grid). */
  packs: number | null;
  /** Cards drafted so far (DraftState.pools of the seat's drafter). */
  pool: number;
  /** The table waits for this seat (DraftPrivateView.waitingOn). */
  picking: boolean;
  self: boolean;
}

export function seatChips(state: TableState, view: DraftPrivateView, self: SeatId): SeatChip[] {
  const draft = state.draft;
  if (!draft) return [];
  const counts = waitingCounts(state);
  const passing = passesPacks(state);
  const waiting = new Set(view.waitingOn);
  return Object.keys(counts).map((seat) => {
    const s = state.seats[seat]!;
    const d = drafterOf(state, draft, seat);
    return { seat, name: s.name || seat, colour: s.colour, packs: passing ? (counts[seat] ?? 0) : null, pool: d === null ? 0 : (draft.pools[d] ?? 0), picking: waiting.has(seat), self: seat === self };
  });
}

/** What the status line says. */
export interface DraftStatus {
  /** e.g. "Booster draft · pack 2 of 3 · passing right". */
  title: string;
  /** e.g. "Pick 4" or "Grid 3 of 18"; empty when not applicable. */
  step: string;
  /** What to do now, or who the table waits for. */
  prompt: string;
  /** This seat is the one the table waits for (a pick, a pile, a grid line). */
  myTurn: boolean;
  /** Enter (or the Pick button) would confirm the marked cards. */
  confirmable: boolean;
  /** The draft is over. */
  done: boolean;
}

const FORMAT_LABEL: Record<string, string> = {
  pass: 'Booster draft',
  sealed: 'Sealed',
  rochester: 'Rochester draft',
  winston: 'Winston draft',
  grid: 'Grid draft',
  teamDraft: 'Two-Headed Giant draft',
  teamSealed: 'Two-Headed Giant sealed',
};

function names(state: TableState, seats: readonly SeatId[], self: SeatId): string {
  const list = seats.map((s) => (s === self ? 'you' : state.seats[s]?.name || s));
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The status line for this seat (DESIGN "Pre-game", Drafting interaction). */
export function draftStatus(state: TableState, view: DraftPrivateView, self: SeatId): DraftStatus {
  const draft = state.draft;
  const format = view.format ?? draft?.settings.format ?? null;
  const settings = draft?.settings;
  const pick2 = settings?.format === 'pass' && settings.picks === 2 && settings.packs === 3;
  let title = format ? (pick2 ? 'Pick-Two draft' : (FORMAT_LABEL[format] ?? format)) : 'Draft';
  let step = '';
  const myTurn = view.waitingOn.includes(self);
  const others = view.waitingOn.filter((s) => s !== self);
  const done = !!draft?.done;
  const packCards = view.pack ? view.pack.cards.length : 0;
  const marked = liveMarks(view);
  const confirmable = !!view.pack && canConfirm(marked, view.picks, packCards);
  const front = view.pack && draft ? draft.packs[view.pack.packId] : undefined;

  if (draft && settings && (settings.format === 'pass' || settings.format === 'teamDraft')) {
    title += ` · pack ${Math.min(draft.round + 1, settings.packs)} of ${settings.packs} · passing ${passDirection(draft.round)}`;
  }
  if (draft && settings?.format === 'rochester' && draft.rochester) {
    title += ` · pack ${Math.min(draft.rochester.opened, settings.packs * draft.drafters.length)} of ${settings.packs * draft.drafters.length}`;
  }
  if (draft && settings?.format === 'grid' && draft.grid) step = `Grid ${draft.grid.index + 1} of ${settings.grids}`;
  if (draft?.winston && !done) step = winstonSummary(state);
  if (front) step = `Pick ${front.picks + 1}`;

  let prompt: string;
  if (done) prompt = 'The draft is complete.';
  else if (format === 'sealed' || format === 'teamSealed') prompt = view.pool.length ? 'Your sealed pool is open.' : 'Opening your packs…';
  else if (format === 'grid') prompt = myTurn ? 'Your turn: take a row or a column.' : others.length ? `${names(state, others, self)} ${others.length === 1 ? 'is' : 'are'} choosing.` : 'Laying out the next grid…';
  else if (format === 'winston') prompt = myTurn ? 'Your turn: take this pile, or add a card to it and look at the next.' : others.length ? `${names(state, others, self)} ${others.length === 1 ? 'is' : 'are'} looking at a pile.` : 'Waiting…';
  else if (view.pack && (!view.pack.public || myTurn)) {
    const need = picksNeeded(view.picks, packCards);
    if (confirmable) prompt = need === 1 ? 'Click the marked card again or press Enter to take it.' : `Click a marked card again or press Enter to take these ${need}.`;
    else if (need === 1) prompt = 'Click a card to mark it, click again or press Enter to confirm.';
    else prompt = `Mark ${need} cards (${marked.length} marked), then click a marked card again or press Enter.`;
  } else if (view.pack?.public) prompt = others.length ? `${names(state, others, self)} ${others.length === 1 ? 'is' : 'are'} picking.` : 'Waiting…';
  else prompt = others.length ? `Waiting for a pack: ${names(state, others, self)} ${others.length === 1 ? 'is' : 'are'} picking.` : 'Waiting for a pack…';
  return { title, step, prompt, myTurn: myTurn || (!!view.pack && !view.pack.public), confirmable, done };
}

/** Scryfall ids of every card the draft surface may show (pool, pack, grid, Winston pile), for card data prefetch. */
export function shownSids(state: TableState, view: DraftPrivateView): string[] {
  const sids = new Set<string>();
  for (const r of view.pool) sids.add(r.sid);
  for (const c of view.pack?.cards ?? []) sids.add(c.ref.sid);
  for (const c of state.draft?.grid?.cells ?? []) if (c) sids.add(c.ref.sid);
  for (const c of view.pile ?? []) sids.add(c.ref.sid);
  return [...sids];
}

/** Remembers which card data was requested, so each id is fetched once. */
export class Prefetch {
  private readonly requested = new Set<string>();
  /** The ids not yet requested and not cached; marks them requested. */
  take(sids: readonly string[], cached: (sid: string) => boolean): string[] {
    const out = sids.filter((s) => !this.requested.has(s) && !cached(s));
    for (const s of out) this.requested.add(s);
    return out;
  }
}

/**
 * Keyboard marking (DESIGN "Input and interaction design", Accessibility: every card action is reachable from the
 * keyboard by cycling focus through cards in a zone): the arrow keys move the latest mark to the next or previous card
 * of the pack (wrapping, skipping cards already marked); with `add` (Shift) the next card is marked as well, up to the
 * cards one confirm takes (then the oldest mark drops). With nothing marked the first (or last) card is marked.
 */
export function stepMark(cards: readonly InstanceId[], marked: readonly InstanceId[], need: number, dir: 1 | -1, add: boolean): InstanceId[] {
  if (!cards.length) return [];
  const live = marked.filter((id) => cards.includes(id));
  const last = live[live.length - 1];
  if (last === undefined) return [cards[dir === 1 ? 0 : cards.length - 1]!];
  const n = cards.length;
  let i = cards.indexOf(last);
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    const id = cards[i]!;
    if (live.includes(id)) continue;
    if (add) return [...live, id].slice(-Math.max(1, need));
    return [...live.slice(0, -1), id];
  }
  return live;
}
