<!--
  Timeline filters and chat tabs of the log panel (DESIGN "Chat and voice", Text chat: a collapsible panel with table,
  team and spectator tabs; chat and action-log lines share one timeline, filterable to chat only or actions only).
  The tab row shows only when there is more than one tab. PLAN M1-P6.
-->
<script lang="ts">
  import { TIMELINE_FILTERS, type ChatTab, type TimelineFilter } from '../../core/log';

  let {
    filter = $bindable('all'),
    tab = $bindable('table'),
    tabs = ['table'],
  }: {
    filter?: TimelineFilter;
    tab?: ChatTab;
    tabs?: ChatTab[];
  } = $props();

  const FILTER_LABEL: Record<TimelineFilter, string> = { all: 'All', chat: 'Chat', actions: 'Actions' };
  const TAB_LABEL: Record<ChatTab, string> = { table: 'Table', team: 'Team', spectator: 'Spectators' };
</script>

<div class="bar">
  {#if tabs.length > 1}
    <div class="tabs" role="tablist" aria-label="Chat tabs">
      {#each tabs as t (t)}
        <button type="button" role="tab" aria-selected={tab === t} data-testid="chat-tab-{t}" onclick={() => (tab = t)}>{TAB_LABEL[t]}</button>
      {/each}
    </div>
  {/if}
  <div class="filters" role="group" aria-label="Show">
    {#each TIMELINE_FILTERS as f (f)}
      <button type="button" aria-pressed={filter === f} data-testid="log-filter-{f}" onclick={() => (filter = f)}>{FILTER_LABEL[f]}</button>
    {/each}
  </div>
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: center;
  }
  .tabs,
  .filters {
    display: inline-flex;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    overflow: hidden;
  }
  button {
    font: inherit;
    background: none;
    border: 0;
    padding: 0 6px;
    color: var(--sp-muted, #5f5f5f);
    cursor: pointer;
  }
  button + button {
    border-left: 1px solid var(--sp-border, #d8d8d8);
  }
  button[aria-pressed='true'],
  button[aria-selected='true'] {
    background: var(--sp-fg, #111);
    color: var(--sp-surface, #fff);
  }
  button:focus-visible {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: -2px;
  }
</style>
