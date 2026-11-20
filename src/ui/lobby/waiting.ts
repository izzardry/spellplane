/**
 * The waiting room's rules as pure functions (docs/design/m8/journey.md 4.8, 4.9, 4.7, 4.13; matchmaking.md 2.12):
 * the game code as a name, the deck rule and the picker's `allow`, the creator's start pill and the line that says what
 * is missing, the join field, the versus lines, the 0-life offer and the game-over view. M8-P4. No DOM, no clock.
 */
import type { DraftFormatSettings, LobbySettings, SeatId, TableState } from '../../core/types';
import type { BoosterSetup, DeckRecord } from '../../store/types';
import { isOccupied, readiness } from './seats';

/** The game code as the game's name: `amber-fox-93` → `AMBER FOX 93` (journey.md rulings: "Game code"). */
export function codeLabel(roomId: string): string {
  return roomId.split('-').filter(Boolean).join(' ').toUpperCase();
}

/** Which decks the table takes (Home's `ANY DECK │ BOOSTER DECKS ONLY`; the setup's `own decks` / `sealed decks`). */
export type DeckRule = 'any' | 'booster';

/**
 * The table's deck rule. Read from the optional `TableSettings.decks` (contract addition [M8-P4]); until the reducer
 * accepts that setting (core/reducer/table.ts, frozen tonight) a table reads `any` unless `fallback` says otherwise.
 */
export function deckRuleOf(state: TableState, fallback: DeckRule = 'any'): DeckRule {
  const v = (state.settings as { decks?: unknown }).decks;
  return v === 'booster' || v === 'any' ? v : fallback;
}

/** The kind of a deck record: a booster (sealed) deck, or custom. Old records without `kind` count by their source. */
export function deckKindOf(deck: Pick<DeckRecord, 'kind' | 'source' | 'seal'>): 'custom' | 'sealed' {
  if (deck.kind) return deck.kind;
  return deck.seal || deck.source === 'drafted' ? 'sealed' : 'custom';
}

/** The reason a custom deck may not be picked at a booster-decks-only table (journey.md 4.8). */
export const BOOSTER_ONLY_REASON = 'This table plays booster decks only.';

/**
 * The deck picker's `allow` for a table (journey.md 4.8: "With BOOSTER DECKS ONLY, custom decks are dimmed with the
 * reason"): true when the deck may be picked, else the reason. An empty deck is never allowed.
 */
export function deckAllow(rule: DeckRule): (deck: Pick<DeckRecord, 'kind' | 'source' | 'seal' | 'main'>) => true | string {
  return (deck) => {
    if (deck.main.length === 0) return 'This deck has no cards.';
    if (rule === 'booster' && deckKindOf(deck) !== 'sealed') return BOOSTER_ONLY_REASON;
    return true;
  };
}

/** A table that drafts before it plays: lobby settings set explicitly with a draft (journey.md 4.8 "Draft night"). */
export function isLiveDraft(state: TableState): boolean {
  return state.lobby !== undefined && state.lobby.draft !== null;
}

/** The boosters of a live draft, one set code per pack (at most three drawn). */
export function draftPacks(state: TableState): string[] {
  const lobby = state.lobby;
  if (!lobby || lobby.draft === null) return [];
  const d = lobby.draft as { packs?: number; grids?: number };
  const n = Math.max(1, Math.min(3, d.packs ?? 3));
  return Array.from({ length: n }, (_, i) => lobby.sets[Math.min(i, lobby.sets.length - 1)] ?? 'M19');
}

/** What the creator's pill says and does (journey.md 4.8 "Start"). */
export type StartPill =
  | { kind: 'waiting'; label: string }
  | { kind: 'start'; label: string; counting: boolean };

/** Seconds of the self-pressing start (journey.md 4.8: `START · 3`). */
export const START_COUNT = 3;

export interface StartInput {
  state: TableState;
  /** Every seated player's browser is connected to this one (the creator's view of the pairs). */
  connected: boolean;
  /** Seconds left of the countdown, or null when it does not run. */
  count: number | null;
}

/** Open seats: chairs of the format nobody holds. */
export function openSeats(state: TableState): number {
  return Object.keys(state.seats).filter((s) => !isOccupied(state, s)).length;
}

/**
 * The creator's pill (journey.md 4.8, matchmaking.md 2.12): `WAITING · 1 OPEN SEAT`, `WAITING · 1 OF 2 READY`,
 * `WAITING · CONNECTING`, then `START · 3` counting down at a table with automatic setup, or `START` without it.
 */
export function startPill({ state, connected, count }: StartInput): StartPill {
  const open = openSeats(state);
  if (open > 0) return { kind: 'waiting', label: `WAITING · ${open} OPEN SEAT${open === 1 ? '' : 'S'}` };
  const r = readiness(state);
  if (!r.allReady) return { kind: 'waiting', label: `WAITING · ${r.ready} OF ${r.seated} READY` };
  if (!connected) return { kind: 'waiting', label: 'WAITING · CONNECTING' };
  if (state.settings.autoSetup === true && count !== null) return { kind: 'start', label: `START · ${count}`, counting: true };
  return { kind: 'start', label: 'START', counting: false };
}

/** Whether the self-pressing countdown may run: every seat taken, ready and connected, at a table with automatic setup. */
export function countdownMayRun(state: TableState, connected: boolean): boolean {
  return state.stage === 'lobby' && state.settings.autoSetup === true && openSeats(state) === 0 && readiness(state).allReady && connected;
}

/**
 * The line that always says what is missing (journey.md 4.8): one more player, who is not ready, who is not connected,
 * the countdown, or whom the table waits for to start.
 */
export function missingLine(state: TableState, me: SeatId | null, host: SeatId | null, connected: boolean, count: number | null): string {
  if (state.stage !== 'lobby') return 'The game has started.';
  const open = openSeats(state);
  if (open > 0) return open === 1 ? 'Waiting for one more player.' : `Waiting for ${open} more players.`;
  const notReady = Object.values(state.seats).filter((s) => isOccupied(state, s.id) && !s.ready);
  if (notReady.length > 0) {
    if (me !== null && notReady.some((s) => s.id === me)) return notReady.length === 1 ? 'Choose a deck and press READY.' : 'Choose a deck and press READY. Others are still choosing.';
    return `Waiting for ${names(notReady.map((s) => s.name))} to be ready.`;
  }
  if (!connected) return 'Waiting for everyone to connect.';
  if (count !== null) return `Starting in ${count}…`;
  if (me !== null && me === host) return 'Everyone is ready.';
  return `Waiting for ${(host && state.seats[host]?.name) || 'the host'} to start the game.`;
}

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)!}`;
}

/** What `JOIN A GAME…` does with the pasted text (journey.md 4.9). */
export type JoinVerdict = { kind: 'go'; hash: string } | { kind: 'code' } | { kind: 'bad' } | { kind: 'empty' };

/** The answer to a bare code (journey.md 4.9). */
export const BARE_CODE_TEXT = 'Paste the whole link: the code alone does not carry the key.';
/** The answer to text that is neither a link nor a code. */
export const NOT_A_LINK_TEXT = 'This is not a complete table link. Ask for it again.';

/** A bare game code: three or more words and a number, in any case, with spaces or dashes (`amber fox 93`). */
export function isBareCode(text: string): boolean {
  return /^[a-z]+(?:[\s-]+[a-z]+){1,4}[\s-]+\d{1,3}$/i.test(text.trim());
}

/** Judge pasted text: `parse` finds a table link (also inside a sentence; ui/lobby/room.ts parseRoomLink). */
export function joinVerdict(text: string, parse: (text: string) => { roomId: string; roomKey: string } | null): JoinVerdict {
  const t = text.trim();
  if (!t) return { kind: 'empty' };
  const link = parse(t);
  if (link) return { kind: 'go', hash: `#/t/${encodeURIComponent(link.roomId)}/${link.roomKey}` };
  if (isBareCode(t)) return { kind: 'code' };
  return { kind: 'bad' };
}

/** The opening hand the versus screen counts (session/entry.ts OPENING_HAND). */
export const VERSUS_HAND = 7;
/** The versus screen stays at least this long (journey.md 4.7). */
export const VERSUS_MIN_MS = 1200;
/** After this long without every player connected and dealt, the versus screen says why (journey.md 4.7). */
export const VERSUS_FAIL_MS = 30_000;

/** One player's column on the versus screen. */
export interface VersusColumn {
  seat: SeatId;
  name: string;
  colour: number;
  me: boolean;
  connected: boolean;
  /** Committed card count (never the deck's name). */
  cards: number;
  shuffled: boolean;
  /** Cards in the opening hand so far, of VERSUS_HAND. */
  hand: number;
  dealt: boolean;
}

function handCount(state: TableState, seat: SeatId): number {
  const z = state.zones[`hand:${seat}`];
  if (!z) return 0;
  return z.visibility === 'public' ? z.ids.length : (z.count ?? z.ids.length);
}

/** The columns of the versus screen, in seat order. `connected(seat)` is this browser's view of that seat's holder. */
export function versusColumns(state: TableState, me: SeatId | null, connected: (seat: SeatId) => boolean): VersusColumn[] {
  const game = state.games ?? 0;
  return Object.values(state.seats)
    .filter((s) => isOccupied(state, s.id))
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      const dealt = s.dealt === game;
      const hand = handCount(state, s.id);
      return {
        seat: s.id,
        name: s.name,
        colour: s.colour,
        me: s.id === me,
        connected: s.id === me || connected(s.id),
        cards: state.commitments[s.id]?.instanceIds.length ?? 0,
        shuffled: dealt || hand > 0,
        hand,
        dealt,
      };
    });
}

/** Whether the setup is done: every player connected and dealt for this game. */
export function versusDone(columns: VersusColumn[]): boolean {
  return columns.length > 0 && columns.every((c) => c.connected && c.dealt);
}

/** The failure copy after VERSUS_FAIL_MS (journey.md 4.7). */
export function versusFailure(columns: VersusColumn[]): string {
  const away = columns.find((c) => !c.connected);
  if (away) return `${away.name} could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.`;
  return 'The table could not be set up. Some cards could not be dealt; check your connection.';
}

/** The poison count that ends a player (journey.md 4.13). */
export const POISON_LIMIT = 10;

/**
 * Whether `seat` is offered the quiet concede chip (journey.md 4.13: "A life total reaches 0 (or 10 poison)"): a seat
 * still in the game, in the match stage, before a result. Nobody else is prompted.
 */
export function concedeOffer(state: TableState, seat: SeatId | null): null | { reason: 'life' | 'poison'; text: string } {
  if (seat === null || state.stage !== 'match' || state.result) return null;
  // Conceding needs someone to concede to: a table with one player (the sandbox) offers nothing.
  if (Object.values(state.seats).filter((x) => isOccupied(state, x.id)).length < 2) return null;
  const s = state.seats[seat];
  if (!s || s.conceded === true) return null;
  if (s.life <= 0) return { reason: 'life', text: `You are at ${s.life} life.` };
  if ((s.counters['poison'] ?? 0) >= POISON_LIMIT) return { reason: 'poison', text: `You have ${s.counters['poison']} poison counters.` };
  return null;
}

/** The kind of table, for the game-over overlay's primary (journey.md 4.13): GameSummary.kind plus a draft night. */
export type EndKind = 'private' | 'matched' | 'draft' | 'solo';

export interface GameOverView {
  headline: 'VICTORY' | 'DEFEAT' | 'GAME OVER';
  reason: string;
  primary: { id: 'findMatch' | 'rematch' | 'nextGame'; label: string };
  /** The rating line, only when the MatchRecord holds one. */
  rating: string | null;
  players: { seat: SeatId; name: string; life: number; colour: number; won: boolean }[];
}

/**
 * The game-over overlay's content (journey.md 4.13). `me` null is a spectator (`GAME OVER`). The primary follows the
 * table: matched → `FIND ANOTHER MATCH`, private and solo → `REMATCH`, draft night → `NEXT GAME`.
 */
export function gameOverView(state: TableState, me: SeatId | null, kind: EndKind, rated?: { before: number; after: number } | null): GameOverView | null {
  const r = state.result;
  if (!r) return null;
  const won = me !== null && r.winners.includes(me);
  const headline = me === null || !state.seats[me] ? 'GAME OVER' : won ? 'VICTORY' : 'DEFEAT';
  const conceded = Object.values(state.seats)
    .filter((s) => s.conceded === true)
    .sort((a, b) => a.index - b.index)
    .map((s) => (s.id === me ? 'You' : s.name));
  const turn = state.turn.number;
  const reason = conceded.length === 0 ? 'The game is over.' : `${names(conceded)} conceded on turn ${turn}.`;
  const primary = kind === 'matched' ? { id: 'findMatch' as const, label: 'FIND ANOTHER MATCH' } : kind === 'draft' ? { id: 'nextGame' as const, label: 'NEXT GAME' } : { id: 'rematch' as const, label: 'REMATCH' };
  let rating: string | null = null;
  if (rated) {
    const d = rated.after - rated.before;
    rating = `RANK ${rated.after}  ${d >= 0 ? '▲ +' : '▼ −'}${Math.abs(d)}`;
  }
  const players = Object.values(state.seats)
    .filter((s) => isOccupied(state, s.id))
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ seat: s.id, name: s.name, life: s.life, colour: s.colour, won: r.winners.includes(s.id) }));
  return { headline, reason, primary, rating, players };
}

/** A draft night's booster setup (BoosterSetupSheet's value, store/types.ts) as the table's lobby settings (journey.md 4.4). */
export function lobbyFromBoosters(b: BoosterSetup): LobbySettings {
  const packs = Math.max(1, Math.round(b.packs));
  const draft: DraftFormatSettings =
    b.how === 'sealed'
      ? { format: 'sealed', packs }
      : b.how === 'rochester'
        ? { format: 'rochester', packs, burn: 0 }
        : b.how === 'winston'
          ? { format: 'winston', packs }
          : b.how === 'grid'
            ? { format: 'grid', grids: Math.max(1, packs * 3) }
            : { format: 'pass', packs, picks: Math.max(1, Math.round(b.picks)) };
  return { draft, sets: b.sets.length ? [...b.sets] : ['M19'], pickTimer: b.pickTimer };
}

/** The table's lobby settings as a booster setup for the sheet; the default setup where the table has no draft. */
export function boostersFromLobby(lobby: LobbySettings | undefined, fallback: BoosterSetup): BoosterSetup {
  const d = lobby?.draft;
  if (!lobby || !d || d.format === 'teamDraft' || d.format === 'teamSealed') return fallback;
  const packs = d.format === 'grid' ? Math.max(1, Math.round(d.grids / 3)) : d.packs;
  return { how: d.format, packs, picks: d.format === 'pass' ? d.picks : 1, sets: [...lobby.sets], pickTimer: lobby.pickTimer };
}

/** The game's kind for the overlay when the frame does not say: matched, a draft night, else a private table. */
export function endKindOf(state: TableState): EndKind {
  if (state.settings.matched === true) return 'matched';
  if (state.draft !== undefined) return 'draft';
  return 'private';
}
