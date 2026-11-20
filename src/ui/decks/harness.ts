/**
 * The `?harness=decks` page (docs/design/m8/contracts.md Part C "Harness pages"): Deck mode over the profile's
 * IndexedDB stores (`?profile=`), the fixture card data and set data a test injects (`window.__spellplaneFixtures`,
 * `window.__spellplaneSets`), placeholder or Scryfall faces as the URL says, and the `decks` debug hook. Nothing here
 * needs Home, the waiting room or another package. `window.__decksHarness` lets a spec seed decks and flip the search
 * lock. Implementer: M8-P3.
 */
import { mount as mountSvelte, unmount } from 'svelte';
import { ListCardDataSource } from '../../data/deck/list-source';
import { createFaceSource } from '../../data/faces';
import { listSetSource } from '../../data/sets';
import type { CardData, SetData } from '../../data/types';
import { importLibrary } from '../../store/decks';
import { openStores, type LocalStores } from '../../store/stores';
import type { DeckRecord } from '../../store/types';
import { live } from '../../util/lifecycle';
import '../design/base.css';
import { spVarsFromLook } from '../design/css';
import { designCssVars, lookTokens } from '../design/tokens';
import { registerDecksPart } from './debug';
import DeckPickerSheet from './DeckPickerSheet.svelte';
import HarnessRoot from './HarnessRoot.svelte';

export interface DecksHarnessApi {
  ready: boolean;
  /** Put records into the profile's deck store. */
  seed(decks: DeckRecord[]): Promise<void>;
  /** Import a library file's text (versions 1 and 2) into the store; returns the ids. */
  seedLibrary(text: string): Promise<string[]>;
  /** Pretend a matchmaking search runs (the selected deck is locked). */
  setSearching(on: boolean): void;
  live(): Record<string, number>;
  /** Open the deck picker sheet; `booster` allows booster decks only ("Booster decks only"). */
  openPicker(mode: 'any' | 'booster'): void;
  /** The id the picker picked, or null. */
  picked(): string | null;
}

declare global {
  interface Window {
    __decksHarness?: DecksHarnessApi;
    __spellplaneFixtures?: { cards: CardData[] };
    __spellplaneSets?: SetData[];
  }
}

export function mount(target: HTMLElement): void {
  const tokens = lookTokens('plain');
  for (const [k, v] of Object.entries({ ...spVarsFromLook(tokens), ...designCssVars(tokens) })) document.documentElement.style.setProperty(k, v);
  if (!location.hash) location.hash = '#/decks';
  void start(target);
}

async function start(target: HTMLElement): Promise<void> {
  let stores: LocalStores | null = null;
  try {
    stores = await openStores();
  } catch {
    stores = null;
  }
  const cardData = new ListCardDataSource(window.__spellplaneFixtures?.cards ?? []);
  const sets = listSetSource(window.__spellplaneSets ?? []);
  const faces = createFaceSource(cardData);
  let searching = false;
  let picked: string | null = null;
  registerDecksPart(stores?.decks ?? null);
  const api: DecksHarnessApi = {
    ready: false,
    async seed(decks) {
      for (const d of decks) await stores?.decks.put(d);
    },
    async seedLibrary(text) {
      const r = importLibrary(text);
      for (const d of r.decks) await stores?.decks.put(d);
      return r.decks.map((d) => d.id);
    },
    setSearching(on) {
      searching = on;
    },
    live: () => ({ ...live() }),
    openPicker(mode) {
      picked = null;
      const host = document.createElement('div');
      target.appendChild(host);
      let sheet: ReturnType<typeof mountSvelte> | null = null;
      const close = (): void => {
        if (sheet) void unmount(sheet);
        sheet = null;
        host.remove();
      };
      sheet = mountSvelte(DeckPickerSheet, {
        target: host,
        props: {
          decks: stores?.decks ?? null,
          faces,
          allow: (d: DeckRecord) => (mode === 'any' || d.kind === 'sealed' ? true : 'Booster decks only'),
          onpick: (d: DeckRecord) => {
            picked = d.id;
            close();
          },
          onclose: close,
        },
      });
    },
    picked: () => picked,
  };
  window.__decksHarness = api;
  mountSvelte(HarnessRoot, {
    target,
    props: { decks: stores?.decks ?? null, settings: stores?.settings ?? null, cardData, sets, faces, searching: () => searching },
  });
  api.ready = true;
}
