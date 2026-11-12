/**
 * Reducer cases of the open draft formats (DESIGN "Specification: card data, packs and draft formats", Draft formats:
 * Rochester, Winston, Grid; "Pre-game", Hidden information column). Called through core/reducer/drafting.ts.
 * Contracts: M2-C (stubs); implementer: M2-P3.
 */
import type { ActionOf } from '../actions';
import type { Draft } from './draft';
import { reject } from './util';

/** `packOpen` of a public pack (Rochester: face up on the shared table, cards verified against the commits; Winston and grid: dealt into the stack or the grid). Implementer: M2-P3. */
export function packOpen(_d: Draft, _a: ActionOf<'packOpen'>): void {
  reject('packOpen is not implemented for this format: M2-P3');
}

/** Rochester `pick` of one named card in snake order; the opener role moves left when `burn` cards remain. Implementer: M2-P3. */
export function pick(_d: Draft, _a: ActionOf<'pick'>): void {
  reject('pick is not implemented for this format: M2-P3');
}

/** Winston `pileLook {pile, take}`: take the pile, or add a stack card and look at the next; declining pile 3 takes the top stack card. Implementer: M2-P3. */
export function pileLook(_d: Draft, _a: ActionOf<'pileLook'>): void {
  reject('pileLook is not implemented: M2-P3');
}

/** Grid `gridTake {grid, line, index}`: first player, then second; the rest is discarded and the next grid is laid. Implementer: M2-P3. */
export function gridTake(_d: Draft, _a: ActionOf<'gridTake'>): void {
  reject('gridTake is not implemented: M2-P3');
}
