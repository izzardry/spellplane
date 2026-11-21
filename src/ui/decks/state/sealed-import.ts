/**
 * The free-basic test for importing deck files and backups (decks.md section 7, invariant 4; D25: a file keeps a
 * sealed deck sealed if its cards fit its pool, free basics allowed). The check needs card data for the main cards
 * outside each pool, which a page usually has not loaded, so it is loaded first: a booster deck's basics then count as
 * free instead of turning the deck into a custom one.
 */
import type { CardRef } from '../../../core/types';
import { isFreeBasic } from '../../../data/deck/analyse';
import type { CardData } from '../../../data/types';
import { sealedOutsideSids } from '../../../store/decks';

/** Loads card data by Scryfall id (CardDataSource.getMany); ids it does not know are missing from the result. */
export type LoadCards = (sids: string[]) => Promise<Record<string, CardData>>;

/**
 * Read the file's text, load the card data of every main card outside a sealed deck's pool, and return the test to
 * pass as `isFreeBasic` to importLibrary or readBackup. A card that still has no data (or a failed load) counts as
 * foreign: the check is never skipped. Text that is not JSON gives a test that knows only `peek`.
 */
export async function freeBasicTest(text: string, load: LoadCards | undefined, peek: (ref: CardRef) => CardData | null): Promise<(ref: CardRef) => boolean> {
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    // importLibrary and readBackup report the file.
  }
  const sids = sealedOutsideSids(json).filter((sid) => peek({ sid }) === null);
  let loaded: Record<string, CardData> = {};
  if (load && sids.length > 0) {
    try {
      loaded = await load(sids);
    } catch {
      // Unknown cards stay foreign.
    }
  }
  return (ref) => isFreeBasic(peek(ref) ?? loaded[ref.sid] ?? null);
}
