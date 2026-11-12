/**
 * The Two-Headed Giant team view of the networked session (PLAN M3-P2; DESIGN "Players, seats and formats",
 * Two-Headed Giant: "Each teammate's hand is visible live to the other, shown as a second, smaller fan above the
 * player's own"; "A team channel carries voice and text only between teammates"). Implementer: M3-P2; mounted by
 * session/net.ts as `TableSession.team`.
 *
 * - The own hand goes to every teammate (net/team.ts, `teamHand` on the pair channel) whenever it changes, in the
 *   owner's arrangement (SecretStore.hand), and again whenever a peer (re)connects, since a teammate that reloaded has
 *   nothing. Only cards the confirmed state has in the own hand zone are sent (net/team.ts checks it too), so the hand
 *   follows sequenced draws and plays, never optimistic ones.
 * - A teammate's hand is kept as received, in memory only (it is the teammate's hidden information, so this browser
 *   never stores it). The confirmed state lists the teammate's hand zone (opaque ids), so `hand(seat)` shows the
 *   latest copy that holds exactly those cards, else the copy closest to them, without any card that left the hand: a
 *   copy that overtook the log, or a late one, never shows a card the hand does not hold. It is empty while the
 *   teammate is away or no longer a teammate, or the table hides team hands.
 * - Team chat lines go to the teammates only (`teamChat`) and are kept as local log entries for this browser's
 *   timeline (`chatLog`, merged in by the HUD), never in the shared log. They live in memory only: a reload starts the
 *   team tab empty (DECISIONS [M3-P2]).
 */
import type { Action } from '../core/actions';
import type { RevealedCard } from '../core/commit';
import { teammatesOf } from '../core/teams';
import type { InstanceId, LogEntry, SecretStore, SeatId, TableState } from '../core/types';
import { teamChannelOver, type SendingTeamChannel, type TeamChannelHost } from '../net/team';
import type { Unsubscribe } from '../net/types';
import type { TeamControls, TeammateHandCard } from './types';

/** What the session hands the team view (NetTable implements it). */
export interface TeamPort {
  seat(): SeatId;
  confirmedState(): TableState;
  secrets(): SecretStore;
  now(): number;
}

/** Most team chat lines kept for the timeline. */
const MAX_CHAT = 500;
/** Copies of a teammate's hand kept to match against its hand zone. */
const MAX_COPIES = 8;

/** The own hand as it goes to a teammate: the confirmed hand zone in the owner's arrangement, with identities. */
export function ownHandPayload(state: TableState, secrets: SecretStore, me: SeatId): { cards: RevealedCard[]; order: InstanceId[] } {
  const zone = Object.hasOwn(state.zones, `hand:${me}`) ? state.zones[`hand:${me}`]! : null;
  if (zone === null) return { cards: [], order: [] };
  const members = new Set(zone.ids);
  const arranged = secrets.hand.filter((id) => members.has(id));
  const seen = new Set(arranged);
  const order = [...arranged, ...zone.ids.filter((id) => !seen.has(id))];
  const cards: RevealedCard[] = [];
  for (const id of order) {
    const s = Object.hasOwn(secrets.identities, id) ? secrets.identities[id]! : null;
    if (s !== null) cards.push({ instanceId: id, ref: s.card.foil === true ? { sid: s.card.sid, foil: true } : { sid: s.card.sid }, salt: s.salt });
  }
  return { cards, order: cards.map((c) => c.instanceId) };
}

export class TeamView implements TeamControls {
  private channel: SendingTeamChannel | null = null;
  /** Copies of each teammate's hand as received, oldest first. */
  private readonly hands = new Map<SeatId, TeammateHandCard[][]>();
  /** What was last sent to each teammate (a key of the payload); cleared when a peer (re)connects. */
  private readonly lastSent = new Map<SeatId, string>();
  private chat: LogEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly port: TeamPort) {}

  /** Follow `engine`'s pair channel (again after a rejoin); returns the unsubscribers. */
  attach(engine: TeamChannelHost): Unsubscribe[] {
    const channel = teamChannelOver(engine);
    this.channel = channel;
    this.hands.clear();
    this.lastSent.clear();
    return [
      channel.onHand((from, cards, order, verified) => {
        const byId = new Map(cards.map((c, i) => [c.instanceId, { id: c.instanceId, ref: { ...c.ref }, verified: verified[i] === true }]));
        const list: TeammateHandCard[] = [];
        for (const id of [...order, ...cards.map((c) => c.instanceId)]) {
          const c = byId.get(id);
          if (c === undefined) continue;
          byId.delete(id);
          list.push(c);
        }
        this.hands.set(from, [...(this.hands.get(from) ?? []), list].slice(-MAX_COPIES));
        this.changed();
      }),
      channel.onChat((from, cid, text, atSeq) => {
        if (this.chat.some((e) => e.kind === 'action' && e.action.cid === cid && e.action.by === from)) return;
        this.addChat({ type: 'chat', text, channel: 'team', by: from, cid, seq: atSeq });
        this.changed();
      }),
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.channel = null;
  }

  /** Send the own hand to every teammate whose last copy differs (`force`: to every teammate). Called on every change. */
  sync(force = false): void {
    if (this.disposed || this.channel === null) return;
    if (force) this.lastSent.clear();
    const st = this.port.confirmedState();
    const me = this.port.seat();
    const mates = teammatesOf(st, me);
    for (const seat of [...this.hands.keys()]) {
      if (!mates.includes(seat)) {
        this.hands.delete(seat);
        this.changed();
      }
    }
    if (mates.length === 0 || !st.settings.teamHandsVisible) return;
    const payload = ownHandPayload(st, this.port.secrets(), me);
    const key = payload.cards.map((c) => `${c.instanceId}:${c.ref.sid}:${c.ref.foil === true ? 'f' : 'n'}`).join(',');
    for (const to of mates) {
      if (this.lastSent.get(to) === key) continue;
      // Remembered only once it went out: a hand the engine could not send yet (the teammate's peer not connected or
      // not verified) goes again on the next sync, whatever event that is.
      if (this.channel.sendHand(to, payload.cards, payload.order)) this.lastSent.set(to, key);
      else this.lastSent.delete(to);
    }
  }

  /** A team chat line from this browser: to every teammate, and into the own timeline. */
  say(action: Action): void {
    if (action.type !== 'chat' || this.channel === null) return;
    const st = this.port.confirmedState();
    for (const to of teammatesOf(st, this.port.seat())) this.channel.sendChat(to, action.cid, action.text, st.seq);
    this.addChat({ ...action, seq: st.seq });
    this.changed();
  }

  private addChat(action: Action): void {
    this.chat = [...this.chat, { kind: 'action' as const, seq: action.seq ?? 0, at: this.port.now(), action }].slice(-MAX_CHAT);
  }

  private changed(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        console.error('team listener failed', e);
      }
    }
  }

  // --- TeamControls --------------------------------------------------------------------------------------------------

  teammates(): SeatId[] {
    return teammatesOf(this.port.confirmedState(), this.port.seat());
  }

  hand(seat: SeatId): TeammateHandCard[] {
    const st = this.port.confirmedState();
    if (!st.settings.teamHandsVisible || !this.teammates().includes(seat)) return [];
    if (Object.hasOwn(st.seats, seat) && st.seats[seat]!.away === true) return [];
    const zone = new Set(Object.hasOwn(st.zones, `hand:${seat}`) ? st.zones[`hand:${seat}`]!.ids : []);
    // The latest copy that holds exactly the hand zone's cards, else the one sharing most of them (see the module comment).
    let best: TeammateHandCard[] | null = null;
    let bestScore = -1;
    for (const copy of this.hands.get(seat) ?? []) {
      const shared = copy.filter((c) => zone.has(c.id)).length;
      const score = shared === zone.size && copy.length === zone.size ? Number.MAX_SAFE_INTEGER : shared;
      if (score >= bestScore) {
        best = copy;
        bestScore = score;
      }
    }
    return (best ?? []).filter((c) => zone.has(c.id)).map((c) => ({ ...c, ref: { ...c.ref } }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  chatLog(): LogEntry[] {
    return [...this.chat];
  }
}
