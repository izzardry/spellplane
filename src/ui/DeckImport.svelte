<!--
  Deck import (DESIGN "Pre-game: draft, sealed and deck building", Constructed decks: paste a decklist in plain, MTGA or
  MTGO format; cards resolve through card data; "Specification: card data, packs and draft formats": unresolved lines
  are shown with near matches and never block the rest). Not modal: the table stays live under it.
-->
<script lang="ts">
  import type { CardDataSource } from '../data/types';
  import type { DeckImport } from '../session/types';
  import { checkDeck, errorName, replaceName, type CheckedDeck, type ParseDecklist } from './deck';

  let { cardData, parse, onimport, onclose }: { cardData: CardDataSource; parse: ParseDecklist; onimport: (deck: DeckImport) => Promise<void>; onclose: () => void } = $props();

  const PLACEHOLDER = ['4 Llanowar Elves', '20 Forest', '', 'Sideboard', '2 Naturalize'].join('\n');
  let text = $state('');
  let checked = $state<CheckedDeck | null>(null);
  let busy = $state(false);
  let failure = $state('');
  let area = $state<HTMLTextAreaElement | undefined>();
  let checkedText = $state('');

  $effect(() => {
    area?.focus();
  });

  async function check() {
    busy = true;
    failure = '';
    try {
      checkedText = text;
      checked = await checkDeck(text, parse, cardData);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      checked = null;
    } finally {
      busy = false;
    }
  }
  async function doImport() {
    if (!checked || checkedText !== text) await check();
    if (!checked || checked.resolved.main.length === 0) return;
    busy = true;
    try {
      await onimport({ main: checked.resolved.main, side: checked.resolved.side });
      onclose();
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function useMatch(line: number, oldName: string, name: string) {
    text = replaceName(text, line, oldName, name);
    void check();
  }
</script>

<section class="dialog" data-testid="deck-import" aria-label="Import a deck">
  <header>
    <h2>Import a deck</h2>
    <button type="button" class="close" onclick={onclose} aria-label="Close">×</button>
  </header>
  <textarea
    bind:this={area}
    bind:value={text}
    data-testid="deck-text"
    rows="12"
    spellcheck="false"
    placeholder={PLACEHOLDER}
    aria-label="Decklist"
    onkeydown={(e) => {
      if (e.key === 'Escape') onclose();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void doImport();
    }}
  ></textarea>
  <div class="row">
    <button type="button" data-testid="deck-check" disabled={busy || !text.trim()} onclick={check}>Check</button>
    <button type="button" class="primary" data-testid="deck-import-go" disabled={busy || !checked || checked.resolved.main.length === 0 || checkedText !== text} onclick={doImport}>Import</button>
    {#if busy}<span class="muted">Working…</span>{/if}
  </div>
  {#if failure}<p class="error">{failure}</p>{/if}
  {#if checked}
    <p data-testid="deck-summary">
      {checked.resolved.main.length} cards in the deck{#if checked.resolved.side.length}, {checked.resolved.side.length} in the sideboard{/if}.
      {#if checked.errors.length}{checked.errors.length} line{checked.errors.length === 1 ? '' : 's'} not imported:{/if}
    </p>
    {#if checked.errors.length}
      <ul class="errors">
        {#each checked.errors as err (err.line + err.text)}
          <li data-testid="deck-error" data-line={err.line}>
            <span class="line">Line {err.line}</span>
            <code>{err.text.trim()}</code>
            <span class="muted">{err.message}</span>
            {#if err.nearMatches.length}
              <span class="near">Did you mean
                {#each err.nearMatches as m (m)}
                  <button type="button" data-testid="near-match" onclick={() => useMatch(err.line, errorName(err), m)}>{m}</button>
                {/each}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .dialog {
    position: fixed;
    z-index: 65;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 92vw);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 12px 16px;
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--sp-font-size-large, 18px);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font-mono, monospace);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  button {
    font: inherit;
    background: none;
    color: inherit;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 2px 10px;
    cursor: pointer;
  }
  button.primary {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
    border-color: var(--sp-fg, #111);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .close {
    border: 0;
    font-size: 16px;
  }
  .errors {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .errors li {
    padding: 4px 0;
    border-top: 1px solid var(--sp-border, #d8d8d8);
  }
  .line {
    font-weight: var(--sp-font-weight-bold, 600);
    margin-right: 6px;
  }
  code {
    font-family: var(--sp-font-mono, monospace);
    margin-right: 6px;
  }
  .near {
    display: block;
  }
  .near button {
    margin-left: 4px;
    padding: 0 6px;
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
  .error {
    color: var(--sp-danger, #b3261e);
  }
</style>
