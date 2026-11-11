/**
 * Pressing Ready in the lobby with a pasted list (DESIGN "Pre-game: draft, sealed and deck building", Constructed
 * decks; "Input and interaction design": nothing fails silently). Pure helpers for Lobby.svelte.
 */
import type { CheckedDeck } from '../deck';

/** What a press on Ready with a pasted list does. */
export type ReadyVerdict = { kind: 'go' } | { kind: 'refuse'; message: string } | { kind: 'confirm'; message: string };

/**
 * A list with no resolved card is refused with a message; a list with lines that did not resolve needs a second press
 * (`confirmedText` is the text the player already confirmed), so cards are never left out silently.
 */
export function readyVerdict(checked: CheckedDeck | null, text: string, confirmedText: string | null): ReadyVerdict {
  if (!checked || checked.resolved.main.length === 0) return { kind: 'refuse', message: 'No cards in this list were found. Check the card names and press Check again.' };
  const n = checked.errors.length;
  if (n > 0 && confirmedText !== text) {
    return { kind: 'confirm', message: `${n} line${n === 1 ? ' was' : 's were'} not found and will be left out of your deck. Press Ready again to continue without ${n === 1 ? 'it' : 'them'}.` };
  }
  return { kind: 'go' };
}

/** A stable id for a pasted list, so pressing Ready again (after a failure) never saves the same list twice. */
export function pastedDeckId(text: string): string {
  // FNV-1a over UTF-16 code units, twice with different seeds for 64 bits.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return `pasted-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
