/**
 * The owner's client-side rules around the reducer, shared by the solo and the networked session (DESIGN
 * "Specification: code interfaces", Reducer contract: private effects run in the owner's client; "Multiplayer
 * architecture", Hidden information 2: when a card becomes public the owner publishes its identity; "Table model",
 * Face-down). Pure: they read the state and the owner's secret store and return drafts; the sessions stamp and apply
 * them.
 */
import type { Action, ActionDraft } from '../core/actions';
import { reduce } from '../core/reducer/index';
import type { InstanceId, SecretStore, SeatId, TableState } from '../core/types';
import type { UndoReveal } from '../core/undo';
import type { LibraryPlacement } from './secrets';

/**
 * Action types that need the owner's secrets and therefore run only through the session's own methods
 * (importDeck, shuffle, mulligan, undo, a toZone within the own library, the audit at game end), never through `dispatch`.
 */
export const SESSION_ONLY: ReadonlySet<string> = new Set(['ready', 'shuffleCommit', 'shuffleNonce', 'shuffleDone', 'reorder', 'mulligan', 'undo', 'auditPublish']);

/**
 * Public zone kinds that may hold a face-down card (DESIGN "Table model": face-down on the battlefield, face-down
 * exile). Every other public zone (graveyard, stack, command) shows faces to everyone.
 */
export const FACE_DOWN_KINDS: ReadonlySet<string> = new Set(['battlefield', 'exile']);

/** Placeholder `cid` for dry runs of drafts that are stamped only when they are committed. */
export const DRY_CID = 'dry-run';

/** Where cards an action puts into the own library go in the private order. */
export function placementOf(a: Action | ActionDraft): LibraryPlacement {
  if (a.type === 'toZone') return a.position === 'bottom' ? 'bottom' : 'top';
  if (a.type === 'undo') return placementOf(a.inverse);
  return 'top';
}

/** The one existing card an action is about, if any. */
export function referencedCard(a: Action | ActionDraft): InstanceId | null {
  if (a.type === 'draw' || a.type === 'reveal' || a.type === 'revealTo') return a.instanceId;
  if (a.type === 'createToken' || a.type === 'copy') return null;
  if ('card' in a && typeof a.card === 'string') return a.card;
  return null;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * `now` with every card that is not in `prior` but is in `old` (the cards an undo just returned to this list) moved
 * back to its index in `old`; every other card keeps its current relative order.
 */
export function putBack(now: readonly InstanceId[], prior: readonly InstanceId[], old: readonly InstanceId[]): InstanceId[] {
  const before = new Set(prior);
  const oldIndex = new Map(old.map((id, i) => [id, i] as const));
  const returned = now.filter((id) => !before.has(id) && oldIndex.has(id)).sort((a, b) => oldIndex.get(a)! - oldIndex.get(b)!);
  if (!returned.length) return [...now];
  const back = new Set(returned);
  const out = now.filter((id) => !back.has(id));
  for (const id of returned) out.splice(Math.min(oldIndex.get(id)!, out.length), 0, id);
  return out;
}

/**
 * Whether `action` moves a face-down card that may be turned up (it has a public identity, is a labelled table
 * object, or is an own card whose identity this browser holds) from a public zone into a public zone that shows
 * faces to everyone: graveyard, stack, command (DESIGN "Table model"; only a battlefield and exile hold face-down cards).
 */
export function turnsUpOnMove(state: TableState, secrets: SecretStore, seat: SeatId, action: Action): boolean {
  if (action.type !== 'move') return false;
  const card = Object.hasOwn(state.cards, action.card) ? state.cards[action.card] : undefined;
  const dest = Object.hasOwn(state.zones, action.to) ? state.zones[action.to] : undefined;
  if (!card || !dest || card.face !== 'down' || card.zone === action.to) return false;
  if (state.zones[card.zone]?.visibility !== 'public' || dest.visibility !== 'public' || FACE_DOWN_KINDS.has(dest.kind)) return false;
  const own = card.owner === seat && Object.hasOwn(secrets.identities, card.id);
  return card.identity !== undefined || card.tokenLabel !== undefined || own;
}

/**
 * The reveal an action needs first: the action names an own card whose identity only this browser holds, and the
 * card ends up public (moved out of a hidden zone, cast, turned face up, or moved face down into a zone that shows
 * faces, `turnUp`). Null when the action would not apply even with the reveal, so a refused action never publishes
 * an identity. Returned unstamped: it gets its cid only when it is committed.
 */
export function revealFor(state: TableState, secrets: SecretStore, seat: SeatId, action: Action, turnUp: boolean): ActionDraft | null {
  const id = referencedCard(action);
  if (id === null || action.type === 'reveal' || action.type === 'revealTo' || (action.type === 'flip' && action.ref !== undefined)) return null;
  const card = Object.hasOwn(state.cards, id) ? state.cards[id] : undefined;
  const secret = Object.hasOwn(secrets.identities, id) ? secrets.identities[id] : undefined;
  if (!card || !secret || card.owner !== seat || card.identity !== undefined) return null;
  const hidden = state.zones[card.zone]?.visibility !== 'public';
  const turnsUp = turnUp || (!hidden && card.face === 'down' && action.type === 'flip' && action.face === 'up');
  if (!hidden && !turnsUp) return null;
  const reveal: ActionDraft = { type: 'reveal', instanceId: id, ref: secret.card, salt: secret.salt, ...(action.group !== undefined ? { group: action.group } : {}) };
  const s1 = reduce(state, { ...reveal, by: seat, cid: DRY_CID, seq: state.seq + 1 } as Action);
  if (s1 === state) return null;
  const s2 = reduce(s1, { ...action, seq: state.seq + 2 } as Action);
  if (s2 === s1) return null;
  const after = s2.cards[id];
  if (!after || s2.zones[after.zone]?.visibility !== 'public') return null;
  return reveal;
}

/**
 * The networked session's order (DESIGN "Multiplayer architecture", Hidden information 2): the own card whose identity
 * only this browser holds that `action` leaves in a public zone without an identity (moved or cast out of a hidden
 * zone, or a face-down card moved into a zone that shows faces, `turnUp`). The session proposes the action alone, so
 * the reducer puts the card down face down, and publishes the identity with a verified `flip` only once the action is
 * sequenced: a reveal sent first could be sequenced while the action is refused, publishing a card still in the hand.
 * Null when the action names no such card or would not apply.
 */
export function turnsPublic(state: TableState, secrets: SecretStore, seat: SeatId, action: Action, turnUp: boolean): InstanceId | null {
  const id = referencedCard(action);
  if (id === null || action.type === 'reveal' || action.type === 'revealTo' || action.type === 'flip') return null;
  const card = Object.hasOwn(state.cards, id) ? state.cards[id] : undefined;
  if (!card || card.owner !== seat || card.identity !== undefined || !Object.hasOwn(secrets.identities, id)) return null;
  if (state.zones[card.zone]?.visibility === 'public' && !turnUp) return null;
  const next = reduce(state, { ...action, seq: state.seq + 1 } as Action);
  if (next === state) return null;
  const after = next.cards[id];
  if (!after || after.identity !== undefined || next.zones[after.zone]?.visibility !== 'public') return null;
  return id;
}

/**
 * A `flip` up of an own face-down card whose identity only this browser holds, with its ref and salt added: the
 * verified flip publishes the identity in the same step that turns the card up, so a refused flip publishes nothing.
 * Any other action comes back unchanged.
 */
export function withProof(state: TableState, secrets: SecretStore, seat: SeatId, action: Action): Action {
  if (action.type !== 'flip' || action.face !== 'up' || action.ref !== undefined) return action;
  const card = Object.hasOwn(state.cards, action.card) ? state.cards[action.card] : undefined;
  const secret = Object.hasOwn(secrets.identities, action.card) ? secrets.identities[action.card] : undefined;
  if (!card || !secret || card.owner !== seat || card.identity !== undefined || state.zones[card.zone]?.visibility !== 'public') return action;
  return { ...action, ref: secret.card, salt: secret.salt };
}

/**
 * The verified re-reveal of an own card an undo brought back face down without its identity (core/undo.ts
 * UndoReveal: a restore patch never puts a committed identity back): `flip` up with ref and salt when it was face up,
 * else `reveal`. Null when the card is not this seat's or its identity is not the one the undo names.
 */
export function reRevealDraft(state: TableState, secrets: SecretStore, seat: SeatId, r: UndoReveal, group: string | undefined): ActionDraft | null {
  const card = Object.hasOwn(state.cards, r.card) ? state.cards[r.card] : undefined;
  const secret = Object.hasOwn(secrets.identities, r.card) ? secrets.identities[r.card] : undefined;
  if (!card || card.owner !== seat || card.identity !== undefined || !secret) return null;
  if (secret.card.sid !== r.ref.sid || secret.card.foil !== r.ref.foil) return null;
  const g = group !== undefined ? { group } : {};
  return r.face === 'up' ? { type: 'flip', card: r.card, face: 'up', ref: secret.card, salt: secret.salt, ...g } : { type: 'reveal', instanceId: r.card, ref: secret.card, salt: secret.salt, ...g };
}

/**
 * Whether `playFaceDown(card, to)` may run: an own card from a hidden zone (hand or library) put onto a battlefield
 * or into exile (DESIGN "Table model", Face-down). The reducer turns a card that leaves a hidden zone without a public
 * identity face down.
 */
export function faceDownAllowed(state: TableState, seat: SeatId, card: InstanceId, to: string): boolean {
  const c = Object.hasOwn(state.cards, card) ? state.cards[card] : undefined;
  const dest = Object.hasOwn(state.zones, to) ? state.zones[to] : undefined;
  return !!c && c.owner === seat && state.zones[c.zone]?.visibility !== 'public' && dest?.visibility === 'public' && FACE_DOWN_KINDS.has(dest.kind);
}
