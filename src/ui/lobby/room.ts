/**
 * Table links (DESIGN "Specification: network protocol and secrecy", Room: `<base>/#/t/<roomId>/<roomKey>`; the room
 * id is three random words and a two-digit number, the room key 16 random bytes base64url; "Multiplayer
 * architecture", Rooms and connection: the fragment is never sent to the host). Contracts: M1-C. Implementer: M1-P5.
 */
import { base64url } from '../../core/hash';
import { parseRoute, routeHash } from '../routes';
import type { RoomLink } from '../types';

/** A room id: letters, digits and hyphens, at most 64 characters (newRoom makes `word-word-word-NN`). */
export const ROOM_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/;
/** A room key: 16 bytes base64url without padding, i.e. exactly 22 characters. */
export const ROOM_KEY_RE = /^[A-Za-z0-9_-]{22}$/;

/** 128 short, unambiguous words, so a byte picks one without modulo bias (`b & 127`). */
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

/** `n` cryptographically random bytes (the default source of newRoom). */
export function cryptoBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** True for a room id and key a link may carry. */
export function isRoom(roomId: string, roomKey: string): boolean {
  return ROOM_ID_RE.test(roomId) && ROOM_KEY_RE.test(roomKey);
}

/**
 * Where a table link points: the page URL without its fragment and query. Test flags such as `?profile=` belong to
 * this browser only and must not travel with a shared link.
 */
export function pageBase(href: string): string {
  return href.replace(/[?#].*$/, '');
}

/** The link for a room under `base` (the page URL without its fragment). */
export function roomLink(base: string, roomId: string, roomKey: string): RoomLink {
  return { roomId, roomKey, url: `${pageBase(base)}${routeHash({ name: 'room', room: roomId, key: roomKey })}` };
}

/**
 * The room of a pasted link or bare fragment, or null when the text is not a table link. The link may come from
 * another copy of the site (it is re-based on `base`), sit inside a sentence or be followed by punctuation, and the
 * key may carry the `k=` prefix of the design's example link. A room key that is not 16 bytes base64url is refused,
 * since it is the password that encrypts signalling.
 */
export function parseRoomLink(base: string, text: string): RoomLink | null {
  const s = text.trim();
  const i = s.indexOf('#');
  // A bare path `/t/<room>/<key>` or `t/<room>/<key>` without the '#'.
  const fragment = i >= 0 ? s.slice(i) : s.replace(/^\/?(?=t\/)/, '#/');
  const m = /^#\/t\/([^/\s]+)\/(?:k=)?([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(fragment);
  if (!m) {
    const route = parseRoute(fragment.split(/\s/)[0] ?? '');
    if (route.name !== 'room') return null;
    const key = route.key.replace(/^k=/, '');
    return isRoom(route.room, key) ? roomLink(base, route.room, key) : null;
  }
  let room = m[1]!;
  try {
    room = decodeURIComponent(room);
  } catch {
    return null;
  }
  return isRoom(room, m[2]!) ? roomLink(base, room, m[2]!) : null;
}

/** A random room id: three words and a two-digit number (10-99), e.g. `amber-fox-river-42`. */
export function randomRoomId(random: (n: number) => Uint8Array = cryptoBytes): string {
  const words = [...random(3)].map((b) => ROOM_WORDS[b & 127]!);
  let n = -1;
  // Rejection sampling over 0..179 keeps the 90 numbers equally likely.
  while (n < 0) {
    const b = random(1)[0]!;
    if (b < 180) n = 10 + (b % 90);
  }
  return `${words.join('-')}-${n}`;
}

/** A random room key: 16 random bytes, base64url (22 characters). */
export function randomRoomKey(random: (n: number) => Uint8Array = cryptoBytes): string {
  return base64url(random(16));
}

/**
 * A fresh random room under `base`: three random words and a two-digit number, and 16 random bytes base64url as the
 * key (DESIGN "Specification: network protocol and secrecy", Room).
 */
export function newRoom(base: string, random: (n: number) => Uint8Array = cryptoBytes): RoomLink {
  return roomLink(base, randomRoomId(random), randomRoomKey(random));
}
