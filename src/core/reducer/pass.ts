/**
 * Reducer cases of the pass draft, Pick-Two and sealed (DESIGN "Specification: card data, packs and draft formats",
 * Draft formats; "Specification: network protocol and secrecy", Draft packs: `packOpen` publishes the commitments,
 * `pick {packId, count}` keeps picked identities with the picker, `packPass {packId, to, count}` hands the rest on).
 * Called through core/reducer/drafting.ts. Contracts: M2-C (stubs); implementer: M2-P2. The Two-Headed Giant
 * variants ('teamDraft', 'teamSealed') come here too and are M3-P2's.
 */
import type { ActionOf } from '../actions';
import type { Draft } from './draft';
import { reject } from './util';

/** `packOpen` of a hidden pack: records the pack, its commitments and size, and queues it at its opener (sealed: straight into the pool). Implementer: M2-P2. */
export function packOpen(_d: Draft, _a: ActionOf<'packOpen'>): void {
  reject('packOpen is not implemented: M2-P2');
}

/** `pick` from the pack at the front of the picker's queue: `count` equals the picks per pass, or the rest of the pack. Implementer: M2-P2. */
export function pick(_d: Draft, _a: ActionOf<'pick'>): void {
  reject('pick is not implemented: M2-P2');
}

/** `packPass` to the next drafter in the round's direction; ends a round when every pack of it is empty. Implementer: M2-P2. */
export function packPass(_d: Draft, _a: ActionOf<'packPass'>): void {
  reject('packPass is not implemented: M2-P2');
}

/** `draftTimeout` from the sequencer: the pick timer of the front pack ran out (logged; the holder then picks). Implementer: M2-P2. */
export function draftTimeout(_d: Draft, _a: ActionOf<'draftTimeout'>): void {
  reject('draftTimeout is not implemented: M2-P2');
}
