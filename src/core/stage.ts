/**
 * The evening's stage machine (DESIGN "Specification: card data, packs and draft formats", Evening stages: `lobby →
 * draft → build → match → build → match …`; the host advances from lobby, draft advances automatically, build advances
 * when all seated players are Ready, from match any player proposes "next game" or "new draft" and the others
 * confirm; "Pre-game: draft, sealed and deck building": one link for the whole evening). Pure. Contracts: M2-C
 * (edges, events, the transition function, host and lobby validation); M2-P7 implements the stubs and wires
 * `stageProblem` and `enterStage` into the `stageSet` reducer (core/reducer/table.ts).
 */
import type { StageSetAction } from './actions';
import { createDraftState, seatedInOrder } from './drafting';
import { roundPassed } from './reducer/confirm';
import type { DraftFormat, DraftFormatSettings, Format, LobbySettings, Seat, SeatId, Stage, TableState, Team, Zone } from './types';
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
 * The label of the confirmation round in which a player proposes to leave a match (DESIGN "Specification: card data,
 * packs and draft formats", Evening stages: "from match any player proposes 'next game' or 'new draft' and the others
 * confirm"). A `stageSet` that leaves a match names a passed round with the matching label, so a round about something
 * else (a stack item, "attacks?") never moves the evening (DECISIONS [M2-P7]).
 */
export const STAGE_ROUND_LABELS = { nextGame: 'Next game?', newDraft: 'New draft?' } as const;

/** The proposal a round label stands for, or null (STAGE_ROUND_LABELS). */
export function stageProposalOf(label: string | undefined): 'nextGame' | 'newDraft' | null {
  if (label === STAGE_ROUND_LABELS.nextGame) return 'nextGame';
  if (label === STAGE_ROUND_LABELS.newDraft) return 'newDraft';
  return null;
}

/**
 * Seat counts each acquisition mode is made for (DESIGN "Pre-game", mode table, Players column: booster draft "3–4
 * (works with 2)", Rochester and sealed 2–4, Winston and Grid 2, the Two-Headed Giant modes 4). Mirrors
 * draft/types.ts DRAFT_PRESETS, which core cannot import.
 */
export const FORMAT_SEATS: Readonly<Record<DraftFormat, { min: number; max: number }>> = {
  pass: { min: 2, max: 4 },
  sealed: { min: 2, max: 4 },
  rochester: { min: 2, max: 4 },
  winston: { min: 2, max: 2 },
  grid: { min: 2, max: 2 },
  teamDraft: { min: 4, max: 4 },
  teamSealed: { min: 4, max: 4 },
};

/** Formats whose client side exists (draft/index.ts DRAFT_DRIVERS); the Two-Headed Giant drafts are M3-P2's (draft/team.ts). */
const PLAYABLE_FORMATS: ReadonlySet<DraftFormat> = new Set<DraftFormat>(['pass', 'sealed', 'rochester', 'winston', 'grid', 'teamDraft', 'teamSealed']);

/**
 * How a new game starts (DESIGN "Players, seats and formats": 20 life each, 30 per team in Two-Headed Giant; "Turn
 * flow and confirmation": the turn strip starts at untap of turn 1) for the games core knows by id. The reducer has no
 * game definition, so these mirror games/mtg (a unit test keeps them in step); for another game a new game keeps life
 * and phase as they were (DECISIONS [M2-P7]).
 */
export const GAME_START: Readonly<Record<string, { life: Readonly<Record<Format, number>>; phase: string }>> = {
  mtg: { life: { '1v1': 20, ffa3: 20, ffa4: 20, '2hg': 30 }, phase: 'untap' },
};

/** Whether the seat holds a player (a chair with a name). */
function seated(state: TableState, seat: SeatId): boolean {
  const s = Object.hasOwn(state.seats, seat) ? state.seats[seat] : undefined;
  return s !== undefined && s.name.trim() !== '';
}

/**
 * The host as the stage machine reads it: the seated player with the lowest seat index who is not away, else
 * `hostSeat` (DESIGN "Specification: card data, packs and draft formats", Evening stages: "the host advances from
 * lobby"; "Multiplayer architecture": an away seat never stalls the table). The lobby's start button uses the same
 * rule (ui/lobby/seats.ts hostSeat with presence). DECISIONS [M2-P7].
 */
export function actingHost(state: TableState): SeatId | null {
  const seatedIds = seatedInOrder(state);
  return seatedIds.find((id) => state.seats[id]!.away !== true) ?? seatedIds[0] ?? null;
}

/** Seated players without a deck commitment (they have not pressed Ready in the builder, or in the lobby). */
export function notReady(state: TableState): SeatId[] {
  return seatedInOrder(state).filter((id) => !Object.hasOwn(state.commitments, id));
}

/** Why the seated players of `state` cannot draft `settings`, or null (DESIGN "Pre-game", mode table, Players column). */
export function formatSeatProblem(state: TableState, settings: DraftFormatSettings): string | null {
  const range = Object.hasOwn(FORMAT_SEATS, settings.format) ? FORMAT_SEATS[settings.format] : undefined;
  if (range === undefined) return 'unknown draft format';
  if (!PLAYABLE_FORMATS.has(settings.format)) return 'Two-Headed Giant drafts are not available yet';
  const n = seatedInOrder(state).length;
  if (n < range.min || n > range.max) {
    const want = range.min === range.max ? `${range.min}` : `${range.min} to ${range.max}`;
    return `this mode is for ${want} players, and ${n} ${n === 1 ? 'is' : 'are'} seated`;
  }
  if (settings.format === 'teamDraft' || settings.format === 'teamSealed') {
    const seatedIds = seatedInOrder(state);
    if (seatedIds.some((id) => state.seats[id]!.team === undefined) || new Set(seatedIds.map((id) => state.seats[id]!.team)).size < 2) return 'a Two-Headed Giant draft needs two teams';
  }
  return null;
}

/**
 * Why a `stageSet` does not apply to `state`, or null (DESIGN "Specification: card data, packs and draft formats",
 * Evening stages):
 * - the edge exists (STAGE_EDGES) and the sender holds a seat;
 * - only the host leaves the lobby (`actingHost`), to the draft when the lobby chose one and the seated count suits
 *   it, or straight to a match (the constructed path; the lobby's Ready check is the HUD's, as in M1, and the solo
 *   table goes straight to play); only the host abandons a draft for the lobby;
 * - draft → build once the draft is done ("draft advances automatically");
 * - build → match once every seated player is Ready ("build advances when all seated players are Ready");
 * - leaving a match (next game: build; new draft: lobby), and build → lobby, needs `round`: the current confirmation
 *   round, labelled for that proposal (STAGE_ROUND_LABELS), passed by everyone else ("any player proposes … and the
 *   others confirm").
 * Total on untrusted input.
 */
export function stageProblem(state: TableState, action: StageSetAction): string | null {
  const to = action.stage;
  if (!STAGES.includes(to)) return 'invalid stage';
  const from = state.stage;
  if (from === to) return `the table is already in the ${to} stage`;
  if (!canMove(from, to)) return `the evening does not go from ${from} to ${to}`;
  if (typeof action.by !== 'string' || !seated(state, action.by)) return 'only a seated player moves the evening on';
  const host = actingHost(state);
  if (from === 'lobby') {
    if (action.by !== host) return 'only the host starts';
    if (to === 'draft') {
      const lobby = lobbyOf(state);
      if (lobby.draft === null) return 'the lobby plays constructed decks; there is no draft to start';
      const bad = lobbyProblem(lobby);
      if (bad !== null) return bad;
      return formatSeatProblem(state, lobby.draft);
    }
    return null;
  }
  if (from === 'draft') {
    if (to === 'lobby') return action.by === host ? null : 'only the host abandons the draft';
    return state.draft?.done === true ? null : 'the draft is not finished';
  }
  if (from === 'build' && to === 'match') {
    const waiting = notReady(state);
    return waiting.length === 0 ? null : `waiting for ${waiting.map((id) => state.seats[id]!.name).join(', ')} to press Ready`;
  }
  // match → build (next game), match → lobby and build → lobby (new draft): the others confirmed in a round.
  const proposal = to === 'build' ? 'nextGame' : 'newDraft';
  const r = state.confirm;
  if (typeof action.round !== 'string') return `leaving the ${from} stage needs the others to confirm`;
  if (r === null || r.id !== action.round) return `round ${action.round} is not the current confirmation round`;
  if (stageProposalOf(r.label) !== proposal) return `round ${r.id} does not propose ${proposal === 'nextGame' ? 'the next game' : 'a new draft'}`;
  if (!roundPassed(state)) return 'not everyone has confirmed yet';
  return null;
}

/** Every zone emptied (hidden zones also lose their count). */
function emptyZones(zones: Readonly<Record<string, Zone>>): Record<string, Zone> {
  const out: Record<string, Zone> = {};
  for (const [id, z] of Object.entries(zones)) {
    out[id] = z.visibility === 'public' ? { ...z, ids: [] } : { ...z, ids: [], count: 0 };
  }
  return out;
}

/**
 * The table with its game cleared (DESIGN "Pre-game", Deck building: "between games, players return to the builder to
 * sideboard"): no cards, empty zones, no stack, lines, round, commitments, randomness rounds or shuffles of game zones
 * (the draft's pack rounds stay with the draft, unless `dropPacks`), Ready, auto-pass, counters and recoveries reset,
 * life and the turn strip back to the start of a game (GAME_START). Chairs, names, colours, away marks, settings,
 * lobby and draft stay.
 */
function clearGame(state: TableState, dropPacks: boolean): TableState {
  const start = Object.hasOwn(GAME_START, state.game) ? GAME_START[state.game] : undefined;
  const life = start?.life[state.format];
  const seats: Record<SeatId, Seat> = {};
  for (const [id, s] of Object.entries(state.seats)) {
    const { recovering: _recovering, ...rest } = s;
    seats[id] = { ...rest, ready: false, autoPass: false, counters: {}, life: life ?? s.life };
  }
  const teams: Record<string, Team> = {};
  for (const [id, t] of Object.entries(state.teams)) teams[id] = { ...t, counters: {}, life: life ?? t.life };
  const order = Object.values(state.seats).sort((a, b) => a.index - b.index);
  const first = order.find((s) => s.name.trim() !== '') ?? order[0];
  const shuffles = Object.fromEntries(Object.entries(state.shuffles).filter(([, r]) => r.purpose === 'pack' && !dropPacks));
  return {
    ...state,
    seats,
    teams,
    cards: {},
    zones: emptyZones(state.zones),
    stack: [],
    lines: {},
    confirm: null,
    commitments: {},
    rng: {},
    shuffles,
    turn: { number: 1, active: first ? (first.team ?? first.id) : state.turn.active, phase: start?.phase ?? state.turn.phase },
  };
}

/**
 * The table after entering `to` at `seq` (DESIGN "Specification: card data, packs and draft formats", Evening stages;
 * PLAN M2-P7):
 * - lobby → draft creates `TableState.draft` from the lobby settings (core/drafting.ts createDraftState) on a cleared
 *   table (a deck committed in the lobby does not survive into the draft);
 * - entering build from a match clears the game table for sideboarding; the draft stays, so pools stay countable;
 * - a new draft (any stage → lobby) clears the game table and drops the draft with its pack-seed rounds;
 * - entering a match counts `games`.
 * The caller has checked the move with `stageProblem`.
 */
export function enterStage(state: TableState, to: Stage, seq: number): TableState {
  if (state.stage === to) return state;
  let next: TableState = { ...state, stage: to };
  if (to === 'draft') {
    next = clearGame(next, true);
    const draft = createDraftState(next, lobbyOf(next), seq);
    if (draft === null) delete next.draft;
    else next.draft = draft;
  } else if (to === 'lobby') {
    next = clearGame(next, true);
    delete next.draft;
  } else if (to === 'build' && state.stage === 'match') {
    next = clearGame(next, false);
  } else if (to === 'match') {
    next.games = (state.games ?? 0) + 1;
  }
  return next;
}
