/**
 * Validators for every lobby message (matchmaking.md 2.4; contracts.md Part E: "Lobby validators are M8-P7's").
 * Strict: a message with a missing, oversized, mistyped or unknown field is refused (null), and so is any message
 * over 2 kB of JSON. Nothing that is not in the shapes can travel through the lobby (the leak rule of 2.15).
 */
import { QUEUES } from './types';
import type { LobbyMessage, PassReason, Ticket } from './messages';
import type { QueueId, RatingKey } from '../../core/types';

/** The largest lobby message, in characters of JSON (matchmaking.md 2.2, Rate limits). */
export const MAX_LOBBY_MESSAGE = 2048;

const RATING_KEYS: readonly RatingKey[] = ['1v1.constructed', '1v1.limited', '2hg.constructed', '2hg.limited'];
const NATS = ['open', 'strict', 'blocked', 'unknown'] as const;
const BEAT_STATES = ['watching', 'seeking', 'held', 'check'] as const;
const PASS_REASONS: readonly PassReason[] = ['busy', 'window', 'unreachable', 'stale', 'declined'];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysWithin = (o: Obj, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));
const str = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && v.length >= min && v.length <= max;
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const id = (v: unknown): v is string => str(v, 64) && /^[A-Za-z0-9_-]+$/.test(v);
const mid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);

/** A ticket's fields, or null (matchmaking.md 2.4). */
export function validTicket(v: unknown): Ticket | null {
  if (!isObj(v)) return null;
  if (!keysWithin(v, ['v', 'tid', 'peerId', 'pubKey', 'name', 'proto', 'queues', 'ratings', 'band', 'score', 'open', 'nat', 'rev', 'sig'], ['mate'])) return null;
  if (v.v !== 1 || !id(v.tid) || !(typeof v.peerId === 'string' && /^[0-9a-z_-]{1,32}$/.test(v.peerId))) return null;
  if (!(str(v.pubKey, 256) && /^[A-Za-z0-9_-]+$/.test(v.pubKey))) return null;
  // eslint-disable-next-line no-control-regex
  if (!str(v.name, 24) || /[\u0000-\u001f\u007f]/.test(v.name) || v.name.trim() === '') return null;
  if (!int(v.proto, 0, 1000)) return null;
  if (!Array.isArray(v.queues) || v.queues.length < 1 || v.queues.length > 4) return null;
  if (!v.queues.every((q) => typeof q === 'string' && QUEUES.includes(q as QueueId)) || new Set(v.queues).size !== v.queues.length) return null;
  if (!isObj(v.ratings) || Object.keys(v.ratings).length > RATING_KEYS.length) return null;
  for (const [k, r] of Object.entries(v.ratings)) {
    if (!RATING_KEYS.includes(k as RatingKey) || !isObj(r) || !keysWithin(r, ['r', 'g']) || !int(r.r, 0, 10_000) || !int(r.g, 0, 1_000_000)) return null;
  }
  if (!int(v.band, 1, 5) || !int(v.score, 0, 100) || typeof v.open !== 'boolean') return null;
  if (v.mate !== undefined && !id(v.mate)) return null;
  if (!NATS.includes(v.nat as (typeof NATS)[number]) || !int(v.rev, 0, 1_000_000) || !str(v.sig, 1024)) return null;
  return v as unknown as Ticket;
}

/** A lobby message, or null when it does not have exactly the shape of matchmaking.md 2.4 or is over 2 kB. */
export function validLobbyMessage(raw: unknown): LobbyMessage | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.t !== 'string') return null;
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return null;
  }
  if (size > MAX_LOBBY_MESSAGE) return null;
  const m = raw;
  switch (m.t) {
    case 'seek':
      return keysWithin(m, ['v', 't', 'ticket', 'waitedMs']) && validTicket(m.ticket) && int(m.waitedMs, 0, 86_400_000) ? (m as unknown as LobbyMessage) : null;
    case 'beat':
      return keysWithin(m, ['v', 't', 'state', 'waitedMs', 'n', 'links']) &&
        BEAT_STATES.includes(m.state as (typeof BEAT_STATES)[number]) &&
        int(m.waitedMs, 0, 86_400_000) &&
        int(m.n, 0, 256) &&
        Array.isArray(m.links) &&
        m.links.length <= 32 &&
        m.links.every(id)
        ? (m as unknown as LobbyMessage)
        : null;
    case 'unseek':
      return keysWithin(m, ['v', 't']) ? (m as unknown as LobbyMessage) : null;
    case 'offer': {
      if (!keysWithin(m, ['v', 't', 'mid', 'queue', 'members']) || !mid(m.mid) || !QUEUES.includes(m.queue as QueueId)) return null;
      if (!Array.isArray(m.members) || m.members.length < 2 || m.members.length > 4) return null;
      const ok = m.members.every((x) => isObj(x) && keysWithin(x, ['tid', 'rev'], ['team']) && id(x.tid) && int(x.rev, 0, 1_000_000) && (x.team === undefined || x.team === 0 || x.team === 1));
      const tids = (m.members as Obj[]).map((x) => x.tid);
      return ok && new Set(tids).size === tids.length ? (m as unknown as LobbyMessage) : null;
    }
    case 'hold':
      return keysWithin(m, ['v', 't', 'mid', 'nonce', 'sig']) && mid(m.mid) && typeof m.nonce === 'string' && /^[A-Za-z0-9_-]{22}$/.test(m.nonce) && str(m.sig, 1024)
        ? (m as unknown as LobbyMessage)
        : null;
    case 'pass':
      return keysWithin(m, ['v', 't', 'mid', 'reason']) && mid(m.mid) && PASS_REASONS.includes(m.reason as PassReason) ? (m as unknown as LobbyMessage) : null;
    case 'ready':
      return keysWithin(m, ['v', 't', 'mid']) && mid(m.mid) ? (m as unknown as LobbyMessage) : null;
    default:
      return null;
  }
}

/** The text a ticket signature covers: the canonical JSON of the ticket without `sig` (matchmaking.md 2.4). */
export { ticketText } from './text';
