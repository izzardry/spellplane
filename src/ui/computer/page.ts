/**
 * The page's services for a computer game when the route is not handed an opener (contracts.md Part C: a route opens
 * its session; computer.md section 3): card data and the identity from the table context App sets, the profile's
 * stores, and Sparring's starter pool (one Scryfall search per set at runtime; the injected fixture cards in a test
 * build, never fetched). Lazy-loaded with session/computer on the first computer game.
 */
import { cardSourcePool, cardsPool, type StarterPoolSource } from '../../data/starter';
import type { CardDataSource } from '../../data/types';
import { liveIdentity } from '../../session/live-identity';
import type { ComputerDeps } from '../../session/computer';
import { openStores, type LocalStores } from '../../store/stores';
import type { IdentityStore } from '../../store/types';
import { toasts } from '../design/toasts';

let stores: Promise<LocalStores | null> | null = null;

/** The profile's stores, opened once per page; null when storage is blocked (the game then runs unsaved). */
export function pageStores(): Promise<LocalStores | null> {
  stores ??= openStores().catch(() => null);
  return stores;
}

/** Sparring's pool: the injected fixture cards in a test build, else the card source's search. */
export function pageStarterPool(cardData: CardDataSource): StarterPoolSource {
  const injected = __SPELLPLANE_DEBUG__ && typeof window !== 'undefined' ? window.__spellplaneFixtures : undefined;
  return injected && Array.isArray(injected.cards) ? cardsPool(injected.cards) : cardSourcePool(cardData);
}

/** Computer-game services from the page's table context. */
export async function pageComputerDeps(ctx: { cardData: CardDataSource; identity?: IdentityStore | undefined }): Promise<ComputerDeps> {
  const s = await pageStores();
  const store = ctx.identity ?? s?.identity;
  if (!store) throw new Error('this browser blocks local storage, which a table needs for your identity and your hidden cards');
  const identity = await liveIdentity(store).identity();
  return {
    cardData: ctx.cardData,
    identity,
    tables: s?.tables ?? null,
    computer: s?.computer ?? null,
    decks: s?.decks ?? null,
    starter: pageStarterPool(ctx.cardData),
    notice: (text) => toasts.info(text),
    onError: (e) => console.warn('Sparring:', e),
  };
}
