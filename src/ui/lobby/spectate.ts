/**
 * The spectator flow's view logic (PLAN M3-P5; DESIGN "Players, seats and formats", Spectators: "A spectator joins by
 * the same link without taking a chair, sees only public zones, can chat and ping, and cannot move cards. A player may
 * reveal their hand to a named spectator"). Pure functions over the shared state, the peers and the secret store, so
 * the Svelte components stay thin and the rules are unit-tested.
 */
import type { ActionDraft } from '../../core/actions';
import { isSpectatorId, type SpectatorId } from '../../core/teams';
import type { CardRef, InstanceId, SeatId, SecretStore, Stage, TableState } from '../../core/types';
import { spectatorsOf, type SpectatorInfo } from '../../net/roles';
import type { PeerInfo } from '../../net/types';
import { routeHash } from '../routes';
import type { RoomLink } from '../types';

/** The spectator link of a table: the same link with `/watch` appended (DECISIONS [M3-C]). */
export function watchUrl(link: RoomLink): string {
  return link.url.replace(/#.*$/, '') + routeHash({ name: 'room', room: link.roomId, key: link.roomKey, watch: true });
}

/** Whether a pasted table link is a spectator's link (`…#/t/<room>/<key>/watch`). */
export function isWatchLink(text: string): boolean {
  return /#?\/?t\/[^/\s]+\/(?:k=)?[A-Za-z0-9_-]{22}\/watch(?![A-Za-z0-9_-])/.test(text.trim());
}

/** The table link without `/watch`, to take a chair instead. */
export function playHash(link: Pick<RoomLink, 'roomId' | 'roomKey'>): string {
  return routeHash({ name: 'room', room: link.roomId, key: link.roomKey });
}

/** The connected spectators a player can show cards to (DESIGN "Players, seats and formats": a named spectator). */
export function watchers(peers: readonly PeerInfo[]): SpectatorInfo[] {
  return spectatorsOf(peers).filter((s) => s.connected);
}

/** The cards of `seat`'s hand in the shared state, in its public order (opaque ids only). */
export function handOf(state: TableState, seat: SeatId): InstanceId[] {
  return [...(state.zones[`hand:${seat}`]?.ids ?? [])];
}

/**
 * The actions that show `seat`'s whole hand to one spectator: one `revealTo` per card naming that spectator only, in
 * one undo group (CLAUDE.md: a gesture over several cards shares a `group`). The identities travel on that
 * spectator's pair channel only once each `revealTo` is sequenced (session/net.ts). Empty when the hand is empty or
 * the target is not a spectator id.
 */
export function revealHandDrafts(state: TableState, seat: SeatId, spectator: SpectatorId, group: string): ActionDraft[] {
  if (!isSpectatorId(spectator) || !Object.hasOwn(state.seats, seat)) return [];
  return handOf(state, seat).map((instanceId) => ({ type: 'revealTo', instanceId, seats: [], spectators: [spectator], group }) as ActionDraft);
}

/** Cards a player showed this browser, grouped by the showing seat, seat order then the hand's order. */
export interface ShownGroup {
  seat: SeatId;
  name: string;
  cards: { id: InstanceId; ref: CardRef; inHand: boolean }[];
}

/** What other seats showed this browser and it may still see (secret store `received`), grouped by owner. */
export function shownToMe(state: TableState, secrets: SecretStore): ShownGroup[] {
  const groups = new Map<SeatId, ShownGroup>();
  for (const [id, r] of Object.entries(secrets.received)) {
    const card = state.cards[id];
    if (!card || card.identity !== undefined) continue;
    const g = groups.get(r.from) ?? { seat: r.from, name: state.seats[r.from]?.name || r.from, cards: [] };
    g.cards.push({ id, ref: r.card, inHand: card.zone === `hand:${r.from}` });
    groups.set(r.from, g);
  }
  const order = (seat: SeatId): number => state.seats[seat]?.index ?? 99;
  for (const g of groups.values()) {
    const hand = handOf(state, g.seat);
    g.cards.sort((a, b) => (hand.indexOf(a.id) + 1 || 1e6) - (hand.indexOf(b.id) + 1 || 1e6) || (a.id < b.id ? -1 : 1));
  }
  return [...groups.values()].sort((a, b) => order(a.seat) - order(b.seat));
}

/** What a spectator is told while no match is on the table (DESIGN "Specification: card data, packs and draft formats", Evening stages). */
export function stageText(stage: Stage): string {
  switch (stage) {
    case 'lobby':
      return 'The players are in the lobby, choosing chairs and decks.';
    case 'draft':
      return 'The players are drafting. Packs are private, so there is nothing to watch until the decks are built.';
    case 'build':
      return 'The players are building their decks. The match starts once everyone is Ready.';
    default:
      return '';
  }
}

/** The occupied chairs in seat order, for the spectator's lobby view. */
export function seatedPlayers(state: TableState): { seat: SeatId; name: string; ready: boolean; away: boolean }[] {
  return Object.values(state.seats)
    .filter((s) => s.peer !== undefined || s.name.trim() !== '')
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ seat: s.id, name: s.name || s.id, ready: s.ready === true, away: s.away === true }));
}
