/**
 * Table links (DESIGN "Specification: network protocol and secrecy", Room: `<base>/#/t/<roomId>/<roomKey>`, room id of
 * three random words and a two-digit number, room key of 16 random bytes base64url; "Multiplayer architecture", Rooms
 * and connection: the room key travels in the URL fragment, never to the host).
 */
import { describe, expect, it } from 'vitest';
import { newRoom, parseRoomLink, randomRoomId, roomLink, ROOM_KEY_RE, ROOM_WORDS } from '../../../src/ui/lobby/room';
import { parseRoute, routeHash } from '../../../src/ui/routes';

const BASE = 'https://example.test/spellplane/';
const KEY = 'AAECAwQFBgcICQoLDA0ODw'; // 16 bytes 0..15, base64url

/** A deterministic byte source cycling through `bytes`. */
function bytes(...seq: number[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => seq[i++ % seq.length]!);
}

describe('newRoom (DESIGN Room: three random words, a two-digit number, a 16-byte base64url key)', () => {
  it('makes a link whose fragment holds the room id and key, under the page base without this page\'s query', () => {
    const link = newRoom(`${BASE}?profile=a#/lobby`);
    expect(link.roomId).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[1-9][0-9]$/);
    expect(link.roomKey).toMatch(ROOM_KEY_RE);
    expect(link.url).toBe(`${BASE}#/t/${link.roomId}/${link.roomKey}`);
    // The key is only in the fragment, so it is never sent to the host.
    expect(new URL(link.url).hash).toContain(link.roomKey);
    expect(new URL(link.url).pathname + new URL(link.url).search).not.toContain(link.roomKey);
  });

  it('a 16-byte key encodes to exactly 22 base64url characters, with no padding', () => {
    const link = newRoom(BASE, bytes(255, 254, 253, 252, 251, 250, 249, 248, 247, 246, 245, 244, 243, 242, 241, 240, 3));
    expect(link.roomKey).toHaveLength(22);
    expect(link.roomKey).not.toMatch(/[=+/]/);
  });

  it('has 128 distinct room words, so a byte picks one without bias', () => {
    expect(ROOM_WORDS).toHaveLength(128);
    expect(new Set(ROOM_WORDS).size).toBe(128);
    for (const w of ROOM_WORDS) expect(w).toMatch(/^[a-z]+$/);
  });

  it('draws the number by rejection sampling: bytes 180..255 are redrawn, 0..179 map onto 10..99', () => {
    // Words from bytes 0, 1, 2; then 200 and 255 are rejected, 89 gives 10 + 89 % 90 = 99.
    expect(randomRoomId(bytes(0, 1, 2, 200, 255, 89))).toBe(`${ROOM_WORDS[0]}-${ROOM_WORDS[1]}-${ROOM_WORDS[2]}-99`);
    expect(randomRoomId(bytes(127, 128, 255, 0))).toBe(`${ROOM_WORDS[127]}-${ROOM_WORDS[0]}-${ROOM_WORDS[127]}-10`);
  });

  it('two fresh rooms differ', () => {
    const a = newRoom(BASE);
    const b = newRoom(BASE);
    expect(a.roomKey).not.toBe(b.roomKey);
  });
});

describe('parseRoomLink (pasted links)', () => {
  it('reads a full link and re-bases it on this page', () => {
    const link = parseRoomLink(BASE, `https://other.example/spellplane/?transport=local#/t/amber-fox-river-42/${KEY}`);
    expect(link).toEqual(roomLink(BASE, 'amber-fox-river-42', KEY));
    expect(link?.url).toBe(`${BASE}#/t/amber-fox-river-42/${KEY}`);
  });

  it('reads a bare fragment and a bare path', () => {
    expect(parseRoomLink(BASE, `#/t/a-b-c-10/${KEY}`)?.roomId).toBe('a-b-c-10');
    expect(parseRoomLink(BASE, `/t/a-b-c-10/${KEY}`)?.roomKey).toBe(KEY);
    expect(parseRoomLink(BASE, `t/a-b-c-10/${KEY}`)?.roomKey).toBe(KEY);
  });

  it('finds the link inside a message, with surrounding whitespace and trailing punctuation', () => {
    expect(parseRoomLink(BASE, `  join us: ${BASE}#/t/amber-fox-river-42/${KEY}.  `)?.roomKey).toBe(KEY);
    expect(parseRoomLink(BASE, `<${BASE}#/t/amber-fox-river-42/${KEY}>`)?.roomKey).toBe(KEY);
    expect(parseRoomLink(BASE, `(${BASE}#/t/amber-fox-river-42/${KEY}/)`)?.roomId).toBe('amber-fox-river-42');
  });

  it('accepts the k= prefix of the design example link', () => {
    expect(parseRoomLink(BASE, `${BASE}#/t/amber-fox-93/k=${KEY}`)).toEqual(roomLink(BASE, 'amber-fox-93', KEY));
  });

  it('refuses text that is not a table link', () => {
    for (const text of ['', '   ', 'hello', BASE, `${BASE}#/`, `${BASE}#/lobby`, `${BASE}#/diag`, `${BASE}#/t/room-only`, `${BASE}#/x/a-b-c-10/${KEY}`]) {
      expect(parseRoomLink(BASE, text), text).toBeNull();
    }
  });

  it('refuses a key that is not 16 bytes base64url (it is the signalling password)', () => {
    for (const key of ['short', `${KEY}A`, KEY.slice(1), `${KEY.slice(0, 21)}=`, `${KEY.slice(0, 21)}+`, `${KEY.slice(0, 21)}/`]) {
      expect(parseRoomLink(BASE, `${BASE}#/t/a-b-c-10/${key}`), key).toBeNull();
    }
  });

  it('refuses a room id with characters a room id never has', () => {
    expect(parseRoomLink(BASE, `${BASE}#/t/${encodeURIComponent('a b')}/${KEY}`)).toBeNull();
    expect(parseRoomLink(BASE, `${BASE}#/t/-ab/${KEY}`)).toBeNull();
    expect(parseRoomLink(BASE, `${BASE}#/t/${'a'.repeat(65)}/${KEY}`)).toBeNull();
  });

  it('round-trips every fresh room through its own link', () => {
    for (let i = 0; i < 50; i++) {
      const link = newRoom(BASE);
      expect(parseRoomLink(BASE, link.url)).toEqual(link);
      expect(parseRoute(link.url.slice(link.url.indexOf('#')))).toEqual({ name: 'room', room: link.roomId, key: link.roomKey });
    }
  });
});

describe('routes added by M1-P5', () => {
  it('#/diag/<room>/<key> joins a diagnostics room; #/diag starts one', () => {
    expect(parseRoute('#/diag')).toEqual({ name: 'diag' });
    expect(parseRoute(`#/diag/diag-a-b-c-10/${KEY}`)).toEqual({ name: 'diagJoin', room: 'diag-a-b-c-10', key: KEY });
    expect(routeHash({ name: 'diagJoin', room: 'diag-a-b-c-10', key: KEY })).toBe(`#/diag/diag-a-b-c-10/${KEY}`);
    expect(parseRoute('#/diag/only-room').name).toBe('notFound');
  });
});
