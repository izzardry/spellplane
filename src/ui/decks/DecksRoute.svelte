<!--
  Every `#/decks…` route (decks.md section 1; journey.md 4.2, 4.3): `#/decks` the library, `#/decks/new[/<path>]` the
  new-deck chooser, `#/decks/<id>` the deck page, `#/decks/<id>/open` the opening. Deck mode is DOM only: no table,
  no session, no canvas left alive. The app passes the stores; card data, set data and faces are optional props (the
  app's sources when App passes them, else Scryfall, MTGJSON and the profile's face mode; the decks harness passes
  fixture sources). Without storage the library works in memory and says so. Implementer: M8-P3.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { createFaceSource } from '../../data/faces';
  import { createSetDataSource } from '../../data/mtgjson';
  import { ScryfallCardDataSource } from '../../data/source';
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import { newDeckId } from '../../store/decks';
  import type { DeckStore, SettingsStore } from '../../store/types';
  import StatusLine from '../design/StatusLine.svelte';
  import type { Route } from '../routes';
  import { attachDecksDebug, decksOffline, onDecksOffline } from './debug';
  import DeckPage from './DeckPage.svelte';
  import { memoryDeckStore, type DecksEnv } from './env';
  import Library from './Library.svelte';
  import NewDeck from './NewDeck.svelte';
  import Opening from './Opening.svelte';

  let {
    route,
    decks = null,
    settings = null,
    cardData = undefined,
    sets = undefined,
    faces = undefined,
    searching = undefined,
    go = undefined,
  }: {
    route: Extract<Route, { name: 'decks' | 'deckNew' | 'deck' | 'deckOpen' }>;
    decks?: DeckStore | null;
    settings?: SettingsStore | null;
    cardData?: CardDataSource | undefined;
    sets?: SetDataSource | undefined;
    faces?: FaceSource | undefined;
    /** True while a matchmaking search runs (contracts.md Part E). */
    searching?: (() => boolean) | undefined;
    go?: ((hash: string) => void) | undefined;
  } = $props();

  const env: DecksEnv = untrack(() => {
    const data = cardData ?? new ScryfallCardDataSource();
    return {
      decks: decks ?? memoryDeckStore(),
      settings,
      cardData: data,
      sets: sets ?? createSetDataSource(),
      faces: faces ?? createFaceSource(data),
      now: () => Date.now(),
      newId: newDeckId,
      go: go ?? ((hash: string) => void (location.hash = hash)),
      searching: searching ?? (() => false),
      offline: () => decksOffline() || (typeof navigator !== 'undefined' && navigator.onLine === false),
      onOffline: onDecksOffline,
    };
  });
  const noStorage = untrack(() => !decks);
  const detach = attachDecksDebug({ decks: env.decks, cardData: env.cardData, settings: env.settings, now: env.now });
  onDestroy(detach);
</script>

<div class="ds-root decks" data-testid="decks-route" data-route={route.name}>
  {#if noStorage && route.name === 'decks'}
    <StatusLine tone="danger" data-testid="decks-unsaved">Decks are not saved in this window. Export them before you close it.</StatusLine>
  {/if}
  {#if route.name === 'decks'}
    <Library {env} />
  {:else if route.name === 'deckNew'}
    {#key route.path}<NewDeck {env} path={route.path} />{/key}
  {:else if route.name === 'deck'}
    {#key route.id}<DeckPage {env} id={route.id} />{/key}
  {:else}
    {#key route.id}<Opening {env} id={route.id} />{/key}
  {/if}
</div>

<style>
  .decks {
    min-height: 100%;
  }
</style>
