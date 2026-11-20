/**
 * Home module test page (`?harness=home`; `?harness=history` opens `#/history`), dev and test builds only (src/main.ts):
 * the Shell, Home and History over the profile's IndexedDB stores (`?profile=`), a fake matchmaker whose status the spec
 * sets, and a fake starter source. Playwright reads it through `window.__homeHarness` (contracts.md Part C). M8-P2.
 */
import { mount as mountSvelte } from 'svelte';
import type { StarterDeck } from '../../data/starter';
import { createGameStore } from '../../store/games';
import { openStores, type LocalStores } from '../../store/stores';
import type { DeckRecord, GameSummary } from '../../store/types';
import type { Matchmaker, MatchmakerStatus } from '../../session/types';
import { live } from '../../util/lifecycle';
import '../design/base.css';
import { designCssVars, LOOKS } from '../design/tokens';
import type { LookId } from '../../themes/types';
import { toasts } from '../design/toasts';
import type { LaunchDeps } from '../play/launch';
import { newRoom, pageBase } from '../lobby/room';
import HomeHarness from './HomeHarness.svelte';

export interface HomeHarnessApi {
  ready: boolean;
  setStatus(s: MatchmakerStatus): void;
  status(): MatchmakerStatus;
  seeks(): { queues: string[]; deckId: string }[];
  starter(mode: 'ok' | 'fail'): void;
  seedDecks(decks: DeckRecord[]): Promise<void>;
  seedGames(games: GameSummary[]): Promise<void>;
  games(): Promise<GameSummary[]>;
  allGames(): Promise<GameSummary[]>;
  decks(): Promise<DeckRecord[]>;
  homePrefs(): Promise<unknown>;
  nickname(): Promise<string | null>;
  live(): Record<string, number>;
  toasts(): string[];
}

declare global {
  interface Window {
    __homeHarness?: HomeHarnessApi;
  }
}

/** A matchmaker double: the spec sets its status. */
function fakeMatchmaker(): Matchmaker & { set(s: MatchmakerStatus): void; seeks: { queues: string[]; deckId: string }[] } {
  let status: MatchmakerStatus = { phase: 'off' };
  const listeners = new Set<(s: MatchmakerStatus) => void>();
  const seeks: { queues: string[]; deckId: string }[] = [];
  const set = (s: MatchmakerStatus): void => {
    status = s;
    for (const l of listeners) l(s);
  };
  return {
    seeks,
    set,
    status: () => status,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    watch: () => undefined,
    seek(c) {
      seeks.push({ queues: [...c.queues], deckId: c.deckId });
      set({ phase: 'connecting' });
    },
    widen: () => undefined,
    cancel: () => set({ phase: 'off' }),
    answer: () => undefined,
    avoid: () => Promise.resolve(),
    dispose: () => listeners.clear(),
  };
}

export function mount(target: HTMLElement, start: 'home' | 'history' = new URLSearchParams(location.search).get('harness') === 'history' ? 'history' : 'home'): void {
  const root = document.documentElement;
  const lookParam = new URLSearchParams(location.search).get('look');
  const look: LookId = lookParam && lookParam in LOOKS ? (lookParam as LookId) : 'plain';
  for (const [k, v] of Object.entries(designCssVars(LOOKS[look]))) root.style.setProperty(k, v);
  root.dataset.look = look;
  document.body.style.margin = '0';
  document.body.style.background = 'var(--ds-mat)';
  if (start === 'history' && !location.hash) history.replaceState(null, '', '#/history');

  const params = new URLSearchParams(location.search);
  const mm = fakeMatchmaker();
  let starterMode: 'ok' | 'fail' = params.get('starter') === 'fail' ? 'fail' : 'ok';
  const shown: string[] = [];
  toasts.subscribe((l) => {
    for (const t of l) if (!shown.includes(`${t.id}:${t.text}`)) shown.push(`${t.id}:${t.text}`);
  });

  void (async () => {
    let stores: LocalStores | null = null;
    try {
      stores = await openStores();
    } catch {
      stores = null;
    }
    const games = stores ? createGameStore(stores.db) : null;
    const deps: LaunchDeps = {
      games,
      decks: stores?.decks ?? null,
      settings: stores?.settings ?? null,
      go: (h) => {
        location.hash = h;
      },
      toast: (text, action) => void toasts.info(text, action),
      now: () => Date.now(),
      newRoom: () => {
        const l = newRoom(pageBase(location.href));
        return { roomId: l.roomId, roomKey: l.roomKey };
      },
      matchmaker: mm,
      starterSource: { pool: () => Promise.resolve([]) },
      buildStarterDeck: (): Promise<StarterDeck> =>
        starterMode === 'fail'
          ? Promise.reject(new Error('the card source is unreachable'))
          : Promise.resolve({ name: 'Starter · Green', colour: 'G', set: 'M19', main: Array.from({ length: 40 }, (_, i) => ({ sid: `starter-${i % 20}` })) }),
      openComputer: () => Promise.reject(new Error('not implemented: M8-P6')),
    };
    await games?.purgeRemoved();
    mountSvelte(HomeHarness, { target, props: { stores: stores && games ? { ...stores, games } : stores, deps, matchmaker: mm, matchmakingAvailable: params.get('mm') !== 'off', computerAvailable: false } });
    window.__homeHarness = {
      ready: true,
      setStatus: (s) => mm.set(s),
      status: () => mm.status(),
      seeks: () => mm.seeks,
      starter: (m) => {
        starterMode = m;
      },
      async seedDecks(decks) {
        for (const d of decks) await stores?.decks.put(d);
      },
      async seedGames(list) {
        for (const g of list) await games?.put(g);
      },
      games: async () => (await games?.list()) ?? [],
      allGames: async () => (stores ? stores.db.getAll('games') : []),
      decks: async () => (await stores?.decks.list()) ?? [],
      homePrefs: async () => stores?.settings.get('home') ?? null,
      nickname: async () => (stores ? (await stores.identity.get()).nickname : null),
      live: () => ({ ...live() }),
      toasts: () => shown.map((s) => s.slice(s.indexOf(':') + 1)),
    };
  })();
}
