/**
 * Deck import flow for the HUD dialog (DESIGN "Pre-game: draft, sealed and deck building", Constructed decks: paste a
 * decklist, cards resolve through Scryfall; "Specification: card data, packs and draft formats": errors never block
 * the rest, unresolved lines carry near matches). Parsing is data/'s job (M0-P2); the HUD receives the parser as a
 * prop and falls back to `parsePlainList` for plain "4 Name" lists until it is wired.
 */
import type { CardDataSource, DeckEntry, DeckList, ParseError, ParseResult, ResolvedDeck } from '../data/types';

/** A decklist parser (data/ provides the full one: plain, MTGA and MTGO). */
export type ParseDecklist = (text: string) => ParseResult;

const SECTION: Record<string, DeckEntry['section']> = { deck: 'main', main: 'main', maindeck: 'main', sideboard: 'side', side: 'side', commander: 'commander', companion: 'companion' };

/** Minimal plain-format parser: "4 Name", "4x Name", optional "(SET) 123", section headers, "SB:" prefix. */
export function parsePlainList(text: string): ParseResult {
  const list: DeckList = { main: [], side: [], commander: [], companion: [] };
  const errors: ParseError[] = [];
  let section: DeckEntry['section'] = 'main';
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    let s = raw.trim();
    if (!s || s.startsWith('//') || s.startsWith('#')) return;
    const header = SECTION[s.replace(/:$/, '').toLowerCase()];
    if (header) {
      section = header;
      return;
    }
    let sec = section;
    if (/^SB:\s*/i.test(s)) {
      sec = 'side';
      s = s.replace(/^SB:\s*/i, '');
    }
    const m = /^(\d+)x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?)?$/.exec(s);
    if (!m || Number(m[1]) < 1) {
      errors.push({ line, text: raw, kind: 'syntax', message: `Line ${line}: expected "<count> <card name>"`, nearMatches: [] });
      return;
    }
    const entry: DeckEntry = { count: Number(m[1]), name: m[2]!.trim(), section: sec, line };
    if (m[3]) entry.set = m[3].toLowerCase();
    if (m[4]) entry.collectorNumber = m[4];
    list[sec === 'main' ? 'main' : sec].push(entry);
  });
  return { list, errors };
}

/** The checked deck: resolved cards and every problem line, sorted by line (DESIGN "Specification: card data, packs and draft formats"). */
export interface CheckedDeck {
  resolved: ResolvedDeck;
  errors: ParseError[];
}

/** Parse and resolve a pasted list. */
export async function checkDeck(text: string, parse: ParseDecklist, data: CardDataSource): Promise<CheckedDeck> {
  const parsed = parse(text);
  const resolved = await data.resolveDeck(parsed.list);
  const errors = [...parsed.errors, ...resolved.errors].sort((a, b) => a.line - b.line);
  return { resolved, errors };
}

/** Replace the card name on 1-based `line` of `text` with `name`, keeping count and suffixes (near-match buttons). */
export function replaceName(text: string, line: number, oldName: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const cur = lines[line - 1];
  if (cur === undefined) return text;
  const i = cur.toLowerCase().indexOf(oldName.toLowerCase());
  lines[line - 1] = i >= 0 ? cur.slice(0, i) + name + cur.slice(i + oldName.length) : cur.replace(/^(\s*(?:SB:\s*)?\d+x?\s+).*$/i, `$1${name}`);
  return lines.join('\n');
}

/** The name an unresolved error refers to: the text after the count. */
export function errorName(err: ParseError): string {
  return err.text.replace(/^\s*(?:SB:\s*)?\d+x?\s+/i, '').replace(/\s+\([A-Za-z0-9]{2,6}\)(?:\s+\S+)?\s*$/, '').trim();
}
