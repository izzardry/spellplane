/**
 * Decklist parser (DESIGN "Specification: card data, packs and draft formats", Decklist grammar; "Pre-game",
 * Constructed decks): plain, MTGA and MTGO lists.
 *
 *   line     = <count>[x] <name> [(<SET>) <collector number>]
 *   SB: line = a sideboard card
 *   headers  = Deck | Sideboard | Commander | Companion   (switch section)
 *   blank    = after the main deck, starts the sideboard; after a commander or companion block, ends it (back to
 *              the main deck, or to the sideboard if the main deck already has cards)
 *   comments = lines starting with // or #
 *
 * Bad lines are reported with their 1-based line number and never stop the rest of the list from parsing.
 */
import type { DeckEntry, DeckList, DeckSection, ParseError, ParseResult } from './types';

/** Largest count accepted on one line; more is almost certainly a typo. */
export const MAX_LINE_COUNT = 999;

const HEADERS: Record<string, DeckSection | 'about'> = {
  deck: 'main',
  sideboard: 'side',
  commander: 'commander',
  companion: 'companion',
  // MTGA exports may start with an "About" block ("Name <deck name>"), which is skipped.
  about: 'about',
};

// The set code may also come without a collector number ("4 Shock (M19)"), which pins the set only.
const CARD_LINE = /^(\d+)\s*[xX]?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†-]+))?)?$/u;

export function emptyDeckList(): DeckList {
  return { main: [], side: [], commander: [], companion: [] };
}

function header(text: string): DeckSection | 'about' | null {
  // "Sideboard", "Sideboard:" and "Sideboard (15)" all switch section.
  const m = /^([A-Za-z]+)\s*(?:\(\d+\))?\s*:?$/.exec(text);
  return m ? (HEADERS[m[1]!.toLowerCase()] ?? null) : null;
}

function syntaxError(line: number, text: string, message: string): ParseError {
  return { line, text, kind: 'syntax', message, nearMatches: [] };
}

/** Parses one card line (without an `SB:` prefix); a string is the syntax error message. */
export function parseCardLine(text: string): Omit<DeckEntry, 'section' | 'line'> | string {
  const m = CARD_LINE.exec(text);
  if (!m) {
    return /^\d/.test(text) ? 'Expected "<count> <card name>" with a card name after the count' : 'Expected "<count> <card name>", e.g. "4 Lightning Bolt"';
  }
  const count = Number(m[1]);
  if (count > MAX_LINE_COUNT || !Number.isSafeInteger(count)) return `The count must be at most ${MAX_LINE_COUNT}`;
  if (count < 1) return 'The count must be at least 1';
  const name = m[2]!.replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Missing card name';
  const entry: Omit<DeckEntry, 'section' | 'line'> = { count, name };
  if (m[3] !== undefined) entry.set = m[3].toLowerCase();
  if (m[3] !== undefined && m[4] !== undefined) entry.collectorNumber = m[4];
  return entry;
}

/** Parses a decklist. Errors are of kind 'syntax'; name resolution happens later (CardDataSource.resolveDeck). */
export function parseDecklist(text: string): ParseResult {
  const list = emptyDeckList();
  const errors: ParseError[] = [];
  let section: DeckSection | 'about' = 'main';
  /** Whether a card line was read since the last header (a blank line ends a commander or companion block). */
  let sectionHasCards = false;
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (t === '') {
      // A blank line after the main deck starts the sideboard; it ends an "About" block too.
      if (section === 'about') section = 'main';
      else if (section === 'main' && list.main.length > 0) section = 'side';
      else if ((section === 'commander' || section === 'companion') && sectionHasCards) {
        section = list.main.length > 0 ? 'side' : 'main';
        sectionHasCards = false;
      }
      return;
    }
    if (t.startsWith('//') || t.startsWith('#')) return;
    const h = header(t);
    if (h) {
      section = h;
      sectionHasCards = false;
      return;
    }
    if (section === 'about') return;
    let target: DeckSection = section;
    let body = t;
    const sb = /^SB:\s*/i.exec(t);
    if (sb) {
      target = 'side';
      body = t.slice(sb[0].length);
    }
    const parsed = parseCardLine(body);
    if (typeof parsed === 'string') {
      errors.push(syntaxError(line, raw, parsed));
      return;
    }
    list[target].push({ ...parsed, section: target, line, text: raw });
    sectionHasCards = true;
  });
  return { list, errors };
}

/** Total cards in a section. */
export function sectionCount(entries: DeckEntry[]): number {
  return entries.reduce((n, e) => n + e.count, 0);
}

/** Every entry of a list, in section order main, side, commander, companion. */
export function allEntries(list: DeckList): DeckEntry[] {
  return [...list.main, ...list.side, ...list.commander, ...list.companion];
}

/** Normalised form for name comparison: case, accents, punctuation and spacing ignored. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}'/ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance (two rows). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/**
 * Up to `limit` candidate names closest to `name`: by edit distance on normalised names (a front face of
 * "A // B" also counts), keeping only those within about a third of the name's length; ties by name.
 */
export function nearMatches(name: string, candidates: Iterable<string>, limit = 3): string[] {
  const n = normaliseName(name);
  if (!n) return [];
  const maxDist = Math.max(2, Math.floor(n.length / 3));
  const scored = new Map<string, number>();
  for (const c of candidates) {
    if (scored.has(c)) continue;
    const forms = [normaliseName(c), ...c.split(' // ').map(normaliseName)];
    let best = Number.POSITIVE_INFINITY;
    for (const f of forms) best = Math.min(best, editDistance(n, f));
    if (best <= maxDist) scored.set(c, best);
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([c]) => c);
}
