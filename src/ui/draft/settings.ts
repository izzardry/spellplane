/**
 * The lobby settings panel's model (DESIGN "Pre-game: draft, sealed and deck building", Lobby settings: acquisition
 * mode, set per pack, packs per player, picks per pass, optional pick timer, pass timer length; "Specification: card
 * data, packs and draft formats": featured sets first). Pure: the panel (LobbySettings.svelte) renders it and writes
 * whole `LobbySettings` through `EveningControls.setLobby`.
 */
import { hostSeat, LOBBY_LIMITS, lobbyOf } from '../../core/stage';
import { setForPack, seatedInOrder } from '../../core/drafting';
import type { DraftFormatSettings, LobbySettings, SeatId, SetCode, TableState } from '../../core/types';
import { FEATURED_SETS, type SetSummary } from '../../data/types';
import { DRAFT_PRESETS, type DraftPresetId } from '../../draft/types';

/** A choice in the panel's mode menu: a draft preset, or constructed decks (no draft or build stage). */
export type LobbyMode = DraftPresetId | 'constructed';

/** Modes offered for a table format; the Two-Headed Giant modes only at a Two-Headed Giant table (DESIGN "Pre-game", mode table). */
export function lobbyModes(format: TableState['format']): LobbyMode[] {
  const base: LobbyMode[] = ['booster', 'pickTwo', 'sealed', 'rochester', 'winston', 'grid'];
  return format === '2hg' ? [...base, 'teamDraft', 'teamSealed', 'constructed'] : [...base, 'constructed'];
}

export function modeLabel(mode: LobbyMode): string {
  return mode === 'constructed' ? 'Constructed decks (no draft)' : DRAFT_PRESETS[mode].label;
}

/**
 * The mode a draft setting shows as. A pass draft of 3 packs with 2 picks per pass is the Pick-Two preset (DESIGN
 * "Pre-game": "Pick-Two preset … 3 packs, pick 2"); any other pass draft is a booster draft.
 */
export function modeOf(draft: DraftFormatSettings | null): LobbyMode {
  if (draft === null) return 'constructed';
  switch (draft.format) {
    case 'pass':
      return draft.packs === 3 && draft.picks === 2 ? 'pickTwo' : 'booster';
    case 'sealed':
      return 'sealed';
    case 'rochester':
      return 'rochester';
    case 'winston':
      return 'winston';
    case 'grid':
      return 'grid';
    case 'teamDraft':
      return 'teamDraft';
    case 'teamSealed':
      return 'teamSealed';
  }
}

/** Switch mode: the mode's defaults (DESIGN "Specification: card data, packs and draft formats", Setup column); sets and pick timer stay. */
export function withMode(lobby: LobbySettings, mode: LobbyMode): LobbySettings {
  const draft = mode === 'constructed' ? null : { ...DRAFT_PRESETS[mode].settings };
  return trimSets({ ...lobby, draft });
}

/** The number fields a format has (packs per player, picks per pass, burn, grids). */
export type NumberField = 'packs' | 'picks' | 'burn' | 'grids';

export function fieldsOf(draft: DraftFormatSettings | null): NumberField[] {
  if (draft === null) return [];
  switch (draft.format) {
    case 'pass':
    case 'teamDraft':
      return ['packs', 'picks'];
    case 'rochester':
      return ['packs', 'burn'];
    case 'grid':
      return ['grids'];
    default:
      return ['packs'];
  }
}

/** Bounds of a number field (core/stage.ts LOBBY_LIMITS, what `lobbySet` accepts). */
export function fieldRange(field: NumberField): { min: number; max: number } {
  const L = LOBBY_LIMITS;
  switch (field) {
    case 'packs':
      return { min: 1, max: L.packs };
    case 'picks':
      return { min: 1, max: L.picks };
    case 'burn':
      return { min: 0, max: L.burn };
    case 'grids':
      return { min: 1, max: L.grids };
  }
}

export function fieldLabel(field: NumberField, draft: DraftFormatSettings | null): string {
  switch (field) {
    case 'packs':
      return draft?.format === 'winston' ? 'Packs in the stack' : draft?.format === 'teamDraft' || draft?.format === 'teamSealed' ? 'Packs per team' : 'Packs per player';
    case 'picks':
      return 'Picks per pass';
    case 'burn':
      return 'Cards burnt per pack';
    case 'grids':
      return 'Grids';
  }
}

export function fieldValue(draft: DraftFormatSettings | null, field: NumberField): number | null {
  if (draft === null) return null;
  const v = (draft as unknown as Record<string, unknown>)[field];
  return typeof v === 'number' ? v : null;
}

/** Set a number field, clamped to its range and rounded; a field the format lacks leaves the settings unchanged. */
export function withNumber(lobby: LobbySettings, field: NumberField, value: number): LobbySettings {
  const draft = lobby.draft;
  if (draft === null || !fieldsOf(draft).includes(field) || !Number.isFinite(value)) return lobby;
  const { min, max } = fieldRange(field);
  const v = Math.min(max, Math.max(min, Math.round(value)));
  return trimSets({ ...lobby, draft: { ...draft, [field]: v } as DraftFormatSettings });
}

/** Pack numbers that can have their own set: the packs per player (or per team, or in the Winston stack); null for Grid (packs are shuffled together). */
export function packCount(draft: DraftFormatSettings | null): number | null {
  if (draft === null || draft.format === 'grid') return null;
  return draft.packs;
}

/** A set list without trailing repeats: a shorter list repeats its last entry (core/drafting.ts setForPack). */
export function canonicalSets(sets: readonly SetCode[]): SetCode[] {
  const out = [...sets];
  while (out.length > 1 && out[out.length - 1] === out[out.length - 2]) out.pop();
  return out;
}

/** Drop per-pack sets beyond the pack count, keep the list canonical. */
function trimSets(lobby: LobbySettings): LobbySettings {
  const n = packCount(lobby.draft) ?? 1;
  const sets = canonicalSets(lobby.sets.slice(0, Math.max(1, Math.min(n, LOBBY_LIMITS.sets))));
  return sets.length === lobby.sets.length && sets.every((s, i) => s === lobby.sets[i]) ? lobby : { ...lobby, sets };
}

/** The set of every pack number, expanded (pack 1, pack 2, …). */
export function setsPerPack(lobby: LobbySettings): SetCode[] {
  const n = Math.min(packCount(lobby.draft) ?? 1, LOBBY_LIMITS.sets);
  return Array.from({ length: n }, (_, i) => setForPack(lobby.sets, i));
}

/** Whether the packs use more than one set (the panel then shows one picker per pack). */
export function mixedSets(lobby: LobbySettings): boolean {
  return canonicalSets(lobby.sets).length > 1;
}

/** One set for every pack. */
export function withSet(lobby: LobbySettings, code: SetCode): LobbySettings {
  return { ...lobby, sets: [code] };
}

/** The set of pack number `index` (0-based); the other packs keep theirs (DESIGN: "a different set per pack is allowed"). */
export function withPackSet(lobby: LobbySettings, index: number, code: SetCode): LobbySettings {
  const sets = setsPerPack(lobby);
  if (index < 0 || index >= sets.length) return lobby;
  sets[index] = code;
  return { ...lobby, sets: canonicalSets(sets) };
}

/**
 * The set picker's entries (DESIGN "Specification: card data, packs and draft formats": the lobby lists M10 … M21
 * first; every other set with booster data follows by release date): the featured sets in FEATURED_SETS order, then
 * the others in the source's order (data/mtgjson.ts sorts them by release date). A chosen code the list lacks (still
 * loading, offline) is kept as an entry of its own, so the picker never silently changes the setting.
 */
export function setOptions(list: readonly SetSummary[], chosen: readonly SetCode[]): { featured: SetSummary[]; others: SetSummary[] } {
  const byCode = new Map(list.map((s) => [s.code.toUpperCase(), s]));
  const featured = FEATURED_SETS.map((c) => byCode.get(c)).filter((s): s is SetSummary => !!s);
  const featuredCodes = new Set<string>(FEATURED_SETS);
  const others = list.filter((s) => !featuredCodes.has(s.code.toUpperCase()));
  for (const c of chosen) {
    if (!byCode.has(c.toUpperCase()) && !others.some((s) => s.code === c)) others.push({ code: c, name: c, releaseDate: '', featured: featuredCodes.has(c) });
  }
  return { featured, others };
}

/** Pass timer choices, ms (core/reducer/table.ts `settings`: 2000..30000 or null for off; default 5000). */
export const PASS_TIMER_CHOICES: readonly (number | null)[] = [null, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000];

export function passTimerLabel(ms: number | null): string {
  return ms === null ? 'Off' : `${ms / 1000} s`;
}

/** The choices to offer: PASS_TIMER_CHOICES plus the current value when the table holds one the list lacks (kept in order). */
export function passTimerChoices(current: number | null): (number | null)[] {
  if (PASS_TIMER_CHOICES.includes(current)) return [...PASS_TIMER_CHOICES];
  const numbers = [...PASS_TIMER_CHOICES.filter((m): m is number => m !== null), current as number].sort((x, y) => x - y);
  return [null, ...numbers];
}

/** Whether `seat` may change the lobby settings now: the host (core/stage.ts hostSeat, the reducer's rule) in the lobby. */
export function lobbyEditable(state: TableState, seat: SeatId): boolean {
  return state.stage === 'lobby' && hostSeat(state) === seat;
}

/** The lobby settings the table holds, defaults filled in. */
export function currentLobby(state: TableState): LobbySettings {
  return lobbyOf(state);
}

/** A plain hint when the seated players do not suit the mode (not enforced here; DESIGN mode table, Players column). */
export function seatHint(mode: LobbyMode, state: TableState): string | null {
  if (mode === 'constructed') return null;
  const { min, max } = DRAFT_PRESETS[mode].seats;
  const n = seatedInOrder(state).length;
  if (n >= min && n <= max) return null;
  const want = min === max ? `${min}` : `${min} to ${max}`;
  return `${modeLabel(mode)} is for ${want} players; ${n} ${n === 1 ? 'is' : 'are'} seated.`;
}

/**
 * Whether the mode takes picks against a pick timer: the pass drafts, whose held packs the sequencer times
 * (core/drafting.ts draftDeadlines). Rochester, Winston and Grid are turn-based and have no timer, so the lobby does not
 * offer one there (M2-P7; DECISIONS [M2-P3]).
 */
export function hasPickTimer(draft: DraftFormatSettings | null): boolean {
  return draft !== null && (draft.format === 'pass' || draft.format === 'teamDraft');
}
