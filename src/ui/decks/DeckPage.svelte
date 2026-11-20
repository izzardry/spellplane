<!--
  D5, the deck page (decks.md section 3 "D5 Deck page"; visual.md board 3). Custom deck: a search in Scryfall syntax
  (350 ms after the last key, from two characters), colour and type chips compiling to query terms, quick chips, a grid
  of whole card images with count badges (a click adds one to the open board, Shift adds up to four), and the rail: the
  curve with the recipe outline, the colour bar, the land helper (+N LANDS as one undo step), the copy warning that
  never blocks, the list with steppers, MAIN and SIDE, and the save state. Booster deck: the pool instead of the
  search (local chips), the basics dispenser, SUGGEST A DECK, CONVERT TO CUSTOM DECK; no search field. Every change
  goes through data/deck/edit.ts in a DeckEditor (undo and redo of the last 50, autosave 400 ms). Implementer: M8-P3.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { CardRef } from '../../core/types';
  import { analyse, BASIC_LAND_NAMES, BASIC_OF_COLOUR, COLOURS, curveText, isLandCard, manaCosts, type BasicLandName, type ManaSymbol } from '../../data/deck/analyse';
  import { add, countSid, remove, rename, setMain, setSize, type Board, type EditResult } from '../../data/deck/edit';
  import { suggestedBasics, suggestedLands, recipeFor } from '../../data/deck/lands';
  import { compileQuery, matchesQuery, QUICK_CHIPS, quickQuery, type QuickChip, type TypeChip } from '../../data/deck/query';
  import { convertToCustom, isOpening } from '../../data/deck/seal';
  import { isSimpleDeck } from '../../data/deck/simple';
  import { BAND_LABELS, bandNumber } from '../../data/deck/strength';
  import { sizeOf, summarise } from '../../data/deck/summary';
  import type { CardData } from '../../data/types';
  import type { DeckRecord, DeckSize } from '../../store/types';
  import Button from '../design/Button.svelte';
  import Chip from '../design/Chip.svelte';
  import ColourBar from '../design/ColourBar.svelte';
  import CurveChart from '../design/CurveChart.svelte';
  import Dialog from '../design/Dialog.svelte';
  import Field from '../design/Field.svelte';
  import IconButton from '../design/IconButton.svelte';
  import Pip from '../design/Pip.svelte';
  import Segmented from '../design/Segmented.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import StrengthPips from '../design/StrengthPips.svelte';
  import { toasts } from '../design/toasts';
  import { attachDecksDebug } from './debug';
  import type { DecksEnv } from './env';
  import { cardLabel } from './env';
  import CardImage from './parts/CardImage.svelte';
  import { DeckEditor } from './state/editor';
  import { groupsOf, overCopies, rowsOf } from './state/rows';
  import { takeFresh } from './state/library';
  import { basicRefs, suggestFor, suggestionText, takeSuggest } from './state/open';

  let { env, id }: { env: DecksEnv; id: string } = $props();

  const SEARCH_MS = 350;
  const TYPE_OPTIONS: { value: TypeChip; label: string }[] = [
    { value: 'creature', label: 'Creature' },
    { value: 'instant', label: 'Instant' },
    { value: 'sorcery', label: 'Sorcery' },
    { value: 'enchantment', label: 'Enchantment' },
    { value: 'artifact', label: 'Artifact' },
    { value: 'land', label: 'Land' },
  ];

  let status = $state<'loading' | 'gone' | 'ready'>('loading');
  let deck = $state.raw<DeckRecord | null>(null);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let saved = $state(true);
  let cardsVersion = $state(0);
  let editor: DeckEditor | null = null;
  let basics = $state.raw<Partial<Record<BasicLandName, CardRef>>>({});
  let board = $state<'main' | 'side'>('main');
  let announce = $state('');
  let nameDraft = $state('');
  let converting = $state(false);
  let offline = $state(untrack(() => env.offline()));

  // Search (custom decks).
  let text = $state('');
  let colours = $state<ManaSymbol[]>([]);
  let types = $state<TypeChip[]>([]);
  let sort = $state<'edhrec' | 'cmc' | 'name'>('edhrec');
  let quick = $state<QuickChip | null>(null);
  let results = $state.raw<CardData[]>([]);
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let searched = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let searchSeq = 0;

  const lookup = (r: CardRef): CardData | null => env.cardData.peek(r.sid);
  const sealed = $derived(deck?.kind === 'sealed');
  const size = $derived(deck ? sizeOf(deck) : 60);
  const analysis = $derived.by(() => {
    void cardsVersion;
    return deck ? analyse(deck.main, lookup) : null;
  });
  const summary = $derived.by(() => {
    void cardsVersion;
    return deck ? summarise(deck, lookup) : null;
  });
  const suggested = $derived(analysis ? suggestedLands(analysis, size) : 0);
  const landGap = $derived(analysis ? suggested - analysis.lands : 0);
  const simple = $derived(analysis ? isSimpleDeck(analysis, size) : false);
  const strength = $derived(summary?.strength ?? null);
  const curve = $derived(analysis ? { cr: analysis.curveCreatures, sp: analysis.curveOthers } : { cr: [], sp: [] });
  const curveTotals = $derived(curve.cr.map((n, i) => n + (curve.sp[i] ?? 0)));
  const copies = $derived.by(() => {
    void cardsVersion;
    return deck && !sealed ? overCopies(deck.main, lookup, size) : null;
  });

  const listGroups = $derived.by(() => {
    void cardsVersion;
    if (!deck) return [];
    return groupsOf(board === 'side' ? deck.side : deck.main, lookup);
  });

  // The pool (booster decks): the cards not in the deck, filtered locally by the chips.
  const poolRows = $derived.by(() => {
    void cardsVersion;
    if (!deck || !sealed) return [];
    const q = compileQuery({ colours, types });
    return rowsOf(deck.side, lookup).filter((r) => !q || (r.card ? matchesQuery(r.card, q) : false));
  });

  // ---- loading -------------------------------------------------------------------------------------------------
  async function load(): Promise<void> {
    const d = await env.decks.get(id).catch(() => null);
    if (!d) {
      status = 'gone';
      return;
    }
    if (isOpening(d)) {
      env.go(`#/decks/${encodeURIComponent(d.id)}/open`);
      return;
    }
    const sids = [...new Set([...d.main, ...d.side, ...(d.seal?.pool ?? [])].map((r) => r.sid))];
    await env.cardData.getMany(sids).catch(() => ({}));
    basics = await basicRefs(env.cardData, d.seal?.sets[0]);
    editor?.dispose();
    editor = new DeckEditor(d, {
      store: env.decks,
      lookup,
      now: env.now,
      onchange: (x) => {
        deck = x;
        canUndo = editor?.canUndo ?? false;
        canRedo = editor?.canRedo ?? false;
        saved = !(editor?.isDirty ?? false);
      },
      onsaveerror: () => toasts.info("Could not save: this browser's storage is full."),
      onsaved: () => (saved = true),
    });
    deck = d;
    nameDraft = d.name;
    cardsVersion++;
    status = 'ready';
    if (d.kind === 'sealed' && takeSuggest(d.id)) await suggest();
  }

  function apply(...steps: ((d: DeckRecord) => EditResult)[]): EditResult | null {
    if (!editor) return null;
    const r = editor.apply(...steps);
    if (!r.ok) {
      const why = r.reason === 'notInPool' ? 'Only cards from its boosters, plus basic lands.' : r.reason === 'sealed' ? 'A booster deck is sealed.' : r.reason === 'absent' ? 'That card is not in the deck.' : 'The boosters are still being opened.';
      toasts.info(why);
    }
    return r;
  }

  function addCard(card: CardData, n = 1, to: Board = board): void {
    const ref: CardRef = { sid: card.id };
    const r = apply(...Array.from({ length: n }, () => (d: DeckRecord) => add(d, ref, to, 1, card)));
    if (r?.ok) say(`${card.name} added, ${countSid(to === 'side' ? r.deck.side : r.deck.main, card.id)} in deck, ${r.deck.main.length} of ${size} cards.`);
  }
  function removeCard(sid: string, from: Board = board): void {
    const card = env.cardData.peek(sid);
    const r = apply((d) => remove(d, { sid }, from, 1));
    if (r?.ok) say(`${card?.name ?? 'Card'} removed, ${countSid(from === 'side' ? r.deck.side : r.deck.main, sid)} in deck, ${r.deck.main.length} of ${size} cards.`);
  }
  function addSid(sid: string, from: Board = board): void {
    const card = env.cardData.peek(sid);
    if (card) addCard(card, 1, from);
  }
  function addBasic(name: BasicLandName): void {
    const ref = basics[name];
    if (!ref) return;
    addSid(ref.sid, 'main');
  }
  function addSuggestedLands(): void {
    if (!analysis) return;
    const split = suggestedBasics(analysis, size);
    const refs: CardRef[] = [];
    for (const c of COLOURS) {
      const ref = basics[BASIC_OF_COLOUR[c]];
      for (let i = 0; i < (split[c] ?? 0); i++) if (ref) refs.push(ref);
    }
    if (refs.length === 0) return;
    const r = apply(...refs.map((ref) => (d: DeckRecord) => add(d, ref, 'main', 1, lookup(ref))));
    if (r?.ok) say(`${refs.length} lands added.`);
  }
  async function suggest(): Promise<void> {
    if (!deck) return;
    const s = await suggestFor(deck, env.cardData);
    if (!s) return;
    cardsVersion++;
    const r = apply((d) => setMain(d, s.main, lookup));
    if (r?.ok) toasts.undo(suggestionText(s), () => undo());
  }
  function undo(): void {
    editor?.undo();
  }
  function redo(): void {
    editor?.redo();
  }
  function commitName(): void {
    const n = nameDraft.trim();
    if (!deck || !n || n === deck.name) return;
    apply((d) => rename(d, n));
  }
  function changeSize(v: string): void {
    const s = Number(v) as DeckSize;
    if (deck && s !== size) apply((d) => setSize(d, s));
  }
  async function done(): Promise<void> {
    commitName();
    await editor?.flush();
    env.go('#/decks');
  }
  async function convert(): Promise<void> {
    if (!deck) return;
    await editor?.flush();
    const copy = convertToCustom(deck, env.newId(), env.now());
    copy.summary = summarise(copy, lookup);
    await env.decks.put(copy);
    converting = false;
    env.go(`#/decks/${encodeURIComponent(copy.id)}`);
  }
  function say(t: string): void {
    announce = t;
  }

  // ---- search ----------------------------------------------------------------------------------------------------
  const query = $derived(quick ? quickQuery(quick, deck ? (summary?.colours ?? []) : []) : compileQuery({ text, colours, types }));
  const canSearch = $derived(!!quick || text.trim().length >= 2 || colours.length > 0 || types.length > 0);
  $effect(() => {
    const q = query;
    const go = canSearch && !sealed && !offline;
    const order = sort;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!go) {
      results = [];
      searched = false;
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void runSearch(q, order);
    }, SEARCH_MS);
  });
  async function runSearch(q: string, order: 'edhrec' | 'cmc' | 'name'): Promise<void> {
    if (!env.cardData.searchCards) return;
    const seq = ++searchSeq;
    searching = true;
    searchError = null;
    try {
      const found = await env.cardData.searchCards(q, { order });
      if (seq !== searchSeq) return;
      results = found;
      searched = true;
    } catch {
      if (seq !== searchSeq) return;
      results = [];
      searchError = 'Scryfall did not answer. Cards already on this device still work.';
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }
  function toggleColour(c: ManaSymbol): void {
    quick = null;
    colours = colours.includes(c) ? colours.filter((x) => x !== c) : [...colours, c];
  }
  function toggleType(t: TypeChip): void {
    quick = null;
    types = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
  }
  function cardKey(e: KeyboardEvent, card: CardData): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCard(card, 1, e.shiftKey ? 'side' : board);
    }
  }
  function cardClick(e: MouseEvent, card: CardData): void {
    if (!deck) return;
    if (e.shiftKey) addCard(card, Math.max(0, 4 - countSid(deck.main, card.id)) || 1);
    else addCard(card);
  }

  // ---- keys and lifecycle ----------------------------------------------------------------------------------------
  function keys(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  }
  const pagehide = (): void => void editor?.flush();
  let detachDebug: (() => void) | null = null;
  let offOffline: (() => void) | null = null;
  onMount(() => {
    void load();
    window.addEventListener('keydown', keys);
    window.addEventListener('pagehide', pagehide);
    offOffline = env.onOffline((on) => (offline = on));
    detachDebug = attachDecksDebug({
      onchange: (changed) => {
        if (changed === id && editor && !editor.isDirty) void load();
      },
    });
  });
  onDestroy(() => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('keydown', keys);
    window.removeEventListener('pagehide', pagehide);
    offOffline?.();
    detachDebug?.();
    commitName();
    const ed = editor;
    editor = null;
    // A new custom deck left untouched leaves nothing behind (decks.md D2: "a custom deck at its first card or rename").
    if (takeFresh(id) && ed && !ed.canUndo && !ed.isDirty) void env.decks.delete(id);
    else void ed?.dispose();
  });

  const costPips = (card: CardData | null): ManaSymbol[] => {
    if (!card) return [];
    const out: ManaSymbol[] = [];
    for (const m of manaCosts(card).matchAll(/\{([^}]+)\}/g)) {
      const sym = m[1]!;
      for (const part of sym.split('/')) if ((['W', 'U', 'B', 'R', 'G', 'C'] as string[]).includes(part)) out.push(part as ManaSymbol);
    }
    return out;
  };
  const generic = (card: CardData | null): string => {
    const m = card ? /\{(\d+|X)\}/.exec(manaCosts(card)) : null;
    return m ? m[1]! : '';
  };
</script>

<div class="page" data-testid="deck-page" data-kind={deck?.kind ?? ''}>
  {#if status === 'gone'}
    <div class="gone">
      <p class="ds-t-reading" data-testid="deck-gone">This deck is gone.</p>
      <Button onclick={() => env.go('#/decks')}>Back to decks</Button>
    </div>
  {:else if status === 'loading' || !deck}
    <p class="ds-t-meta loading">Loading the deck…</p>
  {:else}
    <header class="top">
      <Button variant="quiet" onclick={() => void done()} data-testid="deck-back" aria-label="Back to decks">← Decks</Button>
      <input
        class="name ds-t-heading"
        aria-label="Deck name"
        data-testid="deck-name"
        maxlength="60"
        bind:value={nameDraft}
        onblur={commitName}
        onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <Chip variant="line" data-testid="deck-kind">{sealed ? `🔒 Booster · ${deck.seal ? `${[...new Set(deck.seal.sets)].join('/')} × ${deck.seal.sets.length}` : ''}` : 'Custom'}</Chip>
      <span class="pips">{#each summary?.colours ?? [] as c (c)}<Pip colour={c} size={20} />{/each}</span>
      {#if simple}<Chip data-testid="simple-chip">Simple deck</Chip>{/if}
      <span class="grow"></span>
      {#if !sealed}
        <Segmented
          label="Deck size"
          value={String(size)}
          onchange={changeSize}
          data-testid="deck-size"
          options={[
            { value: '40', label: '40' },
            { value: '60', label: '60' },
          ]}
        />
      {/if}
      <span class="stat">
        <span class="ds-t-eyebrow">Cards</span>
        <span class="ds-t-list" data-testid="deck-count"><b>{deck.main.length}</b> / {size}</span>
      </span>
      <span class="stat" data-testid="deck-strength" data-score={strength?.score ?? ''}>
        <span class="ds-t-eyebrow">Strength</span>
        <span class="ds-t-list">
          {#if strength}<b>{strength.score}</b> {BAND_LABELS[strength.band]}{:else}—{/if}
          <StrengthPips band={strength ? bandNumber(strength.band) : null} score={strength?.score} />
        </span>
      </span>
      <Button data-testid="deck-undo" disabled={!canUndo} onclick={undo}>Undo</Button>
      <Button data-testid="deck-redo" disabled={!canRedo} onclick={redo}>Redo</Button>
      <Button variant="primary" data-testid="deck-done" onclick={() => void done()}>Done</Button>
    </header>

    {#if sealed}
      <div class="strip">
        <span class="ds-t-reading">Booster deck. Only cards from its boosters, plus basic lands.</span>
        <Button variant="ghost" size="sm" data-testid="convert-open" onclick={() => (converting = true)}>Convert to custom deck</Button>
      </div>
    {/if}

    <div class="body">
      <section class="left" aria-label={sealed ? 'Pool' : 'Card search'}>
        {#if !sealed}
          <div class="row44">
            <span class="search">
              <Field
                label="Search any card"
                placeholder={offline ? 'Card search needs a connection' : 'Search any card: name, type or text'}
                bind:value={text}
                oninput={() => (quick = null)}
                disabled={offline || undefined}
                data-testid="card-search"
              />
            </span>
            <Segmented
              label="Sort"
              value={sort}
              onchange={(v) => (sort = v as typeof sort)}
              data-testid="search-sort"
              options={[
                { value: 'edhrec', label: 'Popular' },
                { value: 'cmc', label: 'Mana value' },
                { value: 'name', label: 'Name' },
              ]}
            />
          </div>
        {:else}
          <div class="row44 poolhead">
            <span class="ds-t-eyebrow" data-testid="pool-head">Pool · {deck.seal?.pool.length ?? 0} cards · {deck.side.length} not in deck</span>
            <span class="grow"></span>
            <Button data-testid="suggest" onclick={() => void suggest()}>Suggest a deck</Button>
          </div>
        {/if}
        <div class="row36" role="group" aria-label="Filters">
          {#each ['W', 'U', 'B', 'R', 'G', 'C'] as const as c (c)}
            <IconButton size="sm" label="Colour {c}" pressed={colours.includes(c)} onclick={() => toggleColour(c)} data-testid="chip-colour-{c}"><Pip colour={c} size={18} /></IconButton>
          {/each}
          <span class="divider" aria-hidden="true"></span>
          {#each TYPE_OPTIONS as t (t.value)}
            <Chip size="sm" variant={types.includes(t.value) ? 'on' : 'line'} pressed={types.includes(t.value)} onclick={() => toggleType(t.value)} data-testid="chip-type-{t.value}">{t.label}</Chip>
          {/each}
          <span class="grow"></span>
          <span class="ds-t-meta" data-testid="result-count">{sealed ? `${poolRows.reduce((s, r) => s + r.n, 0)} cards` : searched ? `${results.length} cards` : ''}</span>
        </div>
        {#if sealed}
          <div class="row36" role="group" aria-label="Basic lands">
            {#each BASIC_LAND_NAMES as b (b)}
              <Button size="sm" disabled={!basics[b]} onclick={() => addBasic(b)} data-testid="basic-{b}">{b} + <span class="ds-t-meta">{basics[b] ? countSid(deck.main, basics[b]!.sid) : 0}</span></Button>
            {/each}
          </div>
          <div class="grid" role="listbox" aria-label="Pool: click a card to put it in the deck" data-testid="pool-grid">
            {#each poolRows as r (r.sid)}
              <div class="cell" role="option" aria-selected="false" tabindex="0" aria-label={cardLabel(r.card)} data-testid="pool-card" data-sid={r.sid}
                onclick={() => addSid(r.sid, 'main')} onkeydown={(e) => e.key === 'Enter' && addSid(r.sid, 'main')}>
                <CardImage faces={env.faces} cardRef={{ sid: r.sid }} alt={r.card?.name ?? 'Card'} />
                {#if r.n > 1}<span class="count">×{r.n}</span>{/if}
              </div>
            {/each}
          </div>
        {:else}
          {#if !text.trim() && colours.length === 0 && types.length === 0}
            <div class="row36" role="group" aria-label="Quick searches">
              {#each Object.entries(QUICK_CHIPS) as [k, q] (k)}
                <Chip size="sm" variant={quick === k ? 'on' : 'line'} pressed={quick === k} onclick={() => (quick = quick === k ? null : (k as QuickChip))} data-testid="quick-{k}">{q.label}</Chip>
              {/each}
            </div>
          {/if}
          {#if offline}
            <StatusLine tone="danger" data-testid="search-offline">Card search needs a connection</StatusLine>
          {:else if searchError}
            <StatusLine tone="danger">{searchError}</StatusLine>
          {:else if searching}
            <StatusLine>Searching…</StatusLine>
          {:else if searched && results.length === 0}
            <StatusLine data-testid="no-results">No cards match. Check the spelling or remove a filter.</StatusLine>
          {:else if !searched}
            <StatusLine>Search any card, or start from a chip.</StatusLine>
          {/if}
          <div class="grid" role="listbox" aria-label="Search results: click a card to add it" data-testid="result-grid">
            {#each results as card (card.id)}
              {@const n = countSid(deck.main, card.id) + countSid(deck.side, card.id)}
              <div class="cell" role="option" aria-selected={n > 0} tabindex="0" aria-label={cardLabel(card, n)} data-testid="result-card" data-sid={card.id} data-name={card.name}
                onclick={(e) => cardClick(e, card)} onkeydown={(e) => cardKey(e, card)}>
                <CardImage faces={env.faces} cardRef={{ sid: card.id }} alt={card.name} />
                {#if n > 0}<span class="count" data-testid="result-count-badge">×{n}</span>{/if}
              </div>
            {/each}
          </div>
          {#if results.length >= 175}<p class="ds-t-meta">Showing the first 175. Narrow the search for more.</p>{/if}
        {/if}
      </section>

      <aside class="ds-sheet rail" aria-label="Deck">
        <div class="between">
          <span class="ds-t-eyebrow">Mana curve</span>
          <span class="ds-t-meta">average {analysis ? analysis.avgMv.toFixed(1) : '0.0'}</span>
        </div>
        <CurveChart creatures={curve.cr} others={curve.sp} target={[...recipeFor(size).targets]} label={curveText(curveTotals)} data-testid="curve" />
        <span class="ds-sr-only" data-testid="curve-text">{curveText(curveTotals)}</span>
        {#if analysis && COLOURS.some((c) => analysis.symbols[c] > 0)}
          <ColourBar symbols={analysis.symbols} sources={analysis.sources} />
        {/if}
        {#if analysis}
          <div class="well lands" data-testid="land-helper">
            <span class="grow"><b>{analysis.lands} lands</b> <span class="ds-t-meta">· {suggested} suggested</span></span>
            {#if landGap > 1}
              <Button size="xs" data-testid="add-lands" onclick={addSuggestedLands}>+{landGap} lands</Button>
            {/if}
          </div>
          {#if Math.abs(landGap) > 1 && analysis.cards > 0}
            <StatusLine tone="danger" data-testid="land-note">{analysis.lands} lands. {suggested} fit this curve.</StatusLine>
          {/if}
        {/if}
        {#if copies}
          <StatusLine tone="danger" data-testid="copy-warning">{copies.n} copies of {copies.name}. The ranked queue allows {copies.limit === 1 ? 'one' : 'four'}.</StatusLine>
        {/if}
        <div class="list" data-testid="deck-list">
          {#each listGroups as g (g.title)}
            <div class="ghead"><span class="ds-t-eyebrow">{g.title}</span><span class="ds-t-eyebrow">{g.n}</span></div>
            {#each g.rows as r (r.sid)}
              <div class="drow" data-testid="deck-row" data-sid={r.sid} data-name={r.card?.name ?? ''}>
                <IconButton size="xs" label="Remove one {r.card?.name ?? 'card'}" onclick={() => removeCard(r.sid)} data-testid="row-minus" disabled={sealed && board === 'side'}>−</IconButton>
                <b class="q" data-testid="row-count" class:warn={copies && r.card?.name === copies.name}>{r.n}</b>
                <IconButton size="xs" label="Add one {r.card?.name ?? 'card'}" onclick={() => addSid(r.sid, sealed ? 'main' : board)} data-testid="row-plus" disabled={sealed && !(r.card && isLandCard(r.card) && /\bBasic\b/.test(r.card.type_line)) && !deck.side.some((x) => x.sid === r.sid)}>+</IconButton>
                <span class="nm" title={r.card?.name ?? r.sid}>{r.card?.name ?? `Unknown card ${r.sid.slice(0, 8)}`}</span>
                <span class="cost">{generic(r.card)}{#each costPips(r.card) as p, i (i)}<Pip colour={p} size={14} />{/each}</span>
              </div>
            {/each}
          {/each}
          {#if listGroups.length === 0}
            <p class="ds-t-meta empty">{sealed ? 'Click a pool card to put it in the deck.' : `A simple ${size}-card deck: ${recipeFor(size).lands} lands, ${size - recipeFor(size).lands} spells, most of them costing 1 to 3.`}</p>
          {/if}
        </div>
        <div class="between">
          <Segmented
            size="sm"
            label="Board"
            value={board}
            onchange={(v) => (board = v as 'main' | 'side')}
            data-testid="board"
            options={[
              { value: 'main', label: `Main ${deck.main.length}${sealed ? '/40' : ''}` },
              { value: 'side', label: `Side ${deck.side.length}` },
            ]}
          />
          <StatusLine tone={saved ? 'success' : 'muted'} data-testid="save-state">{saved ? 'saved' : 'saving'}</StatusLine>
        </div>
      </aside>
    </div>
    <div class="ds-sr-only" aria-live="polite" data-testid="deck-live">{announce}</div>
  {/if}

  {#if converting && deck}
    <Dialog open={true} label="Make a custom copy?" testid="convert-dialog" onclose={() => (converting = false)}>
      <p class="ds-t-reading">The copy can take any card. It is no longer a booster deck and plays as a custom deck. "{deck.name}" stays as it is.</p>
      {#snippet footer()}
        <Button variant="quiet" onclick={() => (converting = false)}>not now</Button>
        <Button variant="primary" data-testid="convert-go" onclick={() => void convert()}>Make a copy</Button>
      {/snippet}
    </Dialog>
  {/if}
</div>

<style>
  .page {
    box-sizing: border-box;
    min-height: 100vh;
    padding: var(--ds-space-xl) var(--ds-space-xxl);
    background: var(--ds-panel);
    color: var(--ds-ink);
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-lg);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    min-height: 44px;
    flex-wrap: wrap;
  }
  .name {
    box-sizing: border-box;
    height: 36px;
    min-width: 120px;
    max-width: 360px;
    border: 0;
    border-bottom: 2px solid var(--ds-line);
    background: transparent;
    color: var(--ds-ink);
    font: inherit;
    font-size: var(--ds-type-heading);
    padding: 0 4px;
  }
  .name:focus-visible {
    border-bottom-color: var(--ds-ink);
    outline: none;
  }
  .pips {
    display: inline-flex;
    gap: 4px;
  }
  .grow {
    flex: 1;
  }
  .stat {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .stat .ds-t-list {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-xs);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    padding: var(--ds-space-sm) var(--ds-space-md);
    border-radius: var(--ds-radius-card);
    background: var(--ds-chip);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 384px;
    gap: var(--ds-space-xl);
    align-items: start;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-md);
    min-width: 0;
  }
  .row44,
  .row36 {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    flex-wrap: wrap;
  }
  .search {
    flex: 1;
    min-width: 200px;
  }
  .search :global(.ds-field) {
    width: 100%;
  }
  .divider {
    width: 1px;
    height: 24px;
    background: var(--ds-line);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
    gap: var(--ds-space-lg) var(--ds-space-md);
  }
  .cell {
    position: relative;
    cursor: pointer;
    border-radius: var(--ds-radius-sm);
    content-visibility: auto;
    contain-intrinsic-size: 146px 204px;
    transition: transform var(--ds-duration-fast) var(--ds-ease-standard);
  }
  .cell:hover {
    transform: translateY(-2px);
  }
  .cell:focus-visible {
    outline: 3px solid var(--ds-focus);
    outline-offset: 2px;
  }
  .count {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ds-radius-pill);
    background: var(--ds-badge);
    color: var(--ds-badge-ink);
    box-shadow: 0 0 0 2px var(--ds-panel);
    font-weight: var(--ds-weight-bold);
    font-size: var(--ds-type-small);
  }
  .rail {
    position: sticky;
    top: var(--ds-space-lg);
    gap: var(--ds-space-md);
    padding: var(--ds-space-lg);
    max-height: calc(100vh - 2 * var(--ds-space-lg));
  }
  .between {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-sm);
  }
  .well {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-md);
    border-radius: var(--ds-radius-card);
    background: var(--ds-chip);
    box-shadow: var(--ds-elevation-well);
    min-height: 36px;
    box-sizing: border-box;
  }
  .list {
    flex: 1;
    min-height: 80px;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .ghead {
    display: flex;
    justify-content: space-between;
    padding: 6px 8px 2px;
  }
  .drow {
    display: grid;
    grid-template-columns: auto 20px auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 4px;
    border-radius: var(--ds-radius-sm);
  }
  .drow:nth-child(odd) {
    background: var(--ds-chip);
  }
  .q {
    text-align: center;
  }
  .q.warn {
    color: var(--ds-danger);
  }
  .nm {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cost {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--ds-muted);
  }
  .empty,
  .loading,
  .gone {
    padding: var(--ds-space-md);
  }
  @media (max-width: 1100px) {
    .page {
      padding: var(--ds-space-md);
    }
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      position: static;
      max-height: none;
    }
  }
</style>
