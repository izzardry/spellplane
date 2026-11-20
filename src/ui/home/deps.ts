/**
 * What Home's launchers need, gathered from the page (App.svelte's props and the table context, ui/table/context.ts)
 * with the harness page's fakes taking precedence. Kept out of Home.svelte so the defaults are unit-testable. M8-P2.
 */
import type { CardRef } from '../../core/types';
import type { StarterPoolSource } from '../../data/starter';
import { createComputerGame } from '../../session/computer';
import type { Matchmaker, TableSession } from '../../session/types';
import type { GameStore } from '../../store/types';
import { toasts } from '../design/toasts';
import { newRoom as freshRoom, pageBase } from '../lobby/room';
import type { LaunchDeps } from '../play/launch';
import type { TableDeps } from '../table/types';
import type { RoomLink } from '../types';

/** What the page hands Home (App.svelte) besides the table context. */
export interface HomePage {
  games: GameStore | null;
  newRoom?: (() => RoomLink) | undefined;
  go(hash: string): void;
  openPractice?: ((roomId: string) => Promise<TableSession>) | undefined;
  now(): number;
  page: TableDeps | null;
  matchmaker: Matchmaker;
}

/** A computer room id (`c-` and 12 random base-36 characters; computer.md section 11). */
export function newComputerRoom(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 12; i++) id += Math.floor(random() * 36).toString(36);
  return `c-${id}`;
}

/** The starter generator's pool from the page's card source: one set's cards by search (fixtures in tests). */
export function starterSourceOf(page: TableDeps | null): StarterPoolSource | undefined {
  const search = page?.cardData.searchCards?.bind(page.cardData);
  if (!search) return undefined;
  return { pool: (set) => search(`e:${set.toLowerCase()}`) };
}

/** The launchers' dependencies: `given` first, then the page. */
export function launchDeps(given: Partial<LaunchDeps>, home: HomePage): LaunchDeps {
  const starterSource = given.starterSource ?? starterSourceOf(home.page);
  const openPractice = given.openPractice ?? home.openPractice;
  return {
    games: given.games !== undefined ? given.games : home.games,
    decks: given.decks !== undefined ? given.decks : (home.page?.decks ?? null),
    settings: given.settings !== undefined ? given.settings : (home.page?.settings ?? null),
    go: given.go ?? home.go,
    toast: given.toast ?? ((text, action) => void toasts.info(text, action)),
    now: given.now ?? home.now,
    newRoom:
      given.newRoom ??
      (() => {
        const l = home.newRoom ? home.newRoom() : freshRoom(pageBase(location.href));
        return { roomId: l.roomId, roomKey: l.roomKey };
      }),
    matchmaker: given.matchmaker ?? home.matchmaker,
    // A computer game is created (and saved) here, then reopened by its route (`#/c/<room>`).
    openComputer:
      given.openComputer ??
      (async ({ deckId }) => {
        const roomId = newComputerRoom();
        const g = await createComputerGame({ roomId, deckId });
        g.handle.dispose();
        g.session.dispose();
        return roomId;
      }),
    ...(given.markCreated ? { markCreated: given.markCreated } : {}),
    ...(given.newPracticeId ? { newPracticeId: given.newPracticeId } : {}),
    ...(starterSource ? { starterSource } : {}),
    ...(given.buildStarterDeck ? { buildStarterDeck: given.buildStarterDeck } : {}),
    ...(given.seed ? { seed: given.seed } : {}),
    ...(given.pending !== undefined ? { pending: given.pending } : {}),
    ...(openPractice ? { openPractice } : {}),
  };
}

/** The hero's card images from the page's face source (placeholder faces show the card back: null). */
export function pageFaces(page: TableDeps | null): (ref: CardRef) => Promise<string | null> {
  const faces = page?.faces;
  if (!faces) return () => Promise.resolve(null);
  return async (ref) => {
    const f = await faces.faceFor(ref, 0, 'normal');
    return f.kind === 'url' ? f.url : null;
  };
}
