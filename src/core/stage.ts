/**
 * The evening's stage machine (DESIGN "Specification: card data, packs and draft formats", Evening stages: `lobby →
 * draft → build → match → build → match …`; the host advances from lobby, draft advances automatically, build advances
 * when all seated players are Ready, from match any player proposes "next game" or "new draft" and the others
 * confirm; "Pre-game: draft, sealed and deck building": one link for the whole evening). Pure. Contracts: M2-C
 * (edges, events, the transition function, host and lobby validation); M2-P7 implements the stubs and wires
 * `stageProblem` and `enterStage` into the `stageSet` reducer (core/reducer/table.ts).
 */
import type { StageSetAction } from './actions';
import { seatedInOrder } from './drafting';
import type { DraftFormatSettings, LobbySettings, SeatId, Stage, TableState } from './types';
import { DEFAULT_LOBBY_SETTINGS } from './types';

/** Every stage in evening order (DESIGN "Data model and protocol", TableState.stage). */
export const STAGES: readonly Stage[] = ['lobby', 'draft', 'build', 'match'];

/**
 * What moves the evening on (DESIGN "Specification: card data, packs and draft formats", Evening stages):
 * - `start`: the host leaves the lobby (to the draft, or straight to a match with constructed decks);
 * - `draftDone`: the last pick is made or every sealed pool is open (automatic);
 * - `allReady`: every seated player pressed Ready in the builder;
 * - `nextGame`: a player proposed the next game (or a rematch) and the others confirmed: back to the builder to sideboard;
 * - `newDraft`: a player proposed a new draft on the same link and the others confirmed: back to the lobby.
 */
export type StageEvent = 'start' | 'draftDone' | 'allReady' | 'nextGame' | 'newDraft';

/**
 * The allowed stage changes (DESIGN "Specification: card data, packs and draft formats", Evening stages). `lobby → match`
 * is the constructed path M1 already uses; `draft → lobby` lets the host abandon a draft (DECISIONS [M2-C]).
 */
export const STAGE_EDGES: Readonly<Record<Stage, readonly Stage[]>> = {
  lobby: ['draft', 'match'],
  draft: ['build', 'lobby'],
  build: ['match', 'lobby'],
  match: ['build', 'lobby'],
};

/** Whether `from → to` is an edge of the stage machine (DESIGN "Specification: card data, packs and draft formats", Evening stages). */
export function canMove(from: Stage, to: Stage): boolean {
  return STAGE_EDGES[from].includes(to);
}

/**
 * The stage an event leads to from `from`, or null when the event does not apply there (DESIGN "Specification: card
 * data, packs and draft formats", Evening stages). `lobby` is the table's lobby settings: `start` goes to the draft
 * when they choose a draft or sealed, else straight to the match.
 */
export function nextStage(from: Stage, event: StageEvent, lobby: LobbySettings = DEFAULT_LOBBY_SETTINGS): Stage | null {
  switch (event) {
    case 'start':
      return from === 'lobby' ? (lobby.draft === null ? 'match' : 'draft') : null;
    case 'draftDone':
      return from === 'draft' ? 'build' : null;
    case 'allReady':
      return from === 'build' ? 'match' : null;
    case 'nextGame':
      return from === 'match' ? 'build' : null;
    case 'newDraft':
      return from === 'lobby' ? null : 'lobby';
  }
}

/** The table's lobby settings, defaults filled in (core/types.ts TableState.lobby). */
export function lobbyOf(state: TableState): LobbySettings {
  return state.lobby ?? DEFAULT_LOBBY_SETTINGS;
}

/**
 * The host: the seated player with the lowest seat index (DESIGN "Specification: card data, packs and draft formats",
 * Evening stages: "the host advances from lobby"; the same rule picks the sequencer, DESIGN "Sequencing" 1). Null on
 * an empty table. DECISIONS [M2-C].
 */
export function hostSeat(state: TableState): SeatId | null {
  return seatedInOrder(state)[0] ?? null;
}

/** Upper bounds the lobby accepts (DECISIONS [M2-C]; the design gives defaults only). */
export const LOBBY_LIMITS = { packs: 12, picks: 4, burn: 14, grids: 18, sets: 12, setCode: 16 } as const;

const int = (v: unknown, min: number, max: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function formatProblem(d: DraftFormatSettings): string | null {
  const L = LOBBY_LIMITS;
  switch (d.format) {
    case 'pass':
    case 'teamDraft':
      if (!int(d.packs, 1, L.packs)) return `packs must be 1 to ${L.packs}`;
      return int(d.picks, 1, L.picks) ? null : `picks per pass must be 1 to ${L.picks}`;
    case 'sealed':
    case 'teamSealed':
    case 'winston':
      return int(d.packs, 1, L.packs) ? null : `packs must be 1 to ${L.packs}`;
    case 'rochester':
      if (!int(d.packs, 1, L.packs)) return `packs must be 1 to ${L.packs}`;
      return int(d.burn, 0, L.burn) ? null : `burn must be 0 to ${L.burn}`;
    case 'grid':
      return int(d.grids, 1, L.grids) ? null : `grids must be 1 to ${L.grids}`;
    default:
      return 'unknown draft format';
  }
}

const SETTINGS_KEYS: Record<string, readonly string[]> = {
  pass: ['format', 'packs', 'picks'],
  teamDraft: ['format', 'packs', 'picks'],
  sealed: ['format', 'packs'],
  teamSealed: ['format', 'packs'],
  winston: ['format', 'packs'],
  rochester: ['format', 'packs', 'burn'],
  grid: ['format', 'grids'],
};

/**
 * Why `lobby` is not a valid set of lobby settings, or null (DESIGN "Pre-game", Lobby settings). Structural only: it
 * does not check that the seat count suits the format (Winston and Grid are for two seats; that is `stageProblem`'s).
 * Total on untrusted input: a malformed value is refused, never thrown on.
 */
export function lobbyProblem(lobby: unknown): string | null {
  if (typeof lobby !== 'object' || lobby === null || Array.isArray(lobby)) return 'lobby settings must be an object';
  const l = lobby as Record<string, unknown>;
  for (const k of Object.keys(l)) if (k !== 'draft' && k !== 'sets' && k !== 'pickTimer') return `unknown lobby setting ${k}`;
  if (typeof l.pickTimer !== 'boolean') return 'pickTimer must be true or false';
  const sets = l.sets;
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > LOBBY_LIMITS.sets) return `choose 1 to ${LOBBY_LIMITS.sets} sets`;
  for (const c of sets) if (typeof c !== 'string' || !/^[A-Za-z0-9]+$/.test(c) || c.length > LOBBY_LIMITS.setCode) return 'invalid set code';
  if (l.draft === null) return null;
  if (typeof l.draft !== 'object' || l.draft === undefined || Array.isArray(l.draft)) return 'draft must be an object or null';
  const d = l.draft as Record<string, unknown>;
  const keys = typeof d.format === 'string' ? SETTINGS_KEYS[d.format] : undefined;
  if (keys === undefined || !Object.hasOwn(SETTINGS_KEYS, d.format as string)) return 'unknown draft format';
  for (const k of Object.keys(d)) if (!keys.includes(k)) return `unknown ${String(d.format)} setting ${k}`;
  return formatProblem(d as unknown as DraftFormatSettings);
}

/**
 * Why a `stageSet` does not apply to `state`, or null (DESIGN "Specification: card data, packs and draft formats",
 * Evening stages): the edge exists, only the host leaves the lobby, draft → build only once the draft is done, build →
 * match only when every seated player is Ready, leaving a match needs a passed confirmation round (`action.round`),
 * the seat count suits the format. Implementer: M2-P7 (returns null until then, so M0/M1 behaviour is unchanged).
 */
export function stageProblem(_state: TableState, _action: StageSetAction): string | null {
  return null;
}

/**
 * The table after entering `to` at `seq` (DESIGN "Specification: card data, packs and draft formats", Evening stages;
 * PLAN M2-P7): entering the draft creates `TableState.draft` (core/drafting.ts createDraftState); entering build from a
 * match clears the game table (cards, stack, lines, commitments, Ready flags, life) for sideboarding; a new draft drops
 * the draft state; entering a match counts `games`. Implementer: M2-P7 (until then only the stage changes).
 */
export function enterStage(state: TableState, to: Stage, _seq: number): TableState {
  return state.stage === to ? state : { ...state, stage: to };
}
