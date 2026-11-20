<!--
  D1, the deck library (journey.md 4.2 with the ruling "no summary panel"; visual.md board 2; decks.md section 3): a
  sheet with the title and count, the filter ALL · CUSTOM · BOOSTER and the primary NEW DECK, then a grid of deck tiles
  with the new-deck tile first. A click selects the deck Home plays with (Settings.home.deckId); PLAY selects and goes
  Home (refused while a search runs); EDIT, a double-click or Enter opens the deck page; ⋯ holds Duplicate, Rename,
  Convert to custom deck and Delete (an undo toast; the record goes when the toast ends or the page is left).
  Implementer: M8-P3.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { DeckRecord } from '../../store/types';
  import Button from '../design/Button.svelte';
  import Dialog from '../design/Dialog.svelte';
  import Field from '../design/Field.svelte';
  import MenuPopover from '../design/MenuPopover.svelte';
  import type { MenuGroup } from '../design/menu';
  import Segmented from '../design/Segmented.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import { toasts } from '../design/toasts';
  import type { DecksEnv } from './env';
  import DeckTile from './parts/DeckTile.svelte';
  import { DeckLibrary, type LibraryFilter } from './state/library';

  let { env }: { env: DecksEnv } = $props();

  let version = $state(0);
  let loaded = $state(false);
  let failed = $state(false);
  let notice = $state<string | null>(null);
  let filter = $state<LibraryFilter>('all');
  let menu = $state<{ deck: DeckRecord; anchor: HTMLElement } | null>(null);
  let renaming = $state<{ deck: DeckRecord; name: string } | null>(null);

  const lib = untrack(() => new DeckLibrary({
    decks: env.decks,
    settings: env.settings,
    cardData: env.cardData,
    newId: env.newId,
    now: env.now,
    searching: env.searching,
    onchange: () => version++,
  }));

  const view = $derived.by(() => {
    void version;
    return { all: lib.decks, visible: lib.visible, selected: lib.selectedId };
  });

  async function load(): Promise<void> {
    failed = false;
    try {
      await lib.load();
      loaded = true;
    } catch {
      failed = true;
    }
  }
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void lib.load().catch(() => undefined);
  };
  onMount(() => {
    void load();
    document.addEventListener('visibilitychange', onVisible);
  });
  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisible);
    void lib.dispose();
  });

  function setFilter(v: string): void {
    filter = v as LibraryFilter;
    lib.setFilter(filter);
  }
  async function select(d: DeckRecord): Promise<boolean> {
    const r = await lib.select(d.id);
    if (r !== true) {
      notice = r;
      toasts.info(r);
      return false;
    }
    notice = null;
    return true;
  }
  async function play(d: DeckRecord): Promise<void> {
    if (await select(d)) env.go('#/');
  }
  function open(d: DeckRecord): void {
    env.go(`#/decks/${encodeURIComponent(d.id)}`);
  }
  function remove(d: DeckRecord): void {
    if (!lib.remove(d.id)) return;
    toasts.undo(`${d.name} removed`, () => lib.undoRemove(d.id));
  }
  function groups(d: DeckRecord): MenuGroup[] {
    return [
      {
        items: [
          { id: 'duplicate', label: 'Duplicate', testid: 'deck-duplicate', run: () => void lib.duplicate(d.id) },
          { id: 'rename', label: 'Rename', testid: 'deck-rename', run: () => (renaming = { deck: d, name: d.name }) },
          ...(d.kind === 'sealed'
            ? [{ id: 'convert', label: 'Convert to custom deck', testid: 'deck-convert', run: () => void convert(d) }]
            : []),
          { id: 'delete', label: 'Delete', danger: true, testid: 'deck-delete', run: () => remove(d) },
        ],
      },
    ];
  }
  async function convert(d: DeckRecord): Promise<void> {
    const copy = await lib.convert(d.id);
    if (copy) toasts.info(`${copy.name} made. ${d.name} stays as it is.`);
  }
  async function rename(): Promise<void> {
    if (!renaming) return;
    await lib.rename(renaming.deck.id, renaming.name);
    renaming = null;
  }
  const menuPos = $derived.by(() => {
    if (!menu) return null;
    const r = menu.anchor.getBoundingClientRect();
    return { left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 6 };
  });
</script>

<div class="library" data-testid="deck-library">
  <section class="ds-sheet sheet" aria-label="Your decks">
    <div class="head">
      <h1 class="ds-t-title">Decks</h1>
      <span class="ds-t-meta" data-testid="deck-count">{view.all.length}</span>
      <Segmented
        label="Show"
        value={filter}
        onchange={setFilter}
        data-testid="deck-filter"
        options={[
          { value: 'all', label: 'All' },
          { value: 'custom', label: 'Custom' },
          { value: 'sealed', label: 'Booster' },
        ]}
      />
      <span class="grow"></span>
      <Button variant="primary" data-testid="new-deck" onclick={() => env.go('#/decks/new')}>+ New deck</Button>
    </div>

    {#if failed}
      <div class="empty">
        <p class="ds-t-reading">Your decks could not be loaded.</p>
        <Button onclick={() => void load()}>Try again</Button>
      </div>
    {:else}
      <div class="grid" role="listbox" aria-label="Decks" data-testid="deck-grid">
        <a class="newtile" href="#/decks/new" data-testid="new-deck-tile">
          <span class="plus" aria-hidden="true">+</span>
          <span class="ds-t-list">New deck</span>
          <span class="ds-t-meta">open boosters · build it · simple deck · paste a list</span>
        </a>
        {#each view.visible as d (d.id)}
          <DeckTile
            deck={d}
            faces={env.faces}
            selected={view.selected === d.id}
            playing={view.selected === d.id}
            onselect={() => void select(d)}
            onopen={() => open(d)}
            onplay={() => void play(d)}
            onmenu={(anchor) => (menu = { deck: d, anchor })}
          />
        {/each}
      </div>
      {#if loaded && view.all.length === 0}
        <div class="empty" data-testid="library-empty">
          <p class="ds-t-reading">No decks yet. Open boosters for a quick one, or build from all cards.</p>
          <div class="paths">
            <Button data-testid="path-boosters" onclick={() => env.go('#/decks/new/boosters')}>From boosters</Button>
            <Button data-testid="path-custom" onclick={() => env.go('#/decks/new/custom')}>Custom deck</Button>
            <Button data-testid="path-simple" onclick={() => env.go('#/decks/new/simple')}>Simple deck</Button>
            <Button data-testid="path-import" onclick={() => env.go('#/decks/new/import')}>Import a list</Button>
          </div>
          <p class="ds-t-meta">Card data and images load from Scryfall when you need them.</p>
        </div>
      {/if}
      {#if notice}<StatusLine tone="danger" data-testid="library-notice">{notice}</StatusLine>{/if}
    {/if}
  </section>

  {#if menu && menuPos}
    <div class="menu" style:left="{menuPos.left}px" style:top="{menuPos.top}px">
      <MenuPopover open={true} anchor={menu.anchor} label="Deck actions" groups={groups(menu.deck)} testid="deck-menu" onclose={() => (menu = null)} />
    </div>
  {/if}

  {#if renaming}
    <Dialog open={true} label="Rename deck" testid="rename-dialog" onclose={() => (renaming = null)}>
      <Field label="Deck name" bind:value={renaming.name} onenter={() => void rename()} data-testid="rename-field" maxlength="60" />
      {#snippet footer()}
        <Button variant="quiet" onclick={() => (renaming = null)}>Cancel</Button>
        <Button variant="primary" data-testid="rename-save" onclick={() => void rename()}>Save</Button>
      {/snippet}
    </Dialog>
  {/if}
</div>

<style>
  .library {
    box-sizing: border-box;
    padding: var(--ds-space-xl) var(--ds-space-xl) 0;
    min-height: 100%;
  }
  .sheet {
    max-width: 1248px;
    margin: 0 auto;
    min-height: calc(100vh - 2 * var(--ds-space-xl));
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--ds-space-lg);
    flex-wrap: wrap;
    min-height: 44px;
  }
  .grow {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 220px);
    gap: var(--ds-space-xl);
    justify-content: start;
  }
  .newtile {
    box-sizing: border-box;
    width: 220px;
    height: 268px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--ds-space-lg);
    color: var(--ds-ink);
    text-decoration: none;
    flex-direction: column;
    gap: var(--ds-space-sm);
    border-radius: var(--ds-radius-panel);
    border: 1px dashed var(--ds-line);
    text-transform: none;
    white-space: normal;
    text-align: center;
  }
  .plus {
    font-size: 32px;
    line-height: 1;
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-md);
    align-items: flex-start;
  }
  .paths {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-sm);
  }
  .menu {
    position: fixed;
    z-index: 60;
    width: 240px;
  }
  @media (max-width: 600px) {
    .library {
      padding: var(--ds-space-md) var(--ds-space-md) 0;
    }
    .grid {
      justify-content: center;
    }
  }
</style>
