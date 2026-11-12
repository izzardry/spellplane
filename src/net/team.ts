/**
 * The Two-Headed Giant team pair channel: the live teammate hand (`teamHand`) and team text chat (`teamChat`) on `prv`
 * to the teammate only (DESIGN "Players, seats and formats", Two-Headed Giant: "Each teammate's hand is visible live to
 * the other", "A team channel carries voice and text only between teammates"; "Specification: network protocol and
 * secrecy", prv). Contracts: M3-C (stub); implementer: M3-P2. Its scenario is in the shared leak test
 * (tests/sim/teams/hand.test.ts; the draft scenario is tests/sim/teams/draft-leak.test.ts).
 *
 * Both directions check the confirmed shared state, never the sender's word:
 * - a hand goes only to a seat on the sender's own team (core/teams.ts `sameTeam`), only while the table shows team
 *   hands (`TableSettings.teamHandsVisible`), and only cards the confirmed state has in the sender's hand zone, so a
 *   card drawn optimistically (whose draw the sequencer may still refuse) or a library card never leaves early;
 * - a received hand is taken only from a teammate, and each card is checked against the teammate's deck commitment
 *   (core/commit.ts verifyReveal); an unverified card is passed on flagged, never as genuine;
 * - team chat goes to, and is taken from, a teammate only.
 */
import { verifyReveal, type RevealedCard } from '../core/commit';
import { sameTeam } from '../core/teams';
import type { CardRef, InstanceId, SeatId, TableState } from '../core/types';
import { PROTOCOL_VERSION, type PrivateMessage, type TeamChatMessage, type TeamHandMessage } from './messages';
import type { CreateTeamChannel, NetEngine, TeamChannel, Unsubscribe } from './types';

/** The part of a NetEngine the team channel uses (tests drive it with a minimal engine). */
export type TeamChannelHost = Pick<NetEngine, 'seat' | 'confirmedState' | 'sendPrivate' | 'onPrivate'>;

/** Most cards one hand message may carry. */
export const MAX_HAND_CARDS = 200;
/** Longest team chat line (characters). */
export const MAX_TEAM_CHAT = 2000;
const MAX_TEXT = 256;

function isText(v: unknown, max = MAX_TEXT): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** A plain copy of a well-formed RevealedCard, or null. */
function asCard(v: unknown): RevealedCard | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ref = o.ref;
  if (!isText(o.instanceId, 128) || !isText(o.salt) || typeof ref !== 'object' || ref === null || Array.isArray(ref)) return null;
  const r = ref as Record<string, unknown>;
  if (!isText(r.sid, 128) || (r.foil !== undefined && r.foil !== true)) return null;
  const card: CardRef = r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
  return { instanceId: o.instanceId, ref: card, salt: o.salt };
}

/** The cards and order of an untrusted `teamHand` payload, or null when malformed. */
export function asTeamHand(msg: unknown): { cards: RevealedCard[]; order: InstanceId[] } | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
  const m = msg as Record<string, unknown>;
  if (m.t !== 'teamHand' || !Array.isArray(m.cards) || !Array.isArray(m.order) || m.cards.length > MAX_HAND_CARDS || m.order.length > MAX_HAND_CARDS) return null;
  const cards: RevealedCard[] = [];
  for (const c of m.cards) {
    const card = asCard(c);
    if (card === null) return null;
    cards.push(card);
  }
  const ids = new Set(cards.map((c) => c.instanceId));
  if (ids.size !== cards.length) return null;
  const order: InstanceId[] = [];
  for (const id of m.order) {
    if (!isText(id, 128) || !ids.has(id) || order.includes(id)) return null;
    order.push(id);
  }
  return { cards, order };
}

/** Whether `to` is on `me`'s team in `state` and the table shows team hands. */
function handsGo(state: TableState, me: SeatId | null, to: SeatId): boolean {
  return me !== null && to !== me && state.settings.teamHandsVisible && sameTeam(state, me, to);
}

/** The team channel as session/team.ts uses it: `sendHand` says whether the hand went out (the engine's `sendPrivate`). */
export interface SendingTeamChannel extends TeamChannel {
  /** As TeamChannel.sendHand; false when nothing was sent (not a teammate, hands hidden, or the teammate's peer not connected and verified). */
  sendHand(to: SeatId, cards: readonly RevealedCard[], order: readonly InstanceId[]): boolean;
}

/** The team channel over any host with the engine's private-message and state members. */
export function teamChannelOver(host: TeamChannelHost): SendingTeamChannel {
  return {
    sendHand(to, cards, order) {
      const me = host.seat();
      const st = host.confirmedState();
      if (!handsGo(st, me, to)) return false;
      // Only cards the confirmed state has in the own hand zone (see the module comment).
      const zone = Object.hasOwn(st.zones, `hand:${me}`) ? st.zones[`hand:${me}`]! : null;
      const inHand = new Set(zone?.ids ?? []);
      const list: RevealedCard[] = [];
      for (const c of cards) {
        const card = asCard(c);
        if (card === null) throw new Error('malformed hand card');
        if (inHand.has(card.instanceId) && !list.some((x) => x.instanceId === card.instanceId)) list.push(card);
      }
      const ids = new Set(list.map((c) => c.instanceId));
      const msg: TeamHandMessage = { v: PROTOCOL_VERSION, t: 'teamHand', cards: list, order: order.filter((id, i) => ids.has(id) && order.indexOf(id) === i) };
      return host.sendPrivate(to, msg);
    },
    onHand(listener): Unsubscribe {
      return host.onPrivate((msg: PrivateMessage, sender) => {
        const from = sender.seat;
        if (msg.t !== 'teamHand' || from === null) return;
        const st = host.confirmedState();
        if (!handsGo(st, host.seat(), from)) return;
        const parsed = asTeamHand(msg);
        if (parsed === null) return;
        const commitment = Object.hasOwn(st.commitments, from) ? st.commitments[from]! : null;
        const verified = parsed.cards.map((c) => commitment !== null && verifyReveal(commitment, c));
        listener(from, parsed.cards, parsed.order, verified);
      });
    },
    sendChat(to, cid, text, atSeq) {
      const me = host.seat();
      if (me === null || to === me || !sameTeam(host.confirmedState(), me, to)) return;
      if (!isText(cid, 128) || typeof text !== 'string' || text.length > MAX_TEAM_CHAT || !Number.isInteger(atSeq) || atSeq < 0) return;
      const msg: TeamChatMessage = { v: PROTOCOL_VERSION, t: 'teamChat', cid, text, atSeq };
      host.sendPrivate(to, msg);
    },
    onChat(listener): Unsubscribe {
      return host.onPrivate((msg: PrivateMessage, sender) => {
        const from = sender.seat;
        const me = host.seat();
        if (msg.t !== 'teamChat' || from === null || me === null || from === me) return;
        if (!sameTeam(host.confirmedState(), me, from)) return;
        const m = msg as unknown as Record<string, unknown>;
        if (!isText(m.cid, 128) || typeof m.text !== 'string' || m.text.length > MAX_TEAM_CHAT || typeof m.atSeq !== 'number' || !Number.isInteger(m.atSeq) || m.atSeq < 0) return;
        listener(from, m.cid, m.text, m.atSeq);
      });
    },
  };
}

/** Create the team channel (net/types.ts TeamChannel). Implementer: M3-P2. */
export const createTeamChannel: CreateTeamChannel = (engine) => teamChannelOver(engine);
