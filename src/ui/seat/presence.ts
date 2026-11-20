/**
 * Seat presence and the seat menu's model (persistence.md sections 5 and 7; journey.md 4.11; contracts.md Part G
 * "Rejoin"). Pure: the frame feeds the HUD's `seatPresence` from `seatPresence`, and SeatMenu reads `seatMenuModel`.
 * Implementer: M8-P5.
 */
import type { SeatId, TableState } from '../../core/types';
import type { PeerInfo } from '../../net/types';

export type Presence = 'here' | 'connecting' | 'away';

/** Each occupied seat's presence as this browser sees it: its own seat is here; a seat marked away is away. */
export function seatPresence(state: TableState, peers: readonly Pick<PeerInfo, 'peerId' | 'status'>[], me: SeatId | null): Record<SeatId, Presence> {
  const out: Record<SeatId, Presence> = {};
  for (const s of Object.values(state.seats)) {
    if (s.peer === undefined) continue;
    if (s.id === me) out[s.id] = 'here';
    else if (s.away === true) out[s.id] = 'away';
    else {
      const p = peers.find((x) => x.peerId === s.peer);
      out[s.id] = p?.status === 'connected' ? 'here' : 'connecting';
    }
  }
  return out;
}

/** `4 s ago`, `3 min ago`, `2 h ago`, `3 d ago`. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** `3 min`, `2 h`, `1 d`: how long a seat has been away. */
export function awayFor(ms: number): string {
  return ago(ms).replace(/ ago$/, '');
}

/** What the top of a seat's plate menu shows (persistence.md section 7, "The seat menu"). */
export type SeatMenuModel =
  | { kind: 'own'; saved: string; notSaving: boolean }
  | { kind: 'here'; name: string }
  | { kind: 'away'; name: string; since: string | null; invite: { by: string } | null; canBring: boolean; why: string | null };

/**
 * The model of one seat's menu for viewer `me`. `awaySince` is when this browser saw the seat away (ms epoch) or null.
 * Bringing back is offered for an away seat unless the table is matched (no bring-back at all) or, in a team game, the
 * viewer is not the seat's teammate (`Only Ben's teammate can bring Ben back.`).
 */
export function seatMenuModel(
  state: TableState,
  seat: SeatId,
  me: SeatId | null,
  o: { now: number; awaySince?: number | null; savedAt?: number | null; notSaving?: boolean; presence?: Presence },
): SeatMenuModel | null {
  const s = state.seats[seat];
  if (!s || s.peer === undefined) return null;
  if (seat === me) return { kind: 'own', saved: o.notSaving ? 'Not saving' : `Saved · ${ago(o.now - (o.savedAt ?? o.now))}`, notSaving: o.notSaving === true };
  const name = s.name || seat;
  if (s.away !== true && o.presence !== 'away') return { kind: 'here', name };
  if (state.settings.matched === true) return { kind: 'away', name, since: o.awaySince != null ? awayFor(o.now - o.awaySince) : null, invite: null, canBring: false, why: null };
  const viewer = me !== null ? state.seats[me] : undefined;
  const teamOk = s.team === undefined || (viewer !== undefined && viewer.team === s.team);
  const invite = s.invite ? { by: state.seats[s.invite.by]?.name ?? s.invite.by } : null;
  return {
    kind: 'away',
    name,
    since: o.awaySince != null ? awayFor(o.now - o.awaySince) : null,
    invite,
    canBring: teamOk && viewer !== undefined,
    why: teamOk ? null : `Only ${name}'s teammate can bring ${name} back.`,
  };
}
