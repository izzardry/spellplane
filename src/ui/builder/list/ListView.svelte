<!--
  The builder's list view: pool and deck as a compact two-column list with filters and counts (DESIGN "Pre-game: draft,
  sealed and deck building", Deck building: List view, "for quick edits and for tablets"), Scryfall search-and-add
  (Constructed decks: "Search and build") and the local deck library (Local deck library). It edits the shared DeckBuild
  only through `onChange`, so the builder table shows the same deck. Contracts: M2-C; implementer: M2-P6.
-->
<script lang="ts">
  import type { CardRef, DeckBuild } from '../../../core/types';
  import type { CardData } from '../../../data/types';
  import type { BuilderSort } from '../../../scene/types';
  import { LIMITED_MINIMUM, type ListViewProps } from '../../types';
  import Library from './Library.svelte';
  import { addCard, CARD_KINDS, COLOUR_FILTERS, COLOUR_LABELS, isBasicLand, KIND_LABELS, listModel, moveToDeck, moveToPool, oneOf, type CardKind, type ColourFilter, type ListRow } from './model';
  import type { ListLibraryProps } from './props';
  import { foundCards as found, listUi } from './state.svelte';

  let { build, onChange, card, sort, search, decks, origin }: ListViewProps & ListLibraryProps = $props();

  const SORT_LABELS: Record<BuilderSort, string> = { colour: 'Colour', manaValue: 'Mana value', type: 'Type' };

  /** Bumped while some card data is still loading, so rows fill in when it arrives. */
  let tick = $state(0);
  const lookup = (ref: CardRef): CardData | null => card(ref) ?? found.get(ref.sid) ?? null;

  const effectiveSort = $derived(listUi.sort ?? sort);
  const model = $derived.by(() => {
    void tick;
    return listModel(build, lookup, effectiveSort, listUi.filters);
  });
  /** Whether some card of the build (filtered out or not) still has no data: filters hide such cards, so look at all. */
  const loading = $derived.by(() => {
    void tick;
    return build.cards.some((c) => lookup(c.ref) === null);
  });
  $effect(() => {
    if (!loading) return;
    const t = setInterval(() => tick++, 500);
    return () => clearInterval(t);
  });

  const filtered = $derived(listUi.filters.text.trim() !== '' || listUi.filters.colours.length > 0 || listUi.filters.kind !== 'all');
  /** Cards in the deck (ids the pool lacks do not count, as in the deck column). */
  const deckCount = $derived(model.deck.total);
  const toGo = $derived(Math.max(0, LIMITED_MINIMUM - deckCount));

  function change(next: DeckBuild) {
    onChange(next);
  }
  function move(row: ListRow, fromDeck: boolean, all: boolean) {
    const ids = all ? row.ids : oneOf(row, build, fromDeck);
    change(fromDeck ? moveToPool(build, ids) : moveToDeck(build, ids));
  }
  function moreBasic(row: ListRow) {
    change(addCard(build, row.ref, { toDeck: true, basic: true }));
  }
  function toggleColour(c: ColourFilter) {
    const cs = listUi.filters.colours;
    listUi.filters.colours = cs.includes(c) ? cs.filter((x) => x !== c) : COLOUR_FILTERS.filter((x) => x === c || cs.includes(x));
  }
  function clearFilters() {
    listUi.filters = { text: '', colours: [], kind: 'all' };
  }

  let searching = $state(false);
  let searchSeq = 0;
  async function runSearch() {
    const q = listUi.query.trim();
    if (!search || !q) return;
    const my = ++searchSeq;
    searching = true;
    listUi.searchError = '';
    try {
      const r = await search(q);
      if (my !== searchSeq) return;
      listUi.results = r;
      listUi.searchedFor = q;
    } catch (e) {
      if (my !== searchSeq) return;
      listUi.results = [];
      listUi.searchedFor = q;
      listUi.searchError = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (my === searchSeq) searching = false;
    }
  }
  function addFound(c: CardData, toDeck: boolean) {
    found.set(c.id, c);
    change(addCard(build, { sid: c.id }, { toDeck, basic: isBasicLand(c) }));
  }
  const inBuild = $derived.by(() => {
    const n: Record<string, number> = {};
    for (const c of build.cards) n[c.ref.sid] = (n[c.ref.sid] ?? 0) + 1;
    return n;
  });
</script>

{#snippet column(which: 'pool' | 'deck')}
  {@const col = which === 'deck' ? model.deck : model.pool}
  {@const fromDeck = which === 'deck'}
  <section class="column" data-testid={`list-${which}`} aria-label={fromDeck ? 'Deck' : 'Pool'}>
    <header>
      <h2>{fromDeck ? 'Deck' : 'Pool'} <span class="count" data-testid={`list-${which}-count`}>{col.total}</span></h2>
      {#if fromDeck}
        <span class="muted" data-testid="list-deck-lands">{model.deckLands} {model.deckLands === 1 ? 'land' : 'lands'}</span>
        {#if toGo > 0}<span class="hint" data-testid="list-minimum-hint">{LIMITED_MINIMUM}-card minimum: {toGo} to go</span>{/if}
      {/if}
      {#if filtered}<span class="muted" data-testid={`list-${which}-shown`}>showing {col.shown}</span>{/if}
    </header>
    {#if col.groups.length === 0}
      <p class="muted empty">{col.total === 0 ? (fromDeck ? 'No cards in the deck yet. Click a pool card to add it.' : 'Every card is in the deck.') : 'No card matches the filters.'}</p>
    {/if}
    {#each col.groups as g (g.key)}
      <div class="group" data-testid="list-group" data-group={g.key}>
        <h3>{g.label} <span class="muted">{g.count}</span></h3>
        <ul>
          {#each g.rows as row (row.key)}
            <li class="row" data-testid="list-row" data-sid={row.ref.sid} data-foil={row.ref.foil ? 'true' : undefined} data-count={row.count} class:loading={!row.known} aria-busy={row.known ? undefined : 'true'}>
              <button type="button" class="main" title={fromDeck ? 'Move one to the pool' : 'Move one to the deck'} onclick={(e) => move(row, fromDeck, e.shiftKey)}>
                <!-- The accessible name starts with the action and contains the visible text (WCAG 2.5.3, M5-P4). -->
                <span class="sr-only">{fromDeck ? 'Move one to the pool' : 'Move one to the deck'}: </span>
                <span class="n">{row.count}</span>
                <span class="name">{row.name}{#if row.ref.foil}<span class="foil" title="Foil" aria-label="foil">✦</span>{/if}</span>
                <span class="cost muted">{row.manaCost}</span>
              </button>
              {#if row.count > 1}
                <button type="button" class="small" data-testid="list-move-all" title={fromDeck ? 'Move all to the pool' : 'Move all to the deck'} aria-label={`${fromDeck ? 'Move all to the pool' : 'Move all to the deck'}: ${row.name}`} onclick={() => move(row, fromDeck, true)}>all</button>
              {/if}
              {#if fromDeck && row.basicLand}
                <button type="button" class="small" data-testid="list-more-basic" title="One more from the basic-land dispenser" aria-label={`One more ${row.name}`} onclick={() => moreBasic(row)}>+</button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </section>
{/snippet}

<section class="list-view" data-testid="builder-list" aria-label="Deck list">
  <div class="toolbar" role="group" aria-label="Filters">
    <input class="text" type="search" placeholder="Filter by name, type or text" aria-label="Filter by name, type or text" data-testid="list-filter-text" bind:value={listUi.filters.text} />
    <span class="colours">
      {#each COLOUR_FILTERS as c (c)}
        <button type="button" class="pip" data-testid="list-filter-colour" data-colour={c} aria-pressed={listUi.filters.colours.includes(c)} title={COLOUR_LABELS[c]} aria-label={COLOUR_LABELS[c]} onclick={() => toggleColour(c)}>{c}</button>
      {/each}
    </span>
    <select aria-label="Card type" data-testid="list-filter-kind" bind:value={listUi.filters.kind}>
      <option value="all">All types</option>
      {#each CARD_KINDS as k (k)}<option value={k}>{KIND_LABELS[k as CardKind]}</option>{/each}
    </select>
    <label class="sort">
      Sort
      <select data-testid="list-sort" value={effectiveSort} onchange={(e) => (listUi.sort = (e.currentTarget as HTMLSelectElement).value as BuilderSort)}>
        {#each Object.keys(SORT_LABELS) as k (k)}<option value={k}>{SORT_LABELS[k as BuilderSort]}</option>{/each}
      </select>
    </label>
    {#if filtered}<button type="button" class="link" data-testid="list-filter-clear" onclick={clearFilters}>Clear filters</button>{/if}
  </div>

  <div class="columns">
    {@render column('pool')}
    {@render column('deck')}
  </div>

  {#if search}
    <section class="search" data-testid="list-search" aria-label="Search all cards">
      <h2>Add cards</h2>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <input type="search" placeholder="Search Scryfall, e.g. t:goblin cmc<=2" aria-label="Search all cards" data-testid="list-search-query" bind:value={listUi.query} />
        <button type="submit" data-testid="list-search-go" disabled={searching || !listUi.query.trim()}>{searching ? 'Searching…' : 'Search'}</button>
      </form>
      <div aria-live="polite">
        {#if listUi.searchError}<p class="error" data-testid="list-search-error">{listUi.searchError}</p>{/if}
        {#if !searching && listUi.searchedFor && listUi.results.length === 0 && !listUi.searchError}<p class="muted" data-testid="list-search-empty">No cards match “{listUi.searchedFor}”.</p>{/if}
      </div>
      {#if listUi.results.length}
        <ul class="results">
          {#each listUi.results as c (c.id)}
            <li data-testid="list-search-result" data-sid={c.id}>
              <span class="name">{c.name}</span>
              <span class="muted">{c.mana_cost ?? ''} {c.type_line}</span>
              {#if inBuild[c.id]}<span class="muted owned" title="Copies in the pool and deck">×{inBuild[c.id]}</span>{/if}
              <span class="add">
                <button type="button" class="small" data-testid="list-search-add-deck" aria-label={`Add ${c.name} to the deck`} onclick={() => addFound(c, true)}>+ Deck</button>
                <button type="button" class="small" data-testid="list-search-add-pool" aria-label={`Add ${c.name} to the pool`} onclick={() => addFound(c, false)}>+ Pool</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if decks}
    <Library {decks} {build} {origin} card={lookup} onOpen={change} />
  {/if}
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .list-view {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    padding: 12px 16px 24px;
    background: var(--sp-bg, #fff);
    color: var(--sp-fg, #111);
    font: var(--sp-font-size-small, 13px) / 1.45 var(--sp-font, system-ui);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    margin-bottom: 10px;
  }
  input,
  select,
  button {
    font: inherit;
    color: inherit;
  }
  input,
  select {
    padding: 4px 6px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    background: var(--sp-surface, #fff);
    min-height: 32px;
    box-sizing: border-box;
  }
  .text {
    flex: 1 1 200px;
    min-width: 0;
  }
  .colours {
    display: inline-flex;
    gap: 2px;
  }
  .pip {
    min-width: 32px;
    min-height: 32px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    background: var(--sp-surface, #fff);
    cursor: pointer;
    font-weight: 600;
  }
  .pip[aria-pressed='true'] {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
    border-color: var(--sp-fg, #111);
  }
  .sort {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .link {
    border: 0;
    background: none;
    text-decoration: underline;
    cursor: pointer;
    padding: 4px;
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
  }
  @media (max-width: 560px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .column {
    min-width: 0;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 8px 10px;
    background: var(--sp-surface, #fff);
  }
  .column header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin-bottom: 4px;
  }
  h2 {
    margin: 0;
    font-size: 1.1em;
  }
  h3 {
    margin: 8px 0 2px;
    font-size: inherit;
    font-variant: small-caps;
    letter-spacing: 0.05em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }
  /* A row whose card data is still loading keeps full-contrast text (Paper meets WCAG AA throughout, M5 review): its
     name is set in italics with a dotted underline instead of being dimmed. */
  .row.loading .name {
    font-style: italic;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    align-items: baseline;
    text-align: left;
    border: 0;
    background: none;
    padding: 4px;
    min-height: 32px;
    cursor: pointer;
    border-radius: var(--sp-radius-sm, 2px);
  }
  .main:hover,
  .main:focus-visible,
  .small:hover,
  .small:focus-visible {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
  .main:hover .muted,
  .main:focus-visible .muted {
    color: inherit;
  }
  .n {
    min-width: 1.6em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cost {
    white-space: nowrap;
  }
  .foil {
    margin-left: 0.35em;
  }
  .small {
    border: 1px solid var(--sp-border, #d8d8d8);
    background: var(--sp-surface, #fff);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 2px 8px;
    min-height: 32px;
    min-width: 32px;
    cursor: pointer;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .hint {
    color: var(--sp-muted, #5f5f5f);
    font-style: italic;
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
  .empty {
    margin: 8px 0;
  }
  .search {
    margin-top: 16px;
    border-top: 1px solid var(--sp-border, #d8d8d8);
    padding-top: 10px;
  }
  .search form {
    display: flex;
    gap: 6px;
    margin: 6px 0;
  }
  .search form input {
    flex: 1;
    min-width: 0;
  }
  .search form button {
    border: 1px solid var(--sp-fg, #111);
    background: var(--sp-surface, #fff);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 4px 12px;
    cursor: pointer;
  }
  .results li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    padding: 2px 0;
    border-bottom: 1px solid var(--sp-border, #eee);
  }
  .results .name {
    flex: 0 1 auto;
  }
  .results .add {
    margin-left: auto;
    display: inline-flex;
    gap: 4px;
  }
  .error {
    color: var(--sp-danger, #a00);
  }
</style>
