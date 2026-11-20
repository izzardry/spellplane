/**
 * Seat presence for the plates (persistence.md section 6; contracts.md Part C: the frame fills `seatPresence`). A
 * simple working version by M8-C: a seat is away when the state marks it away or its peer is away, connecting while
 * its peer's handshake runs, else here. M8-P5 owns the file.
 */
import type { SeatId, TableState } from '../../core/types';
import type { PeerInfo } from '../../net/types';

/** A seat's presence as the plate shows it. */
export type Presence = 'here' | 'connecting' | 'away';

/** The presence of every seat with a player, seen from `me` (who is always here). */
export function seatPresence(state: TableState, peers: readonly Pick<PeerInfo, 'peerId' | 'status'>[], me: SeatId | null): Record<SeatId, Presence> {
  const out: Record<SeatId, Presence> = {};
  for (const seat of Object.values(state.seats)) {
    if (!seat.peer && !seat.name) continue;
    if (seat.id === me) {
      out[seat.id] = 'here';
      continue;
    }
    const peer = peers.find((p) => p.peerId !== '' && p.peerId === seat.peer);
    out[seat.id] = seat.away || peer?.status === 'away' ? 'away' : peer?.status === 'handshake' ? 'connecting' : 'here';
  }
  return out;
}
