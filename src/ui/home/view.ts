/**
 * Home's state as one pure function (journey.md 4.1, "The primary button's states"; 4.5 searching; contracts.md Part G
 * "Matchmaking" items 4 and 5, "Journey and Home"). Every row of the primary-button table is a branch here, so the
 * unit tests cover the table without a DOM. M8-P2.
 */
import type { Format, LobbySettings, QueueId } from '../../core/types';
import type { BoosterSetup, DeckRecord, HomeMode, HomePrefs } from '../../store/types';
import type { MatchmakerStatus } from '../../session/types';

/** The primary's label per mode (journey.md 4.1, the option row table). It never reads RESUME or CONTINUE. */
export const PRIMARY_LABEL: Readonly<Record<HomeMode, string>> = { solo: 'PLAY', quick: 'FIND MATCH', private: 'CREATE TABLE', draft: 'OPEN DRAFT TABLE' };

/** The modes in order (journey.md J8). */
export const MODES: readonly { value: HomeMode; name: string }[] = [
  { value: 'solo', name: 'SOLO' },
  { value: 'quick', name: 'QUICK MATCH' },
  { value: 'private', name: 'PRIVATE GAME' },
  { value: 'draft', name: 'DRAFT NIGHT' },
];

/** The mode cards' icons (the kit's icon set). */
export const MODE_ICONS = { solo: 'play', quick: 'join', private: 'link', draft: 'deck' } as const satisfies Record<HomeMode, string>;

/** The copy Home shows (journey.md 4.1; contracts.md Part G "Matchmaking" items 4 and 5). */
export const COPY = {
  noDeckSolo: 'No deck yet: you get a starter deck.',
  noDeck: 'Pick or build a deck first.',
  empty: 'This deck is empty.',
  rankedSize: 'Ranked needs at least 40 cards (booster deck) or 60 (custom deck).',
  rankedOnly1v1: 'Ranked is 1v1 for now.',
  offline: 'You are offline. Solo works with decks you have opened before.',
  storage: 'This browser blocks storage. You can play solo; nothing will be saved.',
  firstSearch: 'Connects your browser directly to other players who are looking. They see your name and network address.',
  ranked: 'Ranked counts only when the loser concedes.',
  noMatchmaking: 'Matchmaking is not in this build yet.',
  connecting: 'CONNECTING TO THE LOBBY…',
  alone: 'You are the only one looking right now.',
  otherTab: 'SEARCHING IN ANOTHER TAB',
  draftDeck: 'Your deck is drafted at the table.',
} as const;

/** What Home knows about matchmaking: whether this build has it, its status, and whether this profile ever searched. */
export interface HomeMatchmaking {
  available: boolean;
  status: MatchmakerStatus;
  /** True once this profile started a search (the first-search line is shown before that). */
  searched?: boolean;
}

/** Features of this build beyond matchmaking. */
export interface HomeFeatures {
  /** A computer opponent exists (else SOLO offers ALONE only). */
  computer: boolean;
}

/** One deck as Home shows it. */
export interface HeroDeck {
  id: string;
  name: string;
  kind: 'custom' | 'sealed';
  cards: number;
  record: DeckRecord;
}

/** Everything Home renders, decided in one place. */
export interface HomeView {
  mode: HomeMode;
  hero: 'deck' | 'empty' | 'boosters';
  deck: HeroDeck | null;
  /** 0-based position of the selected deck in the library order (by last use), and the library size. */
  deckIndex: number;
  deckCount: number;
  /** The arrows and CHANGE DECK are disabled (a search runs with this deck; contracts.md Part E). */
  deckLocked: boolean;
  /** Mode cards and the option row are locked (a search runs). */
  optionsLocked: boolean;
  primary: {
    label: string;
    disabled: boolean;
    /** Pressed in with a timer (searching, connecting). */
    waiting: boolean;
    /** What a press does; `cancel`: a tap on the waiting pill cancels the search (journey.md 4.1 primary states), as its ✕ does. */
    action: 'play' | 'firstRun' | 'find' | 'create' | 'draft' | 'cancel' | 'none';
  };
  /** The round cancel beside a waiting primary. */
  cancel: boolean;
  /** The status line under the primary (one line), or null. */
  line: string | null;
  /** The line's tone. */
  tone: 'muted' | 'danger';
  /** Links offered under the line (no deck in a mode that needs one). */
  links: ('starter' | 'boosters')[];
  /** The effective ranked flag (ranked is 1v1 only). */
  ranked: boolean;
  /** The solo opponent actually used (ALONE when this build has no computer). */
  opponent: 'sparring' | 'alone';
  /** When seeking: the search's start (ms epoch) for the timer. */
  since: number | null;
  /** USE HERE (a search runs in another tab). */
  useHere: boolean;
}

/** A deck's kind (older records: a seal means sealed). */
export function deckKind(d: DeckRecord): 'custom' | 'sealed' {
  return d.kind ?? (d.seal ? 'sealed' : 'custom');
}

/** A deck's main card count (the summary when present). */
export function deckCards(d: DeckRecord): number {
  return d.summary?.cards ?? d.main.length;
}

/** The library in the hero's order: by last use, newest first (journey.md 4.1, Arrows). */
export function libraryOrder(decks: readonly DeckRecord[]): DeckRecord[] {
  const used = (d: DeckRecord): number => d.lastPlayedAt ?? d.updatedAt;
  return [...decks].sort((a, b) => used(b) - used(a) || (a.id < b.id ? -1 : 1));
}

/** The selected deck: the remembered one, else the most recently used (journey.md 4.1 "Deck missing"), else none. */
export function selectedDeck(prefs: HomePrefs, decks: readonly DeckRecord[]): DeckRecord | null {
  const ordered = libraryOrder(decks);
  return ordered.find((d) => d.id === prefs.deckId) ?? ordered[0] ?? null;
}

/** The deck `step` places from `id` in the library order, clamped at the ends (the stepper does not wrap). */
export function stepDeck(decks: readonly DeckRecord[], id: string | null, step: -1 | 1): DeckRecord | null {
  const ordered = libraryOrder(decks);
  if (ordered.length === 0) return null;
  const i = Math.max(0, ordered.findIndex((d) => d.id === id));
  return ordered[Math.min(ordered.length - 1, Math.max(0, i + step))] ?? null;
}

const SEARCH_PHASES = new Set<MatchmakerStatus['phase']>(['connecting', 'seeking', 'check', 'moving']);

/** Home's view (journey.md 4.1 and 4.5). */
export function homeView(prefs: HomePrefs, decks: readonly DeckRecord[], online: boolean, storageOk: boolean, matchmaking: HomeMatchmaking, features: HomeFeatures = { computer: true }): HomeView {
  const status = matchmaking.status;
  const searching = SEARCH_PHASES.has(status.phase);
  const ordered = libraryOrder(decks);
  // While a search runs the deck is the one the ticket was made for.
  const searchDeck = status.phase === 'seeking' ? ordered.find((d) => d.id === status.deckId) : undefined;
  const record = searchDeck ?? selectedDeck(prefs, decks);
  const deck: HeroDeck | null = record ? { id: record.id, name: record.name, kind: deckKind(record), cards: deckCards(record), record } : null;
  const mode: HomeMode = searching ? 'quick' : prefs.mode;
  const ranked = prefs.quick.ranked && prefs.quick.format === '1v1';
  const opponent = features.computer ? prefs.solo.opponent : 'alone';
  const view: HomeView = {
    mode,
    hero: mode === 'draft' ? 'boosters' : deck ? 'deck' : 'empty',
    deck,
    deckIndex: record ? ordered.findIndex((d) => d.id === record.id) : -1,
    deckCount: ordered.length,
    deckLocked: searching,
    optionsLocked: searching,
    primary: { label: PRIMARY_LABEL[mode], disabled: false, waiting: false, action: actionOf(mode) },
    cancel: false,
    line: null,
    tone: 'muted',
    links: [],
    ranked,
    opponent,
    since: null,
    useHere: false,
  };
  const disable = (line: string, tone: 'muted' | 'danger' = 'muted'): HomeView => ({ ...view, primary: { ...view.primary, disabled: true, action: 'none' }, line, tone });

  // Searching (journey.md 4.5).
  if (status.phase === 'connecting') return { ...view, primary: { label: 'CONNECTING…', disabled: false, waiting: true, action: 'cancel' }, cancel: true, line: COPY.connecting };
  if (status.phase === 'seeking') {
    const inQueue = status.queues.reduce((n, q) => n + (status.lobby.byQueue[q] ?? 0), 0);
    const looking = status.lobby.seekers.length + 1;
    const line = status.alone ? COPY.alone : `${looking} LOOKING NOW · ${inQueue} IN YOUR QUEUE`;
    return { ...view, primary: { label: 'SEARCHING', disabled: false, waiting: true, action: 'cancel' }, cancel: true, line, since: status.since };
  }
  if (status.phase === 'check' || status.phase === 'moving') return { ...view, primary: { label: 'MATCH FOUND', disabled: false, waiting: true, action: 'none' }, cancel: false, line: null };
  if (status.phase === 'failed' && status.problem === 'otherTab') return { ...view, primary: { label: COPY.otherTab, disabled: true, waiting: false, action: 'none' }, line: status.text, useHere: true };

  // Storage blocked: solo only.
  if (!storageOk) {
    if (mode === 'solo') return { ...view, primary: { ...view.primary, action: deck ? 'play' : 'firstRun' }, line: COPY.storage, tone: 'danger' };
    return disable(COPY.storage, 'danger');
  }
  // Offline: the modes that need the network.
  if (!online && mode !== 'solo') return { ...disable(COPY.offline), primary: { label: 'OFFLINE', disabled: true, waiting: false, action: 'none' } };
  if (mode === 'quick' && !matchmaking.available) return disable(COPY.noMatchmaking);
  if (status.phase === 'failed') view.line = status.text;

  // Draft night needs no deck: it is drafted at the table.
  if (mode === 'draft') return { ...view, line: view.line ?? COPY.draftDeck };

  if (!deck) {
    if (mode === 'solo') return { ...view, primary: { ...view.primary, action: 'firstRun' }, line: COPY.noDeckSolo };
    return { ...disable(COPY.noDeck), links: ['starter', 'boosters'] };
  }
  if (deck.cards === 0) return disable(COPY.empty);
  if (mode === 'quick' && ranked && deck.cards < (deck.kind === 'sealed' ? 40 : 60)) return disable(COPY.rankedSize);

  if (mode === 'quick') {
    if (prefs.quick.ranked && prefs.quick.format !== '1v1') return { ...view, line: COPY.rankedOnly1v1 };
    if (ranked) return { ...view, line: COPY.ranked };
    if (!matchmaking.searched) return { ...view, line: view.line ?? COPY.firstSearch };
  }
  if (deck.cards < 40) return { ...view, line: view.line ?? `${deck.cards} cards. Most decks have 40 or more.` };
  return view;
}

function actionOf(mode: HomeMode): HomeView['primary']['action'] {
  return mode === 'solo' ? 'play' : mode === 'quick' ? 'find' : mode === 'private' ? 'create' : 'draft';
}

/** The queued setup as text while a search runs (journey.md 4.5: "show the queued setup as text"), e.g. `QUICK MATCH · 1V1 · UNRANKED`. */
export function queuedSetup(queues: readonly QueueId[]): string {
  const q = queues[0];
  if (!q) return 'QUICK MATCH';
  const [format, , mode] = q.split('.') as [Format, string, string];
  const label = FORMATS.find((f) => f.value === format)?.label ?? format.toUpperCase();
  return `QUICK MATCH · ${label} · ${queues.some((x) => x.endsWith('.ranked')) ? 'RANKED' : mode === 'casual' ? 'UNRANKED' : mode.toUpperCase()}`;
}

/** The queues a quick-match search joins (journey.md section 7: format, ranked and the deck's kind; ranked adds casual with `also casual`). */
export function queuesFor(quick: HomePrefs['quick'], kind: 'custom' | 'sealed', alsoCasual: boolean): QueueId[] {
  const k = kind === 'sealed' ? 'limited' : 'constructed';
  if (quick.ranked && quick.format === '1v1') return alsoCasual ? [`1v1.${k}.ranked`, `1v1.${k}.casual`] : [`1v1.${k}.ranked`];
  return [`${quick.format}.${k}.casual`];
}

/** The players choice of Draft night (journey.md 4.1: `2 │ 3 │ 4 │ 2V2`) as a table format. */
export const DRAFT_PLAYERS: readonly { value: Format; label: string }[] = [
  { value: '1v1', label: '2' },
  { value: 'ffa3', label: '3' },
  { value: 'ffa4', label: '4' },
  { value: '2hg', label: '2V2' },
];

/** The formats of Quick match and Private game (journey.md J9). */
export const FORMATS: readonly { value: Format; label: string }[] = [
  { value: '1v1', label: '1V1' },
  { value: '2hg', label: '2V2' },
  { value: 'ffa3', label: '3 FFA' },
  { value: 'ffa4', label: '4 FFA' },
];

/** The booster setup as the lobby settings of a table (journey.md section 7: "maps onto core's LobbySettings"). */
export function boosterToLobby(b: BoosterSetup): LobbySettings {
  const packs = Math.max(1, b.packs);
  const draft: LobbySettings['draft'] =
    b.how === 'pass'
      ? { format: 'pass', packs, picks: Math.max(1, b.picks) }
      : b.how === 'sealed'
        ? { format: 'sealed', packs }
        : b.how === 'rochester'
          ? { format: 'rochester', packs, burn: 0 }
          : b.how === 'winston'
            ? { format: 'winston', packs }
            : { format: 'grid', grids: packs };
  return { draft, sets: b.sets.length > 0 ? [...b.sets] : ['M19'], pickTimer: b.pickTimer };
}

/** The lobby settings of a table as a booster setup (the inverse of boosterToLobby; constructed lobbies give the default pass draft). */
export function lobbyToBooster(l: LobbySettings): BoosterSetup {
  const d = l.draft;
  const base = { sets: [...l.sets], pickTimer: l.pickTimer, picks: 1 };
  if (!d) return { how: 'pass', packs: 3, ...base };
  switch (d.format) {
    case 'pass':
    case 'teamDraft':
      return { ...base, how: 'pass', packs: d.packs, picks: d.picks };
    case 'sealed':
    case 'teamSealed':
      return { ...base, how: 'sealed', packs: d.packs };
    case 'rochester':
      return { ...base, how: 'rochester', packs: d.packs };
    case 'winston':
      return { ...base, how: 'winston', packs: d.packs };
    case 'grid':
      return { ...base, how: 'grid', packs: d.grids };
  }
}

/** The packs shown in Draft night's hero: one per round, at most three drawn (journey.md 4.1). */
export function heroPacks(b: BoosterSetup): string[] {
  const n = Math.max(1, Math.min(3, b.how === 'pass' || b.how === 'rochester' ? b.packs : 3));
  const sets = b.sets.length > 0 ? b.sets : ['M19'];
  return Array.from({ length: n }, (_, i) => sets[Math.min(i, sets.length - 1)]!);
}
