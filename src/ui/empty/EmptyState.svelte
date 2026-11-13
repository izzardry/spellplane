<!--
  One empty or error state (PLAN M5-P5; ui/empty/states.ts): a short title, what it means and what to do, an optional
  action and an optional dismiss. Inline and never modal (DESIGN "Input and interaction design", Nothing modal).
-->
<script lang="ts">
  import { EMPTY_STATES, type EmptyStateId } from './states';

  let {
    id,
    text,
    action,
    ondismiss,
    compact = false,
  }: {
    id: EmptyStateId;
    /** Replaces the catalogue's sentence (e.g. a name or a count). */
    text?: string;
    action?: { label: string; run: () => void; testid?: string };
    ondismiss?: () => void;
    compact?: boolean;
  } = $props();

  const s = $derived(EMPTY_STATES[id]);
</script>

<div class="empty" class:alert={s.tone === 'alert'} class:compact data-testid="empty-state" data-state={id} role={s.tone} aria-live={s.tone === 'alert' ? 'assertive' : 'polite'}>
  <strong>{s.title}</strong>
  <span class="text">{text ?? s.text}</span>
  {#if action || ondismiss}
    <span class="actions">
      {#if action}<button type="button" data-testid={action.testid ?? 'empty-state-action'} onclick={action.run}>{action.label}</button>{/if}
      {#if ondismiss}<button type="button" class="x" data-testid="empty-state-dismiss" aria-label="Dismiss {s.title.toLowerCase()}" onclick={ondismiss}>×</button>{/if}
    </span>
  {/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-sizing: border-box;
    max-width: 100%;
    padding: 10px 12px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #8c8c8c);
    border-left: 3px solid var(--sp-muted, #5f5f5f);
    border-radius: var(--sp-radius-sm, 4px);
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  .empty.alert {
    border-left-color: var(--sp-danger, #b3261e);
  }
  .empty.compact {
    padding: 6px 8px;
  }
  strong {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .text {
    color: var(--sp-fg, #111);
  }
  .actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  .x {
    margin-left: auto;
    background: none;
    border: none;
    color: inherit;
    font-size: 16px;
  }
</style>
