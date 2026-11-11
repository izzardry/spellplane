/**
 * Pure helpers over the owner's SecretStore (DESIGN "Data model and protocol", SecretStore; "Multiplayer
 * architecture", Hidden information: owner-held with commitments). The store itself never leaves its owner's browser;
 * these helpers only read and update it. Contracts: M1-C. Implementer of the stubs: M1-P2. The solo session's own
 * reconciliation (session/secrets.ts, M0-P7) stays where it is until M1-P2 consolidates.
 */
import type { RevealedCard } from './commit';
import type { InstanceId, ReceivedIdentity, SecretStore, SeatId, TableState } from './types';

/** An empty secret store for `seat` (DESIGN "Data model and protocol", SecretStore). */
export function emptySecretStore(seat: SeatId): SecretStore {
  return { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
}

/**
 * The store with an identity another seat revealed to this browser only (DESIGN "Multiplayer architecture",
 * Targeted reveal; "Specification: network protocol and secrecy", prv `reveal`). The caller has verified it against
 * the sender's commitment (core/commit.ts verifyReveal). Implementer: M1-P2 (the stub returns the store unchanged).
 */
export function receiveIdentity(secrets: SecretStore, _card: RevealedCard, _from: SeatId): SecretStore {
  return secrets;
}

/**
 * The store without received identities this browser may no longer see: a card that went back into a hidden zone
 * of its owner or left the game (DESIGN "Table model", Hidden cards). Implementer: M1-P2 (the stub returns the store
 * unchanged).
 */
export function pruneReceived(secrets: SecretStore, _state: TableState): SecretStore {
  return secrets;
}

/** An identity revealed to this browser, if any (DESIGN "Multiplayer architecture", Targeted reveal). */
export function receivedIdentity(secrets: SecretStore, id: InstanceId): ReceivedIdentity | null {
  return Object.hasOwn(secrets.received, id) ? secrets.received[id]! : null;
}

/**
 * Every string that would leak an own card that is not public in `state`: its Scryfall id (unless another public card
 * shows the same printing), its salt and every owner nonce of the audit records (PLAN M1-P2 leak test; CLAUDE.md
 * shared leak test). Feeds tests/leak/scan.ts. Implementer: M1-P2 (the stub returns nothing).
 */
export function secretTokens(_state: TableState, _secrets: SecretStore): string[] {
  return [];
}
