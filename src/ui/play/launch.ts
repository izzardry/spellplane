/**
 * Home's launchers, one per mode, every dependency passed in (journey.md 4.1 "What the primary does", section 6 first
 * run; contracts.md Part G "History and saving" item 1, "Journey and Home"). M8-P2.
 *
 * - SOLO · ALONE: a practice table `#/p/<room>` (session/practice.ts deals the deck when the route opens it).
 * - SOLO · SPARRING: `openComputer`; while it rejects (no computer in this build) the launcher falls back to ALONE
 *   with a toast.
 * - PRIVATE GAME and DRAFT NIGHT: a new room whose creator applies `autoSetup`, the format and the lobby settings of
 *   the booster setup (`takePendingSetup`, read by the table route), a GameSummary, then the room.
 * - QUICK MATCH: `matchmaker.seek` with the queues of the Home prefs and the deck.
 * - First run: one press with no deck builds a starter deck, saves it, selects it and starts.
 */
import type { Format, LobbySettings } from '../../core/types';
import { buildStarterDeck as stubStarter, type StarterDeck, type StarterPoolSource } from '../../data/starter';
import { newPracticeRoomId } from '../../session/practice';
import type { Matchmaker } from '../../session/types';
import type { DeckRecord, DeckStore, GameStore, GameSummary, HintId, HomePrefs, SettingsStore } from '../../store/types';
import { boosterToLobby, deckKind, queuesFor } from '../home/view';

/** What a new networked room carries to the table route: the creator applies it once (M8-P8 wires the route). */
export interface PendingSetup {
  format: Format;
  autoSetup: true;
  /** Lobby settings; `draft: null` plays constructed decks. */
  lobby: LobbySettings;
  /** The deck to bring, if any (the waiting room's deck slot starts with it). */
  deckId: string | null;
}

const PENDING = 'spellplane.pending.';

/** Keep a new room's setup for the table route (sessionStorage: this tab only, survives a reload). */
export function savePendingSetup(roomId: string, setup: PendingSetup, store: Pick<Storage, 'setItem'> | null = safeSession()): void {
  try {
    store?.setItem(PENDING + roomId, JSON.stringify(setup));
  } catch {
    /* storage blocked: the room opens with the defaults */
  }
}

/** The setup kept for `roomId` (and forget it), or null. */
export function takePendingSetup(roomId: string, store: Pick<Storage, 'getItem' | 'removeItem'> | null = safeSession()): PendingSetup | null {
  try {
    const raw = store?.getItem(PENDING + roomId) ?? null;
    if (raw === null) return null;
    store?.removeItem(PENDING + roomId);
    return JSON.parse(raw) as PendingSetup;
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** A toast action. */
export interface ToastAction {
  label: string;
  run(): void;
}

/** Everything a launcher may need; each launcher reads only its part. */
export interface LaunchDeps {
  games: GameStore | null;
  decks: DeckStore | null;
  settings: SettingsStore | null;
  /** Navigate to a hash (`#/p/<room>`, `#/t/<room>/<key>`). */
  go(hash: string): void;
  toast(text: string, action?: ToastAction): void;
  now(): number;
  /** A fresh room id and key (ui/lobby/room.ts newRoom). */
  newRoom(): { roomId: string; roomKey: string };
  /** Record that this tab created the room (its creator may sit alone at once). */
  markCreated?(roomId: string): void;
  newPracticeId?(): string;
  /** Create a computer game for the deck and resolve to its room id (session/computer.ts via main.ts). Rejects without a computer. */
  openComputer?(opts: { deckId: string | null }): Promise<string>;
  matchmaker?: Matchmaker;
  /** Where a starter deck's pool comes from (fixtures in tests). */
  starterSource?: StarterPoolSource;
  buildStarterDeck?: typeof stubStarter;
  /** A seed for the starter deck (tests pin it). */
  seed?(): string;
  pending?: Pick<Storage, 'setItem'> | null;
}

/** The `decks` value of a GameSummary for a deck. */
function deckSource(deck: DeckRecord | null): GameSummary['decks'] {
  return deck && deckKind(deck) === 'sealed' ? 'draftPrebuilt' : 'constructed';
}

async function touchDeck(deps: LaunchDeps, deck: DeckRecord | null, prefs: HomePrefs): Promise<void> {
  if (!deck) return;
  await deps.decks?.put({ ...deck, lastPlayedAt: deps.now() }).catch(() => undefined);
  if (prefs.deckId !== deck.id) await deps.settings?.set('home', { ...prefs, deckId: deck.id }).catch(() => undefined);
}

/** The hash of a practice table. */
export function practiceHash(roomId: string): string {
  return `#/p/${encodeURIComponent(roomId)}`;
}

/** The hash of a computer table. */
export function computerHash(roomId: string): string {
  return `#/c/${encodeURIComponent(roomId)}`;
}

/** The hash of a networked table. */
export function roomHash(roomId: string, roomKey: string): string {
  return `#/t/${encodeURIComponent(roomId)}/${encodeURIComponent(roomKey)}`;
}

/** The toast when Sparring cannot start (computer.md: SOLO offers ALONE while the computer is missing). */
export const SPARRING_FALLBACK = 'Sparring is not available here. You play alone.';

/** SOLO: against Sparring, or alone (journey.md 4.1). Resolves to the route it opened. */
export async function launchSolo(deps: LaunchDeps, prefs: HomePrefs, deck: DeckRecord | null, opponent: 'sparring' | 'alone' = prefs.solo.opponent): Promise<string> {
  await touchDeck(deps, deck, prefs);
  if (opponent === 'sparring' && deps.openComputer) {
    try {
      const roomId = await deps.openComputer({ deckId: deck?.id ?? null });
      await deps.games?.create({ code: roomId, key: '', kind: 'solo', format: '1v1', decks: deckSource(deck), opponent: 'sparring', ...(deck ? { deck: { id: deck.id, name: deck.name } } : {}) });
      await deps.games?.endOlderSolo(3);
      const hash = computerHash(roomId);
      deps.go(hash);
      return hash;
    } catch {
      deps.toast(SPARRING_FALLBACK);
    }
  }
  const roomId = (deps.newPracticeId ?? newPracticeRoomId)();
  await deps.games?.create({ code: roomId, key: '', kind: 'solo', format: '1v1', decks: deckSource(deck), opponent: 'dummy', ...(deck ? { deck: { id: deck.id, name: deck.name } } : {}) });
  // The newest three unfinished solo games stay resumable, the new one included (contracts.md Part G, History item 1).
  await deps.games?.endOlderSolo(3);
  const hash = practiceHash(roomId);
  deps.go(hash);
  return hash;
}

async function launchRoom(deps: LaunchDeps, setup: PendingSetup, meta: Pick<GameSummary, 'decks'> & { deck: DeckRecord | null }): Promise<string> {
  const { roomId, roomKey } = deps.newRoom();
  deps.markCreated?.(roomId);
  savePendingSetup(roomId, setup, deps.pending === undefined ? safeSession() : deps.pending);
  await deps.games?.create({ code: roomId, key: roomKey, kind: 'private', format: setup.format, decks: meta.decks, ...(meta.deck ? { deck: { id: meta.deck.id, name: meta.deck.name } } : {}) });
  const hash = roomHash(roomId, roomKey);
  deps.go(hash);
  return hash;
}

/** The lobby settings of a table that plays constructed decks. */
export const CONSTRUCTED_LOBBY: LobbySettings = { draft: null, sets: ['M19'], pickTimer: false };

/** PRIVATE GAME: `CREATE TABLE` (journey.md 4.1, 4.8). */
export async function launchPrivate(deps: LaunchDeps, prefs: HomePrefs, deck: DeckRecord | null): Promise<string> {
  await touchDeck(deps, deck, prefs);
  return launchRoom(deps, { format: prefs.private.format, autoSetup: true, lobby: CONSTRUCTED_LOBBY, deckId: deck?.id ?? null }, { decks: deckSource(deck), deck });
}

/** DRAFT NIGHT: `OPEN DRAFT TABLE` with the booster setup as the lobby settings (journey.md 4.1, J12). */
export async function launchDraft(deps: LaunchDeps, prefs: HomePrefs): Promise<string> {
  return launchRoom(deps, { format: prefs.draft.format, autoSetup: true, lobby: boosterToLobby(prefs.draft.boosters), deckId: null }, { decks: 'draftLive', deck: null });
}

/** QUICK MATCH: `FIND MATCH` (journey.md 4.5; matchmaking.md 2.13). */
export async function launchQuick(deps: LaunchDeps, prefs: HomePrefs, deck: DeckRecord, alsoCasual = false): Promise<void> {
  const queues = queuesFor(prefs.quick, deckKind(deck), alsoCasual);
  if (deps.settings) {
    const seen = await deps.settings.get('hintsSeen').catch((): HintId[] => []);
    if (!seen.includes('lobbyPrivacy')) await deps.settings.set('hintsSeen', [...seen, 'lobbyPrivacy']).catch(() => undefined);
    await deps.settings.set('lastQueue', queues[0]!).catch(() => undefined);
  }
  deps.matchmaker?.seek({ queues, deckId: deck.id });
}

/** The colours a starter deck may have; the first run uses green (journey.md section 6: `STARTER · GREEN`). */
export const STARTER_COLOUR = 'G' as const;

/** A starter deck as a library record (a custom deck, journey.md section 6). */
export function starterRecord(s: StarterDeck, id: string, now: number): DeckRecord {
  return { id, name: s.name, main: s.main, side: [], source: 'built', kind: 'custom', size: 40, createdAt: now, updatedAt: now, lastPlayedAt: now };
}

/** Why the first run could not make a deck (the sheet offers TRY AGAIN, PASTE A DECK LIST, OPEN AN EMPTY TABLE). */
export class FirstRunError extends Error {
  constructor(cause: unknown) {
    super(`A first deck needs a connection once. (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = 'FirstRunError';
  }
}

/** First run: build a starter deck, save it, select it, then start SOLO (journey.md section 6). Rejects with FirstRunError. */
export async function launchFirstRun(deps: LaunchDeps, prefs: HomePrefs): Promise<{ deck: DeckRecord; hash: string }> {
  const build = deps.buildStarterDeck ?? stubStarter;
  let starter: StarterDeck;
  try {
    if (!deps.starterSource) throw new Error('no card source');
    starter = await build(deps.starterSource, { colour: STARTER_COLOUR, seed: deps.seed?.() ?? String(deps.now()) });
  } catch (e) {
    throw new FirstRunError(e);
  }
  const now = deps.now();
  const deck = starterRecord(starter, `starter-${now.toString(36)}`, now);
  await deps.decks?.put(deck);
  const next = { ...prefs, deckId: deck.id };
  await deps.settings?.set('home', next).catch(() => undefined);
  const hash = await launchSolo(deps, next, deck);
  return { deck, hash };
}

/** OPEN AN EMPTY TABLE from the first-run sheet: a practice table with no deck. */
export function launchEmpty(deps: LaunchDeps, prefs: HomePrefs): Promise<string> {
  return launchSolo(deps, prefs, null, 'alone');
}
