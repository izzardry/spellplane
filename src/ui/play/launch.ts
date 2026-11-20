/**
 * Launching a game from Home (journey.md 4.1; PLAN M8-P2 "launching every mode"). Stub by M8-C: the hashes of the
 * table routes and a fresh practice room. M8-P2 owns the file.
 */
import { PRACTICE_PREFIX } from '../../session/practice';

/** The hash of a practice table (`#/p/<room>`). */
export function practiceHash(roomId: string): string {
  return `#/p/${encodeURIComponent(roomId)}`;
}

/** The hash of a computer game (`#/c/<room>`). */
export function computerHash(roomId: string): string {
  return `#/c/${encodeURIComponent(roomId)}`;
}

/** The hash of a networked table (`#/t/<room>/<key>`). */
export function roomHash(roomId: string, roomKey: string): string {
  return `#/t/${encodeURIComponent(roomId)}/${encodeURIComponent(roomKey)}`;
}

/** A fresh practice room id (`p-` and 12 random base-36 characters; computer.md section 11). */
export function newPracticeRoom(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 12; i++) id += Math.floor(random() * 36).toString(36);
  return PRACTICE_PREFIX + id;
}

/** The hash that reopens a game of History (persistence.md section 4): its room, practice table or computer game. */
export function summaryHash(g: { code: string; key: string; kind: 'private' | 'matched' | 'solo'; opponent?: 'sparring' | 'dummy' }): string {
  if (g.kind !== 'solo') return roomHash(g.code, g.key);
  return g.code.startsWith(PRACTICE_PREFIX) && g.opponent !== 'sparring' ? practiceHash(g.code) : computerHash(g.code);
}
