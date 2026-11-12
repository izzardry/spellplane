/**
 * Browser entry for the list view specs (tests/e2e/builder/list/*.spec.ts). Bundled from source by ./bundle.ts and
 * served by a Playwright route on the app's origin (the `?harness=` entries live in main.ts, which M2-P7 owns). It
 * mounts the real ListView and deck library inside a stand-in builder container, over the injected fixture card data
 * (window.__spellplaneFixtures), the real Scryfall search client (the spec answers /cards/search from fixtures through
 * a route, so nothing reaches the network) and the real IndexedDB deck store namespaced by ?profile=.
 * window.__listHarness lets the spec act as the builder table: read and replace the shared DeckBuild, switch views.
 */
import { mount } from 'svelte';
import type { CardRef, DeckBuild } from '../../../../src/core/types';
import { RateLimiter } from '../../../../src/data/limiter';
import { ScryfallClient } from '../../../../src/data/scryfall';
import { ScryfallCardDataSource } from '../../../../src/data/source';
import { FixtureCardDataSource } from '../../../../src/debug/fixture-cards';
import type { BuilderSort } from '../../../../src/scene/types';
import { openStores } from '../../../../src/store/stores';
import type { DeckRecord } from '../../../../src/store/types';
import type { BuilderViewKind } from '../../../../src/ui/types';
import Container from './Container.svelte';
import { harness } from './control.svelte';

export interface ListHarness {
  build(): DeckBuild;
  /** Replace the build as the builder table would after a gesture. */
  setBuild(build: DeckBuild): void;
  view(kind: BuilderViewKind): void;
  sort(key: BuilderSort): void;
  /** How many times the list view wrote the build back. */
  changes(): number;
}

declare global {
  interface Window {
    __listHarness?: ListHarness;
  }
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fixtures = new FixtureCardDataSource(window.__spellplaneFixtures?.cards ?? []);
  // A real Scryfall client; the spec's route answers it. One request at a time like the app's shared limiter.
  const scryfall = new ScryfallCardDataSource({ client: new ScryfallClient({ limiter: new RateLimiter() }), cache: null });
  const stores = params.get('storage') === 'off' ? null : await openStores();
  const origin: DeckRecord['origin'] | undefined = params.get('origin') ? { format: 'pass', sets: params.get('origin')!.split(',') } : undefined;
  const target = document.createElement('div');
  document.body.appendChild(target);
  mount(Container, {
    target,
    props: {
      card: (ref: CardRef) => fixtures.peek(ref.sid) ?? scryfall.peek(ref.sid),
      search: (q: string) => scryfall.searchCards(q),
      decks: stores?.decks,
      origin,
    },
  });
  window.__listHarness = {
    build: () => JSON.parse(JSON.stringify(harness.build)) as DeckBuild,
    setBuild: (b) => {
      harness.build = JSON.parse(JSON.stringify(b)) as DeckBuild;
    },
    view: (kind) => {
      harness.view = kind;
    },
    sort: (key) => {
      harness.sort = key;
    },
    changes: () => harness.changes,
  };
  document.body.dataset.ready = '1';
}

void start();
