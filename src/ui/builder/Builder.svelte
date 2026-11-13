<!--
  The builder (DESIGN "Pre-game: draft, sealed and deck building", Deck building): two views of the same pool,
  switchable at any time. The builder table (default) is the pool on a private table with the play gestures, sorted by
  one key into solitaire columns (1 colour, 2 mana value, 3 type; the same key again restores the layout before it), a
  deck area and a sideboard area, and the basic-land dispenser with a printing per basic. The list view (M2-P6,
  ui/builder/list/) is the compact two-column list. Both read and write the one shared DeckBuild through
  DraftControls.build/setBuild, so switching keeps everything. Beside both: the live readout (card count, mana curve,
  colour split, land count, the 40-card hint) and Ready, which commits the deck through DraftControls.ready() (the
  M1 ready path: deckImportOf, then TableSession.importDeck) and locks the builder. Keys: 1/2/3 sort, 0 fits the table, Escape clears the selection or closes the inspect view, hold
  Space over a card to inspect it; keys never fire in a text field. Implementer: M2-P5.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { canonicalJson } from '../../core/hash';
  import type { CardRef, DeckBuild, SetCode, TableState } from '../../core/types';
  import type { CardData, SetDataSource } from '../../data/types';
  import { mtg } from '../../games/index';
  import { builderHandleOf, dispense, reconcile, type BuilderSurfaceOptionsExt } from '../../scene/builder';
  import type { BuilderSort, BuilderSurface } from '../../scene/types';
  import type { DeckRecord } from '../../store/types';
  import { cssText, hudCssVars } from '../../themes/index';
  import Inspect from '../Inspect.svelte';
  import type { BuilderProps, BuilderViewKind } from '../types';
  import ListView from './list/ListView.svelte';
  import { BASIC_NAMES, basicPrintings, deckImportOf, dispensedCount, emptyPrintings, isLocked, originOf, returnBasic, type BasicName, type BasicPrintings } from './model';
  import { builderStats } from './stats';
  import Stats from './stats.svelte';

  let {
    session,
    draft,
    createSurface,
    faces,
    cardData,
    theme,
    decks,
    origin,
    sets,
    view: initialView = 'table',
  }: BuilderProps & {
    /** Where the pool came from, for the deck library; derived from the draft when absent. */
    origin?: DeckRecord['origin'] | undefined;
    /** Set data, for the dispenser's printings of the pool's sets. */
    sets?: SetDataSource | undefined;
    view?: BuilderViewKind;
  } = $props();

  const me = untrack(() => session.seat);
  const cssVars = $derived(cssText(hudCssVars(theme.tokens)));
  const back = $derived(theme.cardDressing.back ?? mtg.cardBack);
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = motionQuery?.matches ?? false;

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let build = $state.raw<DeckBuild | null>(untrack(() => draft.build()));
  let viewKind = $state<BuilderViewKind>(untrack(() => initialView));
  let sortKey = $state<BuilderSort>('colour');
  let sortShowing = $state<BuilderSort | null>(null);
  let selected = $state(0);
  /** Bumped when card data arrives, so the readout and the dispenser re-read it. */
  let dataTick = $state(0);
  let note = $state('');
  let readying = $state(false);
  let inspectRef = $state.raw<CardRef | null>(null);
  let inspectBySpace = false;
  let spaceHeld = false;
  /** Panel width and the narrow layout's breakpoint, as in the style block. */
  const PANEL_PX = 284;
  const NARROW_PX = 720;
  let vw = $state(1280);
  let vh = $state(800);
  let host: HTMLDivElement | undefined = $state();
  let surface: BuilderSurface | null = null;
  let surfaceError = $state('');

  const locked = $derived(isLocked(st, me));
  const lookup = (ref: CardRef): CardData | null => cardData.peek(ref.sid);
  const stats = $derived.by(() => {
    void dataTick;
    return build ? builderStats(build, lookup) : null;
  });
  const listOrigin = $derived(origin ?? originOf(st));
  const poolSets = $derived<SetCode[]>(st.draft?.sets ?? listOrigin?.sets ?? []);
  const search = $derived(cardData.searchCards ? (q: string) => cardData.searchCards!(q) : undefined);

  let printings = $state.raw<BasicPrintings>(emptyPrintings());
  let chosen = $state<Record<BasicName, string>>({ Plains: '', Island: '', Swamp: '', Mountain: '', Forest: '' });
  const counts = $derived.by(() => {
    void dataTick;
    const b = build;
    return Object.fromEntries(BASIC_NAMES.map((n) => [n, b ? dispensedCount(b, n, lookup) : 0])) as Record<BasicName, number>;
  });

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(text: string): void {
    note = text;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      note = '';
    }, 3000);
  }

  function push(): void {
    if (!surface || !build) return;
    const handle = builderHandleOf(surface);
    if (handle) handle.update({ build, reducedMotion, locked });
    else surface.update({ build, reducedMotion });
  }

  /** Write a changed build through the shared DraftControls, so both views and a reload see it. */
  function change(next: DeckBuild): void {
    if (locked) {
      flash('The deck is locked: you are Ready.');
      push();
      return;
    }
    build = next;
    draft.setBuild(next);
    push();
  }

  /** Scryfall ids already asked for (a plain record: nothing renders from it). */
  const fetched: Record<string, true> = {};
  function prefetch(): void {
    if (!build) return;
    const missing = [...new Set(build.cards.map((c) => c.ref.sid))].filter((s) => !fetched[s] && !cardData.peek(s));
    if (!missing.length) return;
    for (const s of missing) fetched[s] = true;
    void cardData
      .getMany(missing)
      .then(() => {
        dataTick++;
        push();
      })
      .catch(() => {});
  }

  let printingsFor = '';
  function loadPrintings(): void {
    if (!build) return;
    const key = canonicalJson({ sets: poolSets, sids: [...new Set(build.cards.filter((c) => !c.basic).map((c) => c.ref.sid))].sort() });
    if (key === printingsFor) return;
    printingsFor = key;
    void basicPrintings({ build, sets: poolSets, cardData, setData: sets })
      .then((p) => {
        if (printingsFor !== key) return;
        printings = p;
        const next = { ...chosen };
        for (const n of BASIC_NAMES) if (!p[n].some((x) => x.ref.sid === next[n])) next[n] = p[n][0]?.ref.sid ?? '';
        chosen = next;
        dataTick++;
      })
      .catch(() => {});
  }

  function sort(key: BuilderSort): void {
    if (locked) return flash('The deck is locked: you are Ready.');
    // The surface owns the column key (a restore brings back the key from before the undone sort) and reports it
    // through `sorted`; it sorts while hidden too, so both views keep the same key.
    if (surface) surface.sort(key);
    else sortKey = key;
  }

  function addBasic(name: BasicName): void {
    if (locked) return flash('The deck is locked: you are Ready.');
    const sid = chosen[name];
    if (!sid || !build) return flash(`No printing of ${name} is known yet.`);
    const ref: CardRef = { sid };
    if (surface) surface.dispenseBasic(ref);
    else change(dispense(build, reconcile(build, lookup, sortKey), ref, lookup, sortKey));
  }

  function removeBasic(name: BasicName): void {
    if (!build) return;
    const next = returnBasic(build, name, lookup);
    if (next === build) return flash(`No ${name} from the dispenser is in the deck.`);
    change(next);
  }

  async function ready(): Promise<void> {
    if (!build || locked || readying) return;
    const deck = deckImportOf(build);
    if (!deck.main.length) return flash('Put some cards in the deck first.');
    readying = true;
    try {
      // The contract's Ready path (draft/types.ts DraftControls.ready): it commits deckImportOf(build) of the build
      // written through setBuild, so the stage bookkeeping around Ready stays in one place.
      await draft.ready();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      readying = false;
    }
  }

  function showView(kind: BuilderViewKind): void {
    viewKind = kind;
    inspectRef = null;
    if (kind === 'table') {
      // The surface kept its state while hidden; give it the build the list may have changed.
      queueMicrotask(() => {
        push();
        surface?.camera.fit(false);
      });
    }
  }

  // A changed theme prop reaches the surface.
  let appliedTheme: typeof theme | null = null;
  $effect(() => {
    const t = theme;
    if (surface && appliedTheme && t !== appliedTheme) {
      appliedTheme = t;
      surface.setTheme(t);
    }
  });

  const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  function onkeydowncapture(e: KeyboardEvent): void {
    if (e.code === 'Space' && !typing(e.target)) spaceHeld = true;
  }
  function onkeydown(e: KeyboardEvent): void {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (inspectRef) inspectRef = null;
      else builderHandleOf(surface)?.clearSelection();
      return;
    }
    if (viewKind !== 'table') return;
    const keys: Record<string, BuilderSort> = { '1': 'colour', '2': 'manaValue', '3': 'type' };
    const key = keys[e.key];
    if (key) {
      e.preventDefault();
      sort(key);
    } else if (e.key === '0') surface?.camera.fit();
  }
  function onkeyup(e: KeyboardEvent): void {
    if (e.code === 'Space') spaceHeld = false;
    if (e.code === 'Space' && inspectBySpace) {
      inspectBySpace = false;
      inspectRef = null;
    }
  }

  onMount(() => {
    const unsubState = session.subscribe((s) => {
      const wasLocked = locked;
      st = s;
      if (isLocked(s, me) !== wasLocked) push();
    });
    const unsubDraft = draft.subscribe(() => {
      const b = draft.build();
      if (!b) return;
      if (build && canonicalJson(b) === canonicalJson(build)) return;
      build = b;
      prefetch();
      loadPrintings();
      push();
    });
    try {
      const options: BuilderSurfaceOptionsExt = {
        theme,
        faces,
        card: lookup,
        reducedMotion,
        events: {
          change: (next) => change(next),
          inspect: (ref) => {
            inspectRef = ref;
            inspectBySpace = spaceHeld;
          },
          sorted: (key, columns) => {
            sortShowing = key;
            sortKey = columns;
          },
          selection: (n) => (selected = n),
        },
      };
      surface = createSurface(host!, options);
      appliedTheme = theme;
      push();
    } catch (e) {
      surfaceError = e instanceof Error ? e.message : String(e);
      if (viewKind === 'table') viewKind = 'list';
    }
    prefetch();
    loadPrintings();
    const onMotion = (e: MediaQueryListEvent): void => {
      reducedMotion = e.matches;
      push();
    };
    motionQuery?.addEventListener('change', onMotion);
    return () => {
      unsubState();
      unsubDraft();
      motionQuery?.removeEventListener('change', onMotion);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = null;
      surface?.dispose();
      surface = null;
    };
  });

  /** What the bar and the panel cover of the table (top right bottom left, px): the panel sits right, or at the bottom (40%) below 720 px. */
  const fitInsets = $derived(vw <= NARROW_PX ? `56 0 ${Math.round(vh * 0.4)} 0` : `56 ${PANEL_PX} 0 0`);

  const SORTS: { key: BuilderSort; label: string; hotkey: string }[] = [
    { key: 'colour', label: 'Colour', hotkey: '1' },
    { key: 'manaValue', label: 'Mana value', hotkey: '2' },
    { key: 'type', label: 'Type', hotkey: '3' },
  ];
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} {onkeydowncapture} {onkeydown} {onkeyup} />

<div class="root" style={cssVars} data-testid="builder" data-view={viewKind} data-locked={locked ? 'true' : 'false'}>
  <div class="surface" class:hidden={viewKind !== 'table'} data-testid="builder-surface" data-fit-insets={fitInsets} bind:this={host}></div>
  {#if viewKind === 'list' && build}
    <div class="list" data-testid="builder-list-host">
      <ListView {build} onChange={change} card={lookup} sort={sortKey} {search} {decks} origin={listOrigin} />
    </div>
  {/if}

  <header class="bar" data-testid="builder-bar">
    <span class="title">Deck building</span>
    <div class="switch" role="group" aria-label="View">
      <button type="button" data-testid="view-table" aria-pressed={viewKind === 'table'} disabled={!!surfaceError} onclick={() => showView('table')}>Table</button>
      <button type="button" data-testid="view-list" aria-pressed={viewKind === 'list'} onclick={() => showView('list')}>List</button>
    </div>
    {#if viewKind === 'table'}
      <div class="sorts" role="group" aria-label="Sort into columns">
        <span class="label">Sort</span>
        {#each SORTS as s (s.key)}
          <button
            type="button"
            data-testid="sort-{s.key}"
            aria-pressed={sortShowing === s.key}
            disabled={locked}
            title="{s.label} ({s.hotkey}); press again to restore the layout before the sort"
            onclick={() => sort(s.key)}>{s.label} <kbd>{s.hotkey}</kbd></button
          >
        {/each}
      </div>
      {#if selected > 1}<span class="sel" data-testid="builder-selected">{selected} selected</span>{/if}
    {/if}
    <span class="spacer"></span>
    {#if note}<span class="note" role="status" data-testid="builder-note">{note}</span>{/if}
    {#if locked}
      <span class="locked" data-testid="builder-locked">Ready · deck locked</span>
    {:else}
      <button type="button" class="primary" data-testid="builder-ready" disabled={!build || readying || !stats || stats.cards === 0} onclick={() => void ready()} title="Lock the deck and publish its commitment">
        {readying ? 'Locking…' : 'Ready'}
      </button>
    {/if}
  </header>

  <aside class="panel" data-testid="builder-panel">
    {#if stats}<Stats {stats} />{/if}
    <section class="dispenser" data-testid="dispenser" aria-label="Basic lands">
      <h3>Basic lands <span class="sub">unlimited</span></h3>
      {#each BASIC_NAMES as name (name)}
        <div class="basic" data-testid="dispenser-row" data-basic={name}>
          <span class="bname">{name}</span>
          <span class="count" data-testid="dispenser-count">{counts[name]}</span>
          <button type="button" class="pm" data-testid="dispenser-remove" aria-label="Return a {name} to the dispenser" disabled={locked || counts[name] === 0} onclick={() => removeBasic(name)}>−</button>
          <button type="button" class="pm" data-testid="dispenser-add" aria-label="Add a {name} to the deck" disabled={locked || !chosen[name]} onclick={() => addBasic(name)}>+</button>
          <select data-testid="dispenser-printing" aria-label="{name} printing" bind:value={chosen[name]} disabled={printings[name].length < 2}>
            {#if printings[name].length === 0}<option value="">Loading…</option>{/if}
            {#each printings[name] as p (p.ref.sid)}
              <option value={p.ref.sid}>{p.label}</option>
            {/each}
          </select>
        </div>
      {/each}
    </section>
    {#if surfaceError}<p class="error" role="status">Builder table unavailable: {surfaceError}</p>{/if}
    {#if !build}<p class="empty" data-testid="builder-empty">No pool yet.</p>{/if}
    <p class="help">
      Drag cards between the deck and the sideboard; double-click sends a card across. Shift+click or Shift+drag selects; Ctrl while dragging turns snapping off.
    </p>
  </aside>

  {#if inspectRef}
    <Inspect {faces} cardRef={inspectRef} data={cardData.peek(inspectRef.sid)} {back} {vw} {vh} onclose={() => (inspectRef = null)} />
  {/if}
</div>

<style>
  .root {
    position: fixed;
    inset: 0;
    font-family: var(--sp-font);
    font-size: var(--sp-font-size, 14px);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  .surface {
    position: absolute;
    inset: 0;
  }
  .surface.hidden {
    display: none;
  }
  .list {
    position: absolute;
    top: 52px;
    left: 0;
    right: 284px;
    bottom: 0;
    overflow: auto;
  }
  .bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
    min-height: 48px;
    padding: 6px 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    background: color-mix(in srgb, var(--sp-bg) 92%, transparent);
    border-bottom: 1px solid var(--sp-border);
  }
  .title {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .switch,
  .sorts {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .label,
  .sub,
  .help {
    color: var(--sp-muted);
  }
  .spacer {
    flex: 1;
  }
  .note {
    color: var(--sp-warning);
  }
  .sel {
    font-size: var(--sp-font-size-small, 12px);
  }
  .locked {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  kbd {
    font-family: var(--sp-font-mono);
    font-size: 10px;
    color: var(--sp-muted);
  }
  .panel {
    position: absolute;
    top: 49px;
    right: 0;
    bottom: 0;
    width: 284px;
    box-sizing: border-box;
    padding: 12px 16px;
    overflow: auto;
    display: grid;
    align-content: start;
    gap: 14px;
    background: color-mix(in srgb, var(--sp-bg) 94%, transparent);
    border-left: 1px solid var(--sp-border);
  }
  h3 {
    margin: 0 0 4px;
    font-size: var(--sp-font-size-small, 12px);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .dispenser {
    display: grid;
    gap: 4px;
    font-size: var(--sp-font-size-small, 12px);
  }
  .basic {
    display: grid;
    grid-template-columns: 1fr 22px 24px 24px 86px;
    align-items: center;
    gap: 4px;
  }
  .count {
    text-align: right;
    font-family: var(--sp-font-mono);
  }
  .pm {
    padding: 0;
    height: 22px;
  }
  select {
    font: inherit;
    min-width: 0;
    color: var(--sp-fg);
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-sm, 4px);
  }
  .help,
  .empty,
  .error {
    margin: 0;
    font-size: var(--sp-font-size-small, 12px);
  }
  .error {
    color: var(--sp-danger);
  }
  button {
    font: inherit;
    padding: 4px 10px;
    border-radius: var(--sp-radius-sm, 4px);
    border: 1px solid var(--sp-border);
    background: var(--sp-bg);
    color: var(--sp-fg);
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: var(--sp-fg);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  button.primary {
    border-color: var(--sp-fg);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  @media (max-width: 720px) {
    .panel {
      top: auto;
      left: 0;
      width: auto;
      height: 40%;
      border-left: none;
      border-top: 1px solid var(--sp-border);
    }
    .list {
      right: 0;
      bottom: 40%;
    }
  }
</style>
