<!--
  The claim page of a re-invite link on a browser without the game (journey.md 4.11; persistence.md section 7;
  contracts.md Part G "Rejoin" item 6), and every refusal screen. Implementer: M8-P5.

  - Waiting: `Looking for the table…` (the browser never starts a table of its own).
  - Ready: `Sit down as Ben?` with the name editable, the warning line above the buttons, and one row at the right:
    `WATCH INSTEAD` (ghost, where watching is possible) and `SIT DOWN AS BEN`, the card's one filled button, last
    (journey.md 4.11; visual.md A2; gate M8 finding N8). `Not now` (to Home) is the card's round close button.
  - Refused: the screen's title and text (`This link was already used. Ask for a new one.`, `This link has expired.`,
    `Ben is still connected from another browser.`, the seat taken over from another browser, the link for another
    seat) with `WATCH` where watching is possible and `HOME`.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Button from '../design/Button.svelte';
  import Field from '../design/Field.svelte';
  import IconButton from '../design/IconButton.svelte';
  import { CLAIM_WARNING, type ClaimRefusalScreen } from './model';

  let {
    phase,
    seatName = '',
    refusal = null,
    onsit,
    onnotnow,
    onwatch,
    onopenmine,
  }: {
    phase: 'looking' | 'ready' | 'sitting' | 'refused';
    seatName?: string;
    refusal?: ClaimRefusalScreen | null;
    onsit: (name: string) => void;
    onnotnow: () => void;
    onwatch?: () => void;
    onopenmine?: () => void;
  } = $props();

  // The seat's name seeds the field once (it may arrive after mount); a field the player cleared stays empty.
  let name = $state(untrack(() => seatName));
  let seeded = untrack(() => seatName !== '');
  $effect(() => {
    if (seeded || !seatName) return;
    seeded = true;
    untrack(() => (name = seatName));
  });
  const shown = $derived((seatName || 'this player').toUpperCase());
</script>

<section class="claim" aria-labelledby="claim-title" data-testid="claim-page" data-phase={phase}>
  {#if phase === 'looking'}
    <p class="title" id="claim-title">Looking for the table…</p>
    <p class="text">This page waits until a player at the table answers. It never starts a table of its own.</p>
    <div class="actions">
      <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="claim-notnow" onclick={() => onnotnow()}>NOT NOW</button>
    </div>
  {:else if phase === 'refused' && refusal}
    <p class="title" id="claim-title" data-testid="claim-refusal-title">{refusal.title}</p>
    <p class="text" data-testid="claim-refusal" data-kind={refusal.kind}>{refusal.text}</p>
    <div class="actions">
      {#if refusal.openMine}
        <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="claim-open-mine" onclick={() => onopenmine?.()}>OPEN MY SEAT</button>
      {:else if onwatch}
        <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="claim-watch" onclick={() => onwatch?.()}>WATCH</button>
      {/if}
      <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="claim-home" onclick={() => onnotnow()}>HOME</button>
    </div>
  {:else}
    <div class="head">
      <p class="title" id="claim-title">Sit down as {seatName || 'this player'}?</p>
      <IconButton size="sm" variant="quiet" icon="close" label="Not now" title="Not now: back to Home" data-testid="claim-notnow" onclick={() => onnotnow()} />
    </div>
    <div class="field">
      <span class="label" aria-hidden="true">Your name at the table</span>
      <Field label="Your name at the table" data-testid="claim-name" maxlength="64" bind:value={name} />
    </div>
    <p class="text" data-testid="claim-warning">{CLAIM_WARNING}</p>
    <div class="actions end">
      {#if onwatch}<Button variant="ghost" data-testid="claim-watch" onclick={() => onwatch?.()}>WATCH INSTEAD</Button>{/if}
      <Button variant="primary" data-testid="claim-sit" disabled={phase === 'sitting'} onclick={() => onsit(name.trim() || seatName)}>SIT DOWN AS {shown}</Button>
    </div>
  {/if}
</section>

<style>
  .claim {
    box-sizing: border-box;
    width: min(480px, calc(100% - 32px));
    margin: var(--ds-space-xl) auto;
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-md);
    padding: var(--ds-space-xl);
    border-radius: var(--ds-radius-sheet);
    background: var(--ds-panel);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-pop);
  }
  .title {
    margin: 0;
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-title);
    font-weight: var(--ds-heading-weight);
  }
  .text {
    margin: 0;
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-body);
    color: var(--ds-muted);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-xs);
  }
  .label {
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-label);
    letter-spacing: var(--ds-label-spacing);
    text-transform: var(--ds-label-case);
    color: var(--ds-muted);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--ds-space-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-sm);
  }
  /* The primary last, at the right (visual.md A2); a long name wraps the row as a whole, never the label. */
  .actions.end {
    justify-content: flex-end;
  }
</style>
