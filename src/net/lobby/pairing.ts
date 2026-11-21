/**
 * Pairing (matchmaking.md MM-11, 2.5 room derivation, 2.7 window; contracts.md Part G "Matchmaking" item 1). Pure.
 *
 * - `windowOf(waitMs, open)`: the gaps a player's own wait allows: deck band first, rating second, anyone after 90 s.
 * - `compatible`: a pair fits both players' windows; symmetric. A member judging an offer adds 2 s of slack to the
 *   others' wait (its estimate of their wait lags by the network delay).
 * - `bestGroup`: the cheapest group of the queue's size around an anchor: pairwise linked and compatible.
 * - `splitTeams` (2hg): the highest and the lowest rated together.
 * - `deriveRoom`: the room id (three words and a number) and 22-character key from all members' hold nonces,
 *   identical for any input order; and the seat order.
 */
import { base64url } from '../../core/hash';
import { sha256Sync, sha256TextBytes } from '../../core/sha256';
import { TABLE_FORMAT_SEATS } from '../../core/teams';
import type { Band, Format, QueueId, RatingKey } from '../../core/types';
import type { Ticket } from './messages';
import { START_RATING } from './rating';

/** Row boundaries of the window table, in ms of own wait (matchmaking.md 2.7). */
export const WINDOW_ROWS_MS: readonly number[] = [10_000, 20_000, 40_000, 60_000, 90_000];
/** The slack a member gives the others' wait when it judges an offer (contracts.md Part G "Matchmaking" item 1). */
export const JUDGE_SLACK_MS = 2_000;

/** What a window allows; null means any. */
export interface PairWindow {
  rating: number | null;
  band: number | null;
}

/** The window of a player who has waited `waitMs` (matchmaking.md 2.7); `open` ("Play anyone now") allows anyone. */
export function windowOf(waitMs: number, open = false): PairWindow {
  if (open || waitMs >= 90_000) return { rating: null, band: null };
  if (waitMs >= 60_000) return { rating: 600, band: 2 };
  if (waitMs >= 40_000) return { rating: 400, band: 2 };
  if (waitMs >= 20_000) return { rating: 300, band: 1 };
  if (waitMs >= 10_000) return { rating: 200, band: 1 };
  return { rating: 100, band: 0 };
}

/** The next row boundary strictly after `waitMs`, or null past the last one. */
export function nextBoundary(waitMs: number): number | null {
  return WINDOW_ROWS_MS.find((b) => b > waitMs) ?? null;
}

/** The parts of a queue id. */
export function queueParts(queue: QueueId): { format: Format; kind: 'constructed' | 'limited'; mode: 'ranked' | 'casual' } {
  const [format, kind, mode] = queue.split('.') as [Format, 'constructed' | 'limited', 'ranked' | 'casual'];
  return { format, kind, mode };
}

/** The rating key a queue pairs on (ranked or casual), null for free-for-all (no rating there). */
export function pairingKeyOf(queue: QueueId): RatingKey | null {
  const { format, kind } = queueParts(queue);
  return format === '1v1' || format === '2hg' ? `${format}.${kind}` : null;
}

/** What pairing needs from a seeker. */
export interface Candidate {
  tid: string;
  band: Band;
  ratings: Ticket['ratings'];
  open: boolean;
  queues: readonly QueueId[];
  proto: number;
}

/** A candidate's rating on the queue's key (1500 when it has none). */
export function ratingFor(c: Pick<Candidate, 'ratings'>, queue: QueueId): number | null {
  const key = pairingKeyOf(queue);
  if (key === null) return null;
  return c.ratings[key]?.r ?? START_RATING;
}

/**
 * Whether `a` (waited `waitA`) and `b` (waited `waitB`) may meet in `queue`: both list it, same game protocol, and the
 * band and rating gaps fit both windows (a casual queue doubles the rating window). Symmetric by construction.
 */
export function compatible(a: Candidate, b: Candidate, queue: QueueId, waitA: number, waitB: number): boolean {
  if (!a.queues.includes(queue) || !b.queues.includes(queue) || a.proto !== b.proto) return false;
  const wa = windowOf(waitA, a.open);
  const wb = windowOf(waitB, b.open);
  const bandGap = Math.abs(a.band - b.band);
  if ((wa.band !== null && bandGap > wa.band) || (wb.band !== null && bandGap > wb.band)) return false;
  const ra = ratingFor(a, queue);
  const rb = ratingFor(b, queue);
  if (ra === null || rb === null) return true;
  const gap = Math.abs(ra - rb);
  const factor = queueParts(queue).mode === 'casual' ? 2 : 1;
  if ((wa.rating !== null && gap > wa.rating * factor) || (wb.rating !== null && gap > wb.rating * factor)) return false;
  return true;
}

/** The cost of a pair: 100 per band step plus the rating gap (matchmaking.md 2.5 rule 2). */
export function pairCost(a: Candidate, b: Candidate, queue: QueueId): number {
  const ra = ratingFor(a, queue) ?? 0;
  const rb = ratingFor(b, queue) ?? 0;
  return 100 * Math.abs(a.band - b.band) + Math.abs(ra - rb);
}

/** Seats at a queue's table. */
export function groupSize(queue: QueueId): number {
  return TABLE_FORMAT_SEATS[queueParts(queue).format];
}

export interface GroupChoice {
  /** The anchor first, then the others by tid. */
  members: string[];
  cost: number;
}

/**
 * The best group for `queue` around `anchor` (matchmaking.md 2.5 rule 2): `others` are the candidates with their
 * waits; a group needs every pair linked (`linked`) and compatible; among valid groups the lowest cost wins, ties go to
 * the longest-waiting candidates, then to the smaller tids. `skip` drops member sets that are blocked. Null when none.
 */
export function bestGroup(
  anchor: { c: Candidate; waitMs: number },
  others: readonly { c: Candidate; waitMs: number }[],
  queue: QueueId,
  linked: (a: string, b: string) => boolean,
  skip: (members: readonly string[]) => boolean = () => false,
): GroupChoice | null {
  const n = groupSize(queue);
  const pool = others
    .filter((o) => o.c.tid !== anchor.c.tid && linked(anchor.c.tid, o.c.tid) && compatible(anchor.c, o.c, queue, anchor.waitMs, o.waitMs))
    .sort((x, y) => (x.c.tid < y.c.tid ? -1 : x.c.tid > y.c.tid ? 1 : 0));
  if (pool.length < n - 1) return null;
  let best: { members: string[]; cost: number; wait: number } | null = null;
  const pick: number[] = [];
  const consider = (): void => {
    const group = [anchor, ...pick.map((i) => pool[i]!)];
    let cost = 0;
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const x = group[i]!;
        const y = group[j]!;
        if (i > 0 && (!linked(x.c.tid, y.c.tid) || !compatible(x.c, y.c, queue, x.waitMs, y.waitMs))) return;
        cost = Math.max(cost, pairCost(x.c, y.c, queue));
      }
    const members = group.map((g) => g.c.tid);
    if (skip(members)) return;
    const wait = group.reduce((s, g) => s + g.waitMs, 0);
    if (best === null || cost < best.cost || (cost === best.cost && wait > best.wait)) best = { members, cost, wait };
  };
  const walk = (from: number): void => {
    if (pick.length === n - 1) return consider();
    for (let i = from; i <= pool.length - (n - 1 - pick.length); i++) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  if (best === null) return null;
  const b = best as { members: string[]; cost: number };
  return { members: b.members, cost: b.cost };
}

/** Two teams for a 2hg group (matchmaking.md 2.5 "2v2 units"): sorted by rating, the highest and the lowest together. */
export function splitTeams(members: readonly { tid: string; rating: number }[]): Record<string, 0 | 1> {
  const sorted = [...members].sort((a, b) => b.rating - a.rating || (a.tid < b.tid ? -1 : 1));
  const out: Record<string, 0 | 1> = {};
  sorted.forEach((m, i) => (out[m.tid] = i === 0 || i === sorted.length - 1 ? 0 : 1));
  return out;
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * The match id of an anchor's offer (matchmaking.md 2.4): 16 hex characters. `salt` is the anchor's random per-lobby
 * connection salt, so nobody else can predict an id and a new connection never repeats one (decision M8-P7).
 */
export function midOf(queue: QueueId, tids: readonly string[], anchorTid: string, counter: number, salt = ''): string {
  const sorted = [...tids].sort();
  return hex(sha256TextBytes(`mm|${queue}|${sorted.join(',')}|${anchorTid}|${counter}${salt ? `|${salt}` : ''}`)).slice(0, 16);
}

/** The room id words (a copy of ui/lobby/room.ts ROOM_WORDS, which net/ may not import; a unit test keeps them equal). */
export const ROOM_WORDS: readonly string[] = [
  'amber', 'apple', 'arrow', 'aspen', 'atlas', 'badge', 'basil', 'beach', 'birch', 'blaze', 'bloom', 'brook', 'cabin', 'cedar', 'chalk', 'cider',
  'cliff', 'cloud', 'clover', 'coast', 'comet', 'coral', 'crane', 'creek', 'crown', 'dawn', 'delta', 'dune', 'eagle', 'ember', 'fable', 'falcon',
  'fern', 'field', 'finch', 'fjord', 'flame', 'flint', 'forge', 'fox', 'frost', 'gale', 'garnet', 'glade', 'glow', 'grove', 'harbor', 'hare',
  'hazel', 'heath', 'heron', 'hill', 'holly', 'iris', 'ivory', 'jade', 'juniper', 'kestrel', 'lagoon', 'lantern', 'larch', 'lark', 'lemon', 'lilac',
  'lily', 'linen', 'lotus', 'lynx', 'maple', 'marble', 'marsh', 'meadow', 'mist', 'moss', 'moth', 'nectar', 'north', 'oak', 'ocean', 'olive',
  'onyx', 'orbit', 'otter', 'owl', 'pearl', 'pebble', 'pine', 'plum', 'pond', 'poppy', 'quail', 'quartz', 'rain', 'raven', 'reed', 'ridge',
  'river', 'robin', 'rose', 'rowan', 'sage', 'salt', 'sand', 'shell', 'shore', 'silver', 'slate', 'snow', 'sorrel', 'spark', 'spruce', 'star',
  'stone', 'storm', 'swan', 'thistle', 'thorn', 'tide', 'tulip', 'umber', 'vale', 'violet', 'willow', 'wind', 'wren', 'yarrow', 'zephyr', 'zinnia',
];

/** The derived room of a formed match. */
export interface DerivedRoom {
  roomId: string;
  roomKey: string;
  /** Member tids in seat order. */
  order: string[];
}

/**
 * The room of a match (matchmaking.md 2.5, Room derivation): a secret from the match id and every member's hold nonce
 * (ascending tid order), the key its first 16 bytes, the room id drawn from a hash stream with the generator of
 * ui/lobby/room.ts (three words and a number), the seats ordered by a hash of the secret and the tid.
 */
export function deriveRoom(mid: string, nonces: Readonly<Record<string, string>>): DerivedRoom {
  const tids = Object.keys(nonces).sort();
  const secret = sha256TextBytes(`spellplane-match|${mid}|${tids.map((t) => nonces[t]).join('|')}`);
  const s = base64url(secret);
  const roomKey = base64url(secret.slice(0, 16));
  let counter = 0;
  let buf: number[] = [];
  const take = (): number => {
    if (buf.length === 0) buf = [...sha256TextBytes(`${s}|code|${counter++}`)];
    return buf.shift()!;
  };
  const words = [take(), take(), take()].map((b) => ROOM_WORDS[b & 127]!);
  let n = -1;
  while (n < 0) {
    const b = take();
    if (b < 180) n = 10 + (b % 90);
  }
  const rank = (t: string): string => sha256Sync(`${s}|${t}`);
  const order = [...tids].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra < rb ? -1 : ra > rb ? 1 : a < b ? -1 : 1;
  });
  return { roomId: `${words.join('-')}-${n}`, roomKey, order };
}
