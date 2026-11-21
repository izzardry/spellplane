<!--
  D2, the new-deck chooser (journey.md 4.3; decks.md section 3 D2; contracts.md Part G "Decks" items 1 and 2): four
  ways. FROM BOOSTERS (the filled action; `6 × <SET> ✎` opens the booster setup sheet; OPEN saves the sealed pool
  before anything is shown and goes to the opening), CUSTOM DECK (an empty custom deck, its page with the search),
  SIMPLE DECK (one of five colours from the starter generator, saved as a custom deck; disabled with "Not in this build
  yet." while the generator is a stub) and IMPORT A LIST (the existing paste dialog). `path` opens one way directly.
  Implementer: M8-P3.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { SetCode } from '../../core/types';
  import { parseDecklist } from '../../data/decklist';
  import { FALLBACK_CORE_SET, latestCoreSet } from '../../data/sets';
  import { buildStarterDeck, STARTER_AVAILABLE } from '../../data/starter';
  import type { CardData } from '../../data/types';
  import type { BoosterSetup, DeckRecord } from '../../store/types';
  import Button from '../design/Button.svelte';
  import IconButton from '../design/IconButton.svelte';
  import Pip from '../design/Pip.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import { toasts } from '../design/toasts';
  import DeckImport from '../DeckImport.svelte';
  import BoosterSetupSheet from './BoosterSetupSheet.svelte';
  import type { DecksEnv } from './env';
  import { markFresh } from './state/library';
  import { openBoosterDeck } from './state/open';
  import { DEFAULT_PACKS } from './state/quick';

  let { env, path = undefined }: { env: DecksEnv; path?: string | undefined } = $props();

  let setup = $state<BoosterSetup>({ how: 'sealed', packs: DEFAULT_PACKS, picks: 1, sets: [FALLBACK_CORE_SET], pickTimer: false });
  /** The set was chosen by hand (no fallback then: decks.md section 6 "Fallback"). */
  let chosenByHand = false;
  let showSetup = $state(false);
  let importing = $state(false);
  let opening = $state(false);
  let failure = $state<string | null>(null);
  let starterBusy = $state(false);

  /** Set when the chooser is left: a slow set download or save that ends later navigates nowhere. */
  let destroyed = false;
  onDestroy(() => (destroyed = true));

  onMount(() => {
    void env.sets
      .listSets()
      .then((s) => (setup = { ...setup, sets: [latestCoreSet(s)] }))
      .catch(() => undefined);
    if (path === 'boosters') showSetup = true;
    else if (path === 'custom') void custom(true);
    else if (path === 'import') importing = true;
  });

  async function open(v: BoosterSetup = setup): Promise<void> {
    if (opening) return;
    opening = true;
    failure = null;
    const deps = { decks: env.decks, sets: env.sets, cardData: env.cardData, newId: env.newId, now: env.now };
    try {
      let d;
      try {
        d = await openBoosterDeck(deps, v.packs, [...v.sets] as SetCode[]);
      } catch (e) {
        // The default (latest core) set cannot make packs here: fall back to Core Set 2021 and say so (decks.md D9).
        if (chosenByHand || v.sets.every((s) => s === FALLBACK_CORE_SET)) throw e;
        toasts.info(`${v.sets[0]} boosters could not be made here. Using Core Set 2021.`);
        d = await openBoosterDeck(deps, v.packs, [FALLBACK_CORE_SET]);
      }
      showSetup = false;
      if (!destroyed) env.go(`#/decks/${encodeURIComponent(d.id)}/open`);
    } catch (e) {
      failure = e instanceof Error ? e.message : 'The booster data could not be loaded. Check your connection.';
      toasts.info(failure);
    } finally {
      opening = false;
    }
  }

  /** Write a new record; a failed write (storage full) says so and keeps the chooser open. */
  async function save(d: DeckRecord): Promise<boolean> {
    try {
      await env.decks.put(d);
      return true;
    } catch {
      toasts.info("Could not save the deck: this browser's storage is full.");
      return false;
    }
  }
  function record(name: string, main: DeckRecord['main'], side: DeckRecord['side'], source: DeckRecord['source']): DeckRecord {
    const now = env.now();
    return { id: env.newId(), name, main, side, source, createdAt: now, updatedAt: now, kind: 'custom', size: main.length > 0 && main.length <= 45 ? 40 : 60 };
  }
  /** `redirect`: entered through `#/decks/new/custom`, whose entry the new deck's page replaces (Back must not make another). */
  async function custom(redirect = false): Promise<void> {
    const d = record('Untitled deck', [], [], 'built');
    if (!(await save(d))) return;
    markFresh(d.id);
    if (!destroyed) (redirect ? env.replace : env.go)(`#/decks/${encodeURIComponent(d.id)}`);
  }
  async function simple(colour: 'W' | 'U' | 'B' | 'R' | 'G'): Promise<void> {
    if (starterBusy) return;
    starterBusy = true;
    try {
      const set = setup.sets[0] ?? 'M21';
      const seedBytes = new Uint8Array(8);
      crypto.getRandomValues(seedBytes);
      const deck = await buildStarterDeck(
        {
          pool: async (code) => {
            const data = await env.sets.get(code);
            if (!data) return [];
            const ids = [...new Set(Object.values(data.cards).map((c) => c.scryfallId))];
            const found = await env.cardData.getMany(ids);
            return Object.values(found).filter((c): c is CardData => !!c);
          },
        },
        { colour, seed: [...seedBytes].map((b) => b.toString(16).padStart(2, '0')).join(''), set },
      );
      const d = record(deck.name, deck.main, [], 'built');
      if (!(await save(d))) return;
      if (!destroyed) env.go('#/decks');
    } catch {
      toasts.info('The simple deck could not be made.');
    } finally {
      starterBusy = false;
    }
  }
  async function imported(deck: { main: DeckRecord['main']; side: DeckRecord['side'] }): Promise<void> {
    // The dialog's lists are reactive proxies; the store needs plain records.
    const plain = $state.snapshot(deck);
    const d = record('Imported deck', plain.main.map((r) => ({ ...r })), plain.side.map((r) => ({ ...r })), 'pasted');
    if (!(await save(d))) return;
    if (!destroyed) env.go(`#/decks/${encodeURIComponent(d.id)}`);
  }
  const packsLabel = $derived(`${setup.packs} × ${setup.sets[0] ?? ''}`);
</script>

<div class="chooser" data-testid="new-deck-chooser">
  <header class="top">
    <Button variant="quiet" onclick={() => env.go('#/decks')} aria-label="Back to decks">← Decks</Button>
    <h1 class="ds-t-title">New deck</h1>
  </header>
  <div class="ways">
    <section class="way" aria-label="From boosters" data-testid="way-boosters">
      <span class="ds-t-eyebrow">From boosters</span>
      <p class="ds-t-reading">Open {setup.packs} packs and get a 40-card deck made from them. The pool is sealed.</p>
      <Button variant="ghost" size="sm" data-testid="open-setup" onclick={() => (showSetup = true)}>{packsLabel} ✎</Button>
      <span class="grow"></span>
      <Button variant="primary" data-testid="open-boosters" waiting={opening} disabled={opening} onclick={() => void open()}>{opening ? 'Opening…' : 'Open boosters'}</Button>
    </section>
    <section class="way" aria-label="Custom deck" data-testid="way-custom">
      <span class="ds-t-eyebrow">Custom deck</span>
      <p class="ds-t-reading">Look up any card and build what you like.</p>
      <span class="grow"></span>
      <Button data-testid="new-custom" onclick={() => void custom()}>Build</Button>
    </section>
    <section class="way" aria-label="Simple deck" data-testid="way-simple">
      <span class="ds-t-eyebrow">Simple deck</span>
      <p class="ds-t-reading">One colour, a clear curve, ready to play.</p>
      <span class="grow"></span>
      <div class="colours" role="group" aria-label="Colour">
        {#each ['W', 'U', 'B', 'R', 'G'] as const as c (c)}
          <IconButton size="sm" label="Simple deck in {c}" disabled={!STARTER_AVAILABLE || starterBusy} onclick={() => void simple(c)} data-testid="simple-{c}"><Pip colour={c} size={18} /></IconButton>
        {/each}
      </div>
      {#if !STARTER_AVAILABLE}<StatusLine data-testid="simple-unavailable">Not in this build yet.</StatusLine>{/if}
    </section>
    <section class="way" aria-label="Import a list" data-testid="way-import">
      <span class="ds-t-eyebrow">Import a list</span>
      <p class="ds-t-reading">Paste a deck list in plain, MTGA or MTGO form.</p>
      <span class="grow"></span>
      <Button data-testid="new-import" onclick={() => (importing = true)}>Import</Button>
    </section>
  </div>
  {#if failure}<StatusLine tone="danger" data-testid="open-failure">{failure}</StatusLine>{/if}

  {#if showSetup}
    <BoosterSetupSheet value={setup} mode="deck" sets={env.sets} busy={opening} {failure} onchange={(v) => {
        if (v.sets[0] !== setup.sets[0]) chosenByHand = true;
        setup = v;
      }} onclose={() => (showSetup = false)} onopen={(v) => void open(v)} />
  {/if}
  {#if importing}
    <div class="ds-scrim import" data-ds-layer="dialog">
      <DeckImport cardData={env.cardData} parse={parseDecklist} onimport={imported} onclose={() => (importing = false)} />
    </div>
  {/if}
</div>

<style>
  .chooser {
    box-sizing: border-box;
    min-height: 100vh;
    padding: var(--ds-space-xl) var(--ds-space-xxl);
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-xl);
    color: var(--ds-ink);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    min-height: 44px;
  }
  .ways {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--ds-space-xl);
    max-width: 1100px;
  }
  .way {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--ds-space-md);
    min-height: 260px;
    padding: var(--ds-space-xl);
    border-radius: var(--ds-radius-panel);
    background: var(--ds-panel-raised);
    box-shadow: var(--ds-elevation-sheet);
  }
  .grow {
    flex: 1;
  }
  .colours {
    display: flex;
    gap: var(--ds-space-xs);
  }
  .import {
    display: grid;
    place-items: center;
  }
  @media (max-width: 600px) {
    .chooser {
      padding: var(--ds-space-md);
    }
  }
</style>
