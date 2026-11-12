/**
 * Pure rules of the open draft formats (DESIGN "Specification: card data, packs and draft formats", Draft formats:
 * Rochester, Winston, Grid; "Pre-game: draft, sealed and deck building", mode table). Shared by the reducer
 * (core/reducer/open.ts), the format drivers (draft/rochester.ts, draft/winston.ts, draft/grid.ts) and the HUD, so
 * every browser agrees on whose turn it is. Implementer: M2-P3.
 *
 * - Rochester: one public pack at a time; picks in snake order from the opener (core/drafting.ts `rochesterOrder`)
 *   until `burn` cards remain; the opener role then moves left; done when every drafter opened `packs` packs.
 * - Winston: the stack is dealt once every pack is open: the opaque ids of all packs sorted (random ids, so a random
 *   interleaving), top first, one card on each of the three piles. A look either takes the pile (replaced by one stack
 *   card) or adds a stack card to it and moves on; declining the last pile takes the top stack card.
 * - Grid: nine face-up cells row by row; the first player takes a row or column, the second a remaining one that
 *   still holds a card; the rest is discarded and the next grid is laid by the next first player.
 */
import { rochesterOrder } from './drafting';
import type { DraftState, GridState, InstanceId, RochesterSettings, SeatId, WinstonState } from './types';

/** Rows and columns of a grid (DESIGN: 3×3). */
export const GRID_SIDE = 3;
/** Piles of a Winston draft (DESIGN: three piles). */
export const WINSTON_PILE_COUNT = 3;

/** A line of a grid. */
export type GridLine = 'row' | 'col';

// ---- shared -----------------------------------------------------------------------------------------------------

/** The other drafter of a two-seat draft (Winston, Grid); throws when `seat` is not one of two drafters. */
export function otherDrafter(draft: Readonly<DraftState>, seat: SeatId): SeatId {
  const i = draft.drafters.indexOf(seat);
  if (draft.drafters.length !== 2 || i < 0) throw new RangeError(`${seat} is not one of two drafters`);
  return draft.drafters[1 - i]!;
}

// ---- Rochester --------------------------------------------------------------------------------------------------

/** Packs a Rochester draft opens in all: `packs` per drafter (DESIGN "End: when every player has opened `packs` packs"). */
export function rochesterTotal(draft: Readonly<DraftState>): number {
  const s = draft.settings as RochesterSettings;
  return s.packs * draft.drafters.length;
}

/** The seat whose Rochester pick it is now: the snake position `turn` of the pack on the table; null between packs or when done. */
export function rochesterPicker(draft: Readonly<DraftState>): SeatId | null {
  const r = draft.rochester;
  if (draft.done || r === undefined || r.pack === null) return null;
  const order = rochesterOrder(draft.drafters, r.opener);
  return order[r.turn % order.length]!;
}

/** The seat that owes the table the next Rochester pack; null while a pack lies on the table or when done. */
export function rochesterOpenerDue(draft: Readonly<DraftState>): SeatId | null {
  const r = draft.rochester;
  if (draft.done || r === undefined || r.pack !== null || r.opened >= rochesterTotal(draft)) return null;
  return r.opener;
}

/** The pack number (0-based round) of the next Rochester pack: every drafter opens one per round. */
export function rochesterRound(opened: number, drafters: number): number {
  return Math.floor(opened / Math.max(1, drafters));
}

// ---- Winston ----------------------------------------------------------------------------------------------------

/** The first pile index at or after `from` that holds a card, or -1. */
export function nextPile(piles: readonly number[], from: number): number {
  for (let i = Math.max(0, from); i < piles.length; i++) if (piles[i]! > 0) return i;
  return -1;
}

/** The dealt layout of a Winston stack from all pack ids: sorted, top first, one card on each pile. */
export function winstonDeal(ids: readonly InstanceId[]): { stackIds: InstanceId[]; pileIds: InstanceId[][] } {
  const stack = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pileIds: InstanceId[][] = [];
  for (let i = 0; i < WINSTON_PILE_COUNT; i++) pileIds.push(stack.length > 0 ? [stack.shift()!] : []);
  return { stackIds: stack, pileIds };
}

/** Whether the Winston stack is dealt (every pack open). */
export function winstonDealt(w: Readonly<WinstonState> | undefined): w is WinstonState & { stackIds: InstanceId[]; pileIds: InstanceId[][] } {
  return w !== undefined && w.stackIds !== undefined && w.pileIds !== undefined;
}

/** The seat whose Winston look it is now; null before the deal or when done. */
export function winstonActive(draft: Readonly<DraftState>): SeatId | null {
  return !draft.done && winstonDealt(draft.winston) ? draft.winston.active : null;
}

/** The result of a Winston look: the new layout, the ids the active player took, and whether the turn passed. */
export interface WinstonStep {
  stackIds: InstanceId[];
  pileIds: InstanceId[][];
  taken: InstanceId[];
  /** The turn passes to the other player. */
  turnOver: boolean;
  /** The pile the active player looks at next (unchanged when the turn passes). */
  pile: number;
}

/**
 * One Winston look by the active player at pile `w.pile` (DESIGN "Specification: card data, packs and draft formats",
 * Winston): take it (replaced by one stack card while the stack lasts), or add a stack card to it and look at the next
 * pile that holds a card; declining the last such pile takes the top stack card. With fewer than two stack cards left,
 * declining the last pile takes the last stack card without adding one; with none left it is refused (the player
 * takes the pile). Returns the reason when the look does not apply.
 */
export function winstonStep(w: Readonly<WinstonState>, take: boolean): WinstonStep | string {
  if (!winstonDealt(w)) return 'the stack is not dealt yet';
  const stack = [...w.stackIds];
  const piles = w.pileIds.map((p) => [...p]);
  const p = w.pile;
  const pile = piles[p];
  if (pile === undefined || pile.length === 0) return `pile ${p + 1} is empty`;
  if (take) {
    piles[p] = stack.length > 0 ? [stack.shift()!] : [];
    return { stackIds: stack, pileIds: piles, taken: pile, turnOver: true, pile: p };
  }
  const later = nextPile(
    piles.map((x) => x.length),
    p + 1,
  );
  if (later >= 0) {
    if (stack.length > 0) pile.push(stack.shift()!);
    return { stackIds: stack, pileIds: piles, taken: [], turnOver: false, pile: later };
  }
  if (stack.length === 0) return 'the stack is empty: take this pile';
  if (stack.length >= 2) pile.push(stack.shift()!);
  const top = stack.shift()!;
  return { stackIds: stack, pileIds: piles, taken: [top], turnOver: true, pile: p };
}

// ---- Grid -------------------------------------------------------------------------------------------------------

/** Cell indices (row by row) of a grid line. */
export function gridLine(line: GridLine, index: number): number[] {
  return Array.from({ length: GRID_SIDE }, (_, k) => (line === 'row' ? index * GRID_SIDE + k : k * GRID_SIDE + index));
}

/** Whether `line` `index` may still be taken in `grid`: not taken before and holding at least one card. */
export function gridLineOpen(grid: Readonly<GridState>, line: GridLine, index: number): boolean {
  if (grid.taken.some((t) => t.line === line && t.index === index)) return false;
  return gridLine(line, index).some((i) => grid.cells[i] != null);
}

/** Whether any line of `grid` may still be taken. */
export function gridAnyLineOpen(grid: Readonly<GridState>): boolean {
  for (const line of ['row', 'col'] as const) for (let i = 0; i < GRID_SIDE; i++) if (gridLineOpen(grid, line, i)) return true;
  return false;
}

/** The seat whose grid take it is now: the first player, then the other; null before the grid is laid or when done. */
export function gridTaker(draft: Readonly<DraftState>): SeatId | null {
  const g = draft.grid;
  if (draft.done || g === undefined || g.cells.length === 0) return null;
  if (g.taken.length === 0) return g.first;
  if (g.taken.length === 1) return otherDrafter(draft, g.first);
  return null;
}

/** The seat that owes the table the next grid; null while a grid is laid or when done. */
export function gridLayerDue(draft: Readonly<DraftState>): SeatId | null {
  const g = draft.grid;
  if (draft.done || g === undefined || g.cells.length > 0) return null;
  return g.first;
}
