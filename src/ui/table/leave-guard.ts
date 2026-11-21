/**
 * When a hash change leaves the shown table (journey.md 4.10 "Leaving": the browser's Back leaves like the arrow).
 * App asks the table frame to leave first when this answers true. M8-P8.
 */
import type { Route } from '../routes';

/** Whether `r` is a table route that renders the table frame and is left through leave.ts (the sandbox is not). */
export function isTableRoute(r: Route): boolean {
  return r.name === 'room' || r.name === 'practice' || r.name === 'computer';
}

/** Whether `a` and `b` show the same table: a room's `/watch` or `/rejoin/…` suffix changing is not leaving it. */
export function sameTable(a: Route, b: Route): boolean {
  if (a.name === 'room' && b.name === 'room') return a.room === b.room && a.key === b.key;
  if (a.name === 'practice' && b.name === 'practice') return a.room === b.room;
  if (a.name === 'computer' && b.name === 'computer') return a.room === b.room;
  return false;
}

/** Whether going from `current` to `next` leaves a table. */
export function leavesTable(current: Route, next: Route): boolean {
  return isTableRoute(current) && !sameTable(current, next);
}

/**
 * Whether the page goes on to the hash the change named once the guard's leave ran (leave.ts has gone Home): yes, unless that is
 * Home (then nothing more). Back to Decks keeps Decks; an invite or bring-back link pasted into the tab opens that room.
 */
export function keepsTarget(target: Route): boolean {
  return target.name !== 'home';
}
