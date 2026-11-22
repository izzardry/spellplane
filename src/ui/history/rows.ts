/**
 * History rows as text (journey.md 4.14, persistence.md section 3): title, line 2, state line, time, code and the
 * route that reopens a game. Pure; never the code as a title and never another player's deck. M8-P2.
 */
import type { Format } from '../../core/types';
import { isEnded } from '../../store/games';
import type { GameSummary } from '../../store/types';

export type HistoryFilter = 'all' | 'unfinished' | 'finished';

const FORMAT: Readonly<Record<Format, string>> = { '1v1': '1v1', ffa3: '3 FFA', ffa4: '4 FFA', '2hg': '2v2' };
const DECKS: Readonly<Record<GameSummary['decks'], string>> = { constructed: 'Constructed', draftLive: 'Live draft', draftPrebuilt: 'Booster deck' };

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} AND ${list.at(-1)!}`;
}

/** The title: the other players by name (`VS BEN`), a computer game, or a practice table. */
export function rowTitle(g: GameSummary): string {
  if (g.title) return g.title.toUpperCase();
  if (g.kind === 'solo' && g.opponent === 'sparring') return '⬡ SPARRING';
  const others = g.players.filter((p) => !p.me);
  if (g.kind === 'solo' || others.length === 0) return g.stage === 'lobby' && g.kind !== 'solo' ? 'NEW TABLE' : 'PRACTICE';
  if (g.format === '2hg') {
    const me = g.players.find((p) => p.me);
    const mine = others.filter((p) => me && p.team === me.team).map((p) => p.name);
    const theirs = others.filter((p) => !me || p.team !== me.team).map((p) => p.name);
    return `YOU${mine.length ? ` + ${mine.join(' + ')}` : ''} VS ${theirs.join(' + ')}`.toUpperCase();
  }
  if (others.length === 1) return `VS ${others[0]!.name}`.toUpperCase();
  return names(others.map((p) => p.name)).toUpperCase();
}

/** Line 2: format, deck source, own deck name. */
export function rowLine(g: GameSummary): string {
  return [FORMAT[g.format], g.kind === 'solo' ? (g.opponent === 'sparring' ? 'Solo' : 'Practice') : DECKS[g.decks], g.deck?.name].filter(Boolean).join(' · ');
}

/** The state line (journey.md 4.14). */
export function rowState(g: GameSummary): string {
  if (isEnded(g)) {
    if (g.ended === 'replaced') return 'Ended';
    const lives = g.players.map((p) => `${p.me ? 'you' : p.name} ${p.life}`).join(', ');
    return lives ? `Ended · ${lives}` : 'Ended';
  }
  if (g.stage === 'lobby') return 'Not started';
  if (g.stage === 'draft') return 'Drafting';
  if (g.stage === 'build') return 'Building decks';
  const active = g.players.find((p) => p.seat === g.active) ?? g.players.find((p) => p.team !== undefined && p.team === g.active);
  const whose = !active ? null : active.me || (active.team !== undefined && g.players.some((p) => p.me && p.team === active.team)) ? 'your turn' : `${active.name}'s turn`;
  return whose ? `Turn ${g.turn} · ${whose}` : `Turn ${g.turn}`;
}

/**
 * The row's one `sm` action (visual.md 2.8 history row, O-5): what a click on the row does, in a word. An ended game is
 * looked at, a game alone or against the computer is continued, a table that has not started is opened, and a table
 * with other players is rejoined.
 */
export function rowAction(g: GameSummary): string {
  if (isEnded(g)) return 'View';
  if (g.kind === 'solo') return 'Continue';
  if (g.stage === 'lobby') return 'Open';
  return 'Rejoin';
}

/** A relative time (`now`, `12 min`, `2 h`, `3 d`). */
export function relTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** The game code as people say it (`AMBER FOX 93`). */
export function codeText(code: string): string {
  return code.replace(/-/g, ' ').toUpperCase();
}

/** Whether a row shows under a filter: ALL hides ended solo games (contracts.md Part G "History and saving" item 3). */
export function shows(g: GameSummary, f: HistoryFilter): boolean {
  if (f === 'unfinished') return !isEnded(g);
  if (f === 'finished') return isEnded(g);
  return !(g.kind === 'solo' && isEnded(g));
}
