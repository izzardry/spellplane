/**
 * The `?harness=computer` page (docs/design/m8/contracts.md Part C "Harness pages"; PLAN M8-P6 E2E): a computer game
 * from two fixture decks (a green starter for the human, Sparring's red one, both generated from the injected M19
 * fixture cards, never fetched) mounted on the table frame by the real `ComputerRoute`. Leaving goes to a small stand-in
 * Home (`harness-home`) whose `Continue` mounts the route again, so a spec can leave and resume in one page. The page
 * registers the debug hook's `state`, `secrets`, `dispatch` (the human session) and `bot` parts and
 * `window.__computerHarness`. Dev and test builds only.
 */
import { mount as mountSvelte, unmount } from 'svelte';
import type { Action } from '../../core/actions';
import { stateHash } from '../../core/hash';
import type { ScryfallId, TableState } from '../../core/types';
import { buildStarterDeck, cardsPool } from '../../data/starter';
import type { CardData, CardDataSource, DeckList, ResolvedDeck } from '../../data/types';
import { createFaceSource } from '../../data/faces';
import { mtg } from '../../games/index';
import { createTableScene } from '../../scene/index';
import type { ComputerDeps } from '../../session/computer';
import { liveIdentity } from '../../session/live-identity';
import type { ComputerGame } from '../../session/types';
import { openStores } from '../../store/stores';
import { registerDebug } from '../../util/debug';
import { live } from '../../util/lifecycle';
import '../design/base.css';
import { designCssVars, LOOKS } from '../design/tokens';
import ToastHost from '../design/ToastHost.svelte';
import type { TableDeps } from '../table/types';
import { botDebugClock, botDebugPart } from './debug';
import HarnessPage from './HarnessPage.svelte';

/** What a spec reads and drives (page.evaluate). */
export interface ComputerHarnessApi {
  /** 'table' while the route is mounted, 'home' after leaving. */
  route(): 'table' | 'home';
  /** The state hash of the human session's table, null without one. */
  hash(): Promise<string | null>;
  /** The lifecycle counts (util/lifecycle.ts). */
  live(): Record<string, number>;
  /** Mount the route again (as Home's Continue does). */
  remount(): void;
  /** Hashes the route navigated to. */
  went(): string[];
  /** The names of the cards in Sparring's hand (read from the bot session, for the hidden-information check only). */
  botHandNames(): string[];
}

declare global {
  interface Window {
    __computerHarness?: ComputerHarnessApi;
  }
}

/** Card data over the cards Playwright injected (`window.__spellplaneFixtures`); never fetched. */
function injectedCards(): CardDataSource {
  const list: CardData[] = window.__spellplaneFixtures?.cards ?? [];
  const byId = new Map<ScryfallId, CardData>(list.map((c) => [c.id, c]));
  const peek = (sid: ScryfallId): CardData | null => byId.get(sid) ?? null;
  return {
    peek,
    get: (sid) => Promise.resolve(peek(sid)),
    getMany: (sids) => Promise.resolve(Object.fromEntries(sids.flatMap((s) => (byId.has(s) ? [[s, byId.get(s)!]] : [])))),
    resolveDeck: (_list: DeckList): Promise<ResolvedDeck> => Promise.resolve({ main: [], side: [], cards: {}, errors: [] }),
    searchTokens: () => Promise.resolve([]),
    relatedTokens: () => Promise.resolve([]),
  };
}

const ROOM = 'c-harness';

export function mount(target: HTMLElement): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(designCssVars(LOOKS.plain))) root.style.setProperty(k, v);
  document.body.style.margin = '0';
  document.body.style.height = '100vh';
  target.style.height = '100%';
  target.textContent = '';

  const cardData = injectedCards();
  const faces = createFaceSource(cardData);
  const starter = cardsPool(window.__spellplaneFixtures?.cards ?? []);
  const room = /^#\/c\/([^/]+)$/.exec(location.hash)?.[1] ?? ROOM;
  const went: string[] = [];
  let current: ComputerGame | null = null;

  const stores = openStores();
  const tableDeps = stores.then(
    (s): TableDeps => ({ createScene: createTableScene, faces, cardData, game: mtg, settings: s.settings, identity: s.identity, decks: s.decks }),
  );
  const deps = stores.then(async (s): Promise<ComputerDeps> => {
    const identity = await liveIdentity(s.identity).identity();
    return { cardData, identity, tables: s.tables, computer: s.computer, decks: s.decks, starter, onError: (e) => console.warn('Sparring:', e) };
  });

  /** Resume the saved game of the room, else a new one: the green starter against Sparring's red deck. */
  async function open(roomId: string): Promise<ComputerGame> {
    const { createComputerGame, resumeComputerGame } = await import('../../session/computer');
    const d = { ...(await deps) };
    const clock = botDebugClock();
    if (clock) d.clock = clock;
    const saved = await d.computer?.get(roomId);
    const g = saved
      ? await resumeComputerGame(roomId, d)
      : await (async () => {
          const human = await buildStarterDeck(starter, { colour: 'G', seed: 'harness-human' });
          return createComputerGame({ roomId, deckId: null, deck: { main: human.main, side: [] }, deckName: human.name, colour: 'R', seed: 'harness', deps: d });
        })();
    current = g;
    return g;
  }

  let page: ReturnType<typeof mountSvelte> | null = null;
  let shown: 'table' | 'home' = 'table';
  const show = (what: 'table' | 'home'): void => {
    if (page) void unmount(page);
    page = null;
    shown = what;
    if (what === 'home') current = null;
    void Promise.all([tableDeps, stores]).then(([t, s]) => {
      if (shown !== what || page) return;
      page = mountSvelte(HarnessPage, {
        target,
        props: { what, room, open, deps: t, games: s.games, go: (h: string) => (went.push(h), show(h === '#/' ? 'home' : 'table')), oncontinue: () => show('table') },
      });
    });
  };
  mountSvelte(ToastHost, { target: document.body, props: {} });

  const session = (): ComputerGame['session'] | null => (shown === 'table' ? current?.session ?? null : null);
  registerDebug({
    state: () => session()?.getState() as TableState,
    secrets: () => session()!.secrets(),
    dispatch: (a: Action) => void session()?.dispatch(a),
    bot: botDebugPart(),
  });
  window.__computerHarness = {
    route: () => shown,
    hash: async () => {
      const s = session();
      return s ? stateHash(s.getState()) : null;
    },
    live: () => ({ ...live() }),
    remount: () => show('table'),
    went: () => [...went],
    botHandNames: () => {
      const bot = (current?.handle as { __bot?: { secrets(): { hand: string[]; identities: Record<string, { card: { sid: string } }> } } } | undefined)?.__bot;
      if (!bot || shown !== 'table') return [];
      const sec = bot.secrets();
      return sec.hand.flatMap((id) => {
        const sid = sec.identities[id]?.card.sid;
        const name = sid ? cardData.peek(sid)?.name : undefined;
        return name ? [name] : [];
      });
    },
  };
  show('table');
}
