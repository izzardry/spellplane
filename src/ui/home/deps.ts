/**
 * What Home's launchers need, gathered from the page (App.svelte's props and the table context, ui/table/context.ts)
 * with the harness page's fakes taking precedence. Kept out of Home.svelte so the defaults are unit-testable. M8-P2.
 */
import type { CardRef } from '../../core/types';
import type { StarterPoolSource } from '../../data/starter';
import type { Matchmaker, TableSession } from '../../session/types';
import type { GameStore } from '../../store/types';
import { faceUrl } from '../decks/parts/face-url';
import { toasts } from '../design/toasts';
import { newRoom as freshRoom, pageBase } from '../lobby/room';
import type { LaunchDeps } from '../play/launch';
import type { TableDeps } from '../table/types';
import type { RoomLink } from '../types';
import { flags } from '../../util/flags';

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
    // A new computer room: its route (`#/c/<room>`, ui/computer/ComputerRoute.svelte) creates the game with the page's
    // services for the deck Home just selected (`touchDeck` stored it in the Home prefs). Creating it here needed the
    // computer's page services, which nothing provides on Home, so SPARRING fell back to ALONE (M8 gate).
    openComputer: given.openComputer ?? (() => Promise.resolve(newComputerRoom())),
    ...(given.markCreated ? { markCreated: given.markCreated } : {}),
    ...(given.newPracticeId ? { newPracticeId: given.newPracticeId } : {}),
    ...(starterSource ? { starterSource } : {}),
    ...(given.buildStarterDeck ? { buildStarterDeck: given.buildStarterDeck } : {}),
    ...(given.seed ? { seed: given.seed } : {}),
    ...(given.pending !== undefined ? { pending: given.pending } : {}),
    ...(openPractice ? { openPractice } : {}),
  };
}

/**
 * The hero's card images from the page's face source, as the deck tiles get theirs (ui/decks/parts/face-url.ts): a
 * Scryfall face is its URL, and a placeholder face (`?faces=placeholder`, test and dev builds) is drawn once as a small
 * data URL, so the hero shows its cover face in screenshots too (gate M8 round 3 E1). Only under that flag: elsewhere a
 * placeholder (an unknown card) stays the card back. Null (the back) when the face cannot be had.
 */
export function pageFaces(page: TableDeps | null): (ref: CardRef) => Promise<string | null> {
  const faces = page?.faces;
  if (!faces) return () => Promise.resolve(null);
  const drawn = placeholders();
  return async (ref) => {
    try {
      if (drawn) return await faceUrl(faces, ref, 'normal');
      const f = await faces.faceFor(ref, 0, 'normal');
      return f.kind === 'url' ? f.url : null;
    } catch {
      return null;
    }
  };
}

/** Whether the page draws placeholder faces (the `?faces=placeholder` flag of test and dev builds). */
function placeholders(): boolean {
  try {
    return flags().faces === 'placeholder';
  } catch {
    return false;
  }
}
