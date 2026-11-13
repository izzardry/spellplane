<!--
  The accessible mirror of keyboard card focus (DESIGN "Input and interaction design", Accessibility: "every card action
  is reachable from the keyboard by cycling focus through cards in a zone"; PLAN M5-P4: spoken names via an accessible
  mirror). The table itself is a canvas; this element stands in for it: one Tab stop (role "application", so a screen
  reader passes the arrow and card keys through to the page), described by the focused card and listing the focused
  zone's cards with the focused one marked. Sighted keyboard users see a chip naming the focus; the scene draws the
  ring around the card (ViewState.focused). The HUD moves the focus (ui/a11y/index.ts moveFocus) and speaks it through
  the live region; this element only shows it.
-->
<script lang="ts">
  let {
    text,
    zone,
    cards,
    el = $bindable(),
    onfocusin,
  }: {
    /** The focus as spoken (describeFocus), or null without focus. */
    text: string | null;
    /** The focused zone's name, or null. */
    zone: string | null;
    /** The focused zone's cards as spoken, the focused one marked. */
    cards: { id: string; text: string; current: boolean }[];
    el?: HTMLElement;
    /** The element got DOM focus (Tab): the HUD puts card focus on the table if it has none. */
    onfocusin: () => void;
  } = $props();

  const HINT = 'Arrow keys move between cards (left, right) and zones (up, down); Page Up and Page Down go to the first and last card. The card keys act on the focused card; Escape leaves.';
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (role "application" is the table's one Tab stop: it takes the arrow and card keys) -->
<div
  bind:this={el}
  class="mirror"
  class:active={text !== null}
  role="application"
  tabindex="0"
  aria-roledescription="card table"
  aria-label="Table"
  aria-describedby="sp-a11y-focus"
  data-testid="a11y-mirror"
  data-focus-text={text ?? ''}
  onfocus={onfocusin}
>
  <span class="chip" aria-hidden="true" data-testid="a11y-focus-chip">{text ?? 'Table: arrow keys move between cards'}</span>
  <span class="sr-only" id="sp-a11y-focus">{text ?? HINT}</span>
  {#if zone !== null && cards.length > 0}
    <ol class="sr-only" aria-label={zone} data-testid="a11y-mirror-cards">
      {#each cards as c (c.id)}
        <li data-focus-card={c.id} aria-current={c.current ? 'true' : undefined}>{c.text}</li>
      {/each}
    </ol>
  {/if}
</div>

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
  /* Out of sight until it has focus or names a card: the table is the visible surface. */
  .mirror {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .mirror.active,
  .mirror:focus {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
    white-space: normal;
  }
  .mirror:focus {
    outline: none;
  }
  .chip {
    display: inline-block;
    max-width: min(560px, 80vw);
    padding: 2px 10px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 2px solid var(--sp-focus, #1f6fd1);
    border-radius: var(--sp-radius-md, 4px);
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
  }
  .mirror:focus-visible .chip {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: 2px;
  }
</style>
