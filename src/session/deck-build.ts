/**
 * What Ready in the builder commits (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "Ready locks
 * the deck and publishes its commitment"), next to the session so that `DraftControls.ready()` (assembled by M2-P7) and
 * the builder's own checks read the deck the same way. Implementer: M2-P5.
 */
import type { CardRef, DeckBuild } from '../core/types';
import type { DeckImport } from './types';

/**
 * The deck a build commits: the main deck in deck order as the library, every other pool card as the sideboard
 * (dispensed basics outside the deck are back in the dispenser, so they are not part of the sideboard). Deck ids the
 * pool lacks and repeats are skipped.
 */
export function deckImportOf(build: DeckBuild): DeckImport {
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const ref = (r: CardRef): CardRef => (r.foil ? { sid: r.sid, foil: true } : { sid: r.sid });
  const seen = new Set<string>();
  const main: CardRef[] = [];
  for (const id of build.main) {
    const c = byId.get(id);
    if (!c || seen.has(id)) continue;
    seen.add(id);
    main.push(ref(c.ref));
  }
  const side = build.cards.filter((c) => !seen.has(c.id) && !c.basic).map((c) => ref(c.ref));
  return { main, side };
}
