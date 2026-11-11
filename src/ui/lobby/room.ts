/**
 * Table links (DESIGN "Specification: network protocol and secrecy", Room: `<base>/#/t/<roomId>/<roomKey>`).
 * Contracts: M1-C. Implementer of `newRoom`: M1-P5.
 */
import { parseRoute, routeHash } from '../routes';
import type { RoomLink } from '../types';

/** The link for a room under `base` (the page URL without its fragment). */
export function roomLink(base: string, roomId: string, roomKey: string): RoomLink {
  return { roomId, roomKey, url: `${base.replace(/#.*$/, '')}${routeHash({ name: 'room', room: roomId, key: roomKey })}` };
}

/** The room of a pasted link or bare fragment, or null when the text is not a table link. */
export function parseRoomLink(base: string, text: string): RoomLink | null {
  const i = text.indexOf('#');
  const route = parseRoute(i < 0 ? text.trim() : text.slice(i).trim());
  return route.name === 'room' ? roomLink(base, route.room, route.key) : null;
}

/**
 * A fresh random room under `base`: three random words and a two-digit number, and 16 random bytes base64url as the
 * key (DESIGN "Specification: network protocol and secrecy", Room). Implementer: M1-P5 (the stub throws).
 */
export function newRoom(_base: string): RoomLink {
  throw new Error('not implemented: M1-P5');
}
