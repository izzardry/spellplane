<!--
  The card back choice (DESIGN "Card data and images", Card back: Spellplane's own neutral back by default; the official
  back is an opt-in setting loaded from backs.scryfall.io, never bundled; ui/settings/back.ts).
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardBackChoice } from '../../store/types';
  import EmptyState from '../empty/EmptyState.svelte';
  import type { CardBackSetting, CardBackState } from './back';

  let { cardBack }: { cardBack: CardBackSetting } = $props();

  let st = $state.raw<CardBackState>(untrack(() => cardBack.state()));
  onMount(() => {
    const off = cardBack.subscribe((s) => (st = s));
    st = cardBack.state();
    return off;
  });

  const pick = (c: CardBackChoice): void => void cardBack.set(c);
</script>

<fieldset class="back" data-testid="card-back-settings" data-choice={st.choice} data-status={st.status}>
  <legend>Card back</legend>
  <label>
    <input type="radio" name="sp-card-back" value="spellplane" data-testid="card-back-spellplane" checked={st.choice === 'spellplane'} onchange={() => pick('spellplane')} />
    Spellplane's neutral back <small>(default)</small>
  </label>
  <label>
    <input type="radio" name="sp-card-back" value="official" data-testid="card-back-official" checked={st.choice === 'official'} onchange={() => pick('official')} />
    The official Magic back <small>— loaded from backs.scryfall.io when chosen; it carries Wizards of the Coast's trademarks</small>
  </label>
  {#if st.status === 'loading'}<p class="status" role="status" data-testid="card-back-loading">Loading the official back…</p>{/if}
  {#if st.status === 'official'}<p class="status" data-testid="card-back-loaded">Other players' hidden cards show the official back on this browser only.</p>{/if}
  {#if st.status === 'failed'}
    <EmptyState id="failedImage" text={st.error ?? undefined} action={{ label: 'Try again', run: () => void cardBack.retry(), testid: 'card-back-retry' }} compact />
  {/if}
</fieldset>

<style>
  fieldset {
    margin: 0;
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: var(--sp-radius-sm, 4px);
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  legend {
    padding: 0 4px;
  }
  label {
    display: flex;
    gap: 6px;
    align-items: baseline;
    cursor: pointer;
  }
  small {
    color: var(--sp-muted, #5f5f5f);
  }
  .status {
    margin: 0;
    color: var(--sp-muted, #5f5f5f);
  }
</style>
