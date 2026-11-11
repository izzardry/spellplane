/**
 * The lobby's connectivity check (DESIGN "Multiplayer architecture", Rooms and connection: no relay fallback; the
 * lobby runs a connectivity check per pair and says so plainly, with the usual remedies: other network, phone hotspot,
 * VPN). Pure apart from the remembered "since" times; the caller passes the clock. Implementer: M1-P5.
 */
import type { SeatId, TableState } from '../../core/types';
import type { SessionNetStatus } from '../../session/types';
import { isOccupied } from './seats';

/** How long a pair may stay unconnected before the lobby calls it a failure (M1-P5 decision). */
export const CONNECT_CHECK_MS = 15_000;
/**
 * How long a browser may sit alone, with no other player in the shared seats, before the lobby calls it a failure.
 * Until then nobody may have opened the link yet, so there is no pair that could have failed; after CONNECT_CHECK_MS
 * the lobby shows a neutral hint instead (M1-P5 decision).
 */
export const ALONE_ALERT_MS = 120_000;

/** The usual remedies, in plain words (DESIGN "Multiplayer architecture", No relay fallback). */
export const REMEDIES = 'Try another network, a phone hotspot or a VPN on one side. Spellplane has no relay server, so it cannot route around a blocked connection.';

/** Alone at the table for a while with nobody else in the seats: a neutral hint, not a failure. */
export const WAITING_TEXT = `Waiting for another player to open the link. If someone has opened it and still does not appear here, your two networks may not allow a direct connection. ${REMEDIES}`;

/** The relays that introduce browsers cannot be reached (joining never completes). */
export const RELAYS_TEXT = `Spellplane cannot reach the public signalling relays that introduce browsers to each other. Check your internet connection. ${REMEDIES}`;

/** One problem the lobby shows. */
export interface ConnectivityProblem {
  kind: 'relays' | 'alone' | 'pair' | 'version';
  /** The other side of a failed pair: its seat, if known. */
  seat?: SeatId;
  /** The other side of a failed pair: its peer id, if known. */
  peer?: string;
  /** The plain message. */
  text: string;
}

/** One pair as the lobby reports it. */
export interface PairStatus {
  /** Identity peer id of the other browser. */
  peer: string;
  name: string;
  seat: SeatId | null;
  state: 'connected' | 'connecting' | 'away' | 'failed';
}

/** Result of one observation. */
export interface ConnectivityReport {
  /** Overall: 'ok' when every seated player is connected, 'checking' within the grace time, 'failed' otherwise. */
  overall: 'ok' | 'checking' | 'failed' | 'solo';
  pairs: PairStatus[];
  problems: ConnectivityProblem[];
  /** A neutral hint that is not (yet) a failure: alone at the table with nobody else in the seats. */
  notice?: string;
}

/**
 * Remembers since when each condition holds and turns the network status plus the shared seats into plain problems.
 * Feed it every status change and on a timer; a condition that clears is forgotten, so a later repeat waits again.
 */
export class ConnectivityCheck {
  private since = new Map<string, number>();

  constructor(
    private readonly timeoutMs: number = CONNECT_CHECK_MS,
    private readonly aloneMs: number = ALONE_ALERT_MS,
  ) {}

  observe(status: SessionNetStatus, state: TableState, selfPeer: string, now: number): ConnectivityReport {
    const live = new Set<string>();
    const held = (key: string, ms: number = this.timeoutMs): boolean => {
      live.add(key);
      const t = this.since.get(key);
      if (t === undefined) {
        this.since.set(key, now);
        return ms <= 0;
      }
      return now - t >= ms;
    };
    const done = (r: ConnectivityReport): ConnectivityReport => {
      for (const k of [...this.since.keys()]) if (!live.has(k)) this.since.delete(k);
      return r;
    };

    if (status.mode === 'solo' || status.connection === 'solo') return done({ overall: 'solo', pairs: [], problems: [] });
    if (status.connection === 'versionMismatch') {
      return done({
        overall: 'failed',
        pairs: [],
        problems: [{ kind: 'version', text: 'Another player runs a different version of Spellplane. Everyone needs to reload the page to get the same version.' }],
      });
    }

    const problems: ConnectivityProblem[] = [];
    const pairs: PairStatus[] = [];
    let pending = false;

    if (status.connection === 'joining' || status.connection === 'idle') {
      if (held('relays')) problems.push({ kind: 'relays', text: RELAYS_TEXT });
      return done({ overall: problems.length ? 'failed' : 'checking', pairs, problems });
    }

    const connected = status.peers.filter((p) => p.status === 'connected');
    const byPeer = new Map(status.peers.filter((p) => p.peerId).map((p) => [p.peerId, p]));

    // Peers whose connection opened but whose handshake never completes.
    for (const p of status.peers) {
      if (p.status !== 'handshake') continue;
      const name = p.nickname || 'another player';
      const failed = held(`hs:${p.transportId}`);
      if (failed) problems.push({ kind: 'pair', ...(p.peerId ? { peer: p.peerId } : {}), ...(p.seat ? { seat: p.seat } : {}), text: `Your browser cannot finish connecting to ${name}. ${REMEDIES}` });
      else pending = true;
      if (p.peerId) pairs.push({ peer: p.peerId, name, seat: p.seat, state: failed ? 'failed' : 'connecting' });
    }

    // Seated players this browser has no direct connection to.
    for (const s of Object.values(state.seats).sort((a, b) => a.index - b.index)) {
      if (!isOccupied(state, s.id) || s.peer === undefined || s.peer === selfPeer) continue;
      if (pairs.some((p) => p.peer === s.peer)) continue;
      const info = byPeer.get(s.peer);
      const name = s.name || 'another player';
      if (info && info.status === 'connected') {
        pairs.push({ peer: s.peer, name, seat: s.id, state: 'connected' });
        continue;
      }
      if (s.away || info?.status === 'away') {
        pairs.push({ peer: s.peer, name, seat: s.id, state: 'away' });
        continue;
      }
      // Without any connection this browser cannot know the seats are current; the "alone" check speaks for it.
      if (connected.length === 0) continue;
      const failed = held(`seat:${s.peer}`);
      if (failed) problems.push({ kind: 'pair', peer: s.peer, seat: s.id, text: `${name} is at this table, but your browser cannot connect to theirs directly. ${REMEDIES}` });
      else pending = true;
      pairs.push({ peer: s.peer, name, seat: s.id, state: failed ? 'failed' : 'connecting' });
    }

    let notice: string | undefined;
    if (connected.length === 0) {
      // Another player in the shared seats means a pair exists that should connect: a failure after the usual check
      // time. With nobody else seated the other side may simply not have opened the link yet: a neutral hint first,
      // a failure only after a much longer wait.
      const othersSeated = Object.values(state.seats).some((s) => isOccupied(state, s.id) && s.peer !== undefined && s.peer !== selfPeer && !s.away);
      const key = othersSeated ? 'alone:seated' : 'alone';
      if (held(key, othersSeated ? this.timeoutMs : this.aloneMs)) {
        problems.push({
          kind: 'alone',
          text: `No other player has connected yet. If someone has opened this link and still does not appear here, your two networks do not allow a direct connection. ${REMEDIES}`,
        });
      } else {
        pending = true;
        if (!othersSeated && held('alone:hint')) notice = WAITING_TEXT;
      }
    }

    const report: ConnectivityReport = { overall: problems.length ? 'failed' : pending ? 'checking' : 'ok', pairs, problems };
    if (notice) report.notice = notice;
    return done(report);
  }
}
