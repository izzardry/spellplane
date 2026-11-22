<!--
  The deck picker sheet (decks.md section 9; journey.md 4.1; contracts.md Part G "Decks" item 4): the library's tiles
  in a sheet; `allow(deck)` answers true or the reason a deck may not be picked ("Booster decks only"). A deck that is
  not allowed keeps its tile with text and well dimmed and a reason badge; its card face keeps full opacity. A click on
  an allowed tile picks it. `decks` and `faces` come from the page that mounts it (Home, the waiting room); without a
  store the sheet says so. Implementer: M8-P3.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { createFaceSource } from '../../data/faces';
  import { ScryfallCardDataSource } from '../../data/source';
  import type { FaceSource } from '../../data/types';
  import { openStores, type LocalStores } from '../../store/stores';
  import type { DeckRecord, DeckStore } from '../../store/types';
  import IconButton from '../design/IconButton.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import DeckTile from './parts/DeckTile.svelte';

  let {
    allow = undefined,
    onpick,
    onclose = undefined,
    decks = null,
    faces = null,
    selectedId = null,
  }: {
    allow?: ((deck: DeckRecord) => true | string) | undefined;
    onpick: (deck: DeckRecord) => void;
    onclose?: (() => void) | undefined;
    /** The profile's deck library. */
    decks?: DeckStore | null;
    /** Card faces for the covers; without it covers show the neutral back. */
    faces?: FaceSource | null;
    /** The deck currently chosen. */
    selectedId?: string | null;
  } = $props();

  let list = $state.raw<DeckRecord[] | null>(null);
  // Without the page's sources the sheet opens the profile's library itself and draws covers from Scryfall.
  const coverFaces: FaceSource = untrack(() => faces ?? createFaceSource(new ScryfallCardDataSource()));
  let own: LocalStores | null = null;
  let gone = false;

  onMount(() => {
    void (async () => {
      let store = decks;
      if (!store) {
        own = await openStores().catch(() => null);
        if (gone) own?.close();
        store = own?.decks ?? null;
      }
      list = store ? await store.list().catch(() => []) : [];
    })();
  });
  onDestroy(() => {
    gone = true;
    own?.close();
  });

  function reason(d: DeckRecord): string | null {
    const a = allow ? allow(d) : true;
    return a === true ? null : a;
  }
  function pick(d: DeckRecord): void {
    if (reason(d) !== null) return;
    onpick(d);
  }
</script>

<div class="ds-scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose?.()}>
  <div
    data-ds-layer="sheet"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="ds-sheet picker"
    aria-label="Choose a deck"
    data-testid="deck-picker"
    onkeydown={(e) => {
      if (e.key === 'Escape' && onclose) {
        e.stopPropagation();
        onclose();
      }
    }}
  >
    <div class="ds-sheet__head">
      <h2 class="ds-t-title">Choose a deck</h2>
      {#if onclose}<IconButton label="Close" size="sm" variant="quiet" icon="close" onclick={onclose} />{/if}
    </div>
    {#if list && list.length === 0}
      <StatusLine>No decks yet. Make one in Decks.</StatusLine>
    {:else if list}
      <div class="grid" role="listbox" aria-label="Decks">
        {#each list as d (d.id)}
          <DeckTile deck={d} faces={coverFaces} selected={selectedId === d.id} locked={reason(d)} actions={false} onselect={() => pick(d)} onopen={() => pick(d)} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .picker {
    width: min(1200px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    overflow: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 220px);
    gap: var(--ds-space-xl);
    justify-content: center;
  }
</style>
