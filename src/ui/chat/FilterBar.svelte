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
        <button class="ds-btn ds-btn--quiet sp-h-xs" type="button" role="tab" aria-selected={tab === t} data-testid="chat-tab-{t}" onclick={() => (tab = t)}>{TAB_LABEL[t]}</button>
      {/each}
    </div>
  {/if}
  <div class="filters" role="group" aria-label="Show">
    {#each TIMELINE_FILTERS as f (f)}
      <button class="ds-btn ds-btn--quiet sp-h-xs" type="button" aria-pressed={filter === f} data-testid="log-filter-{f}" onclick={() => (filter = f)}>{FILTER_LABEL[f]}</button>
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
    gap: 2px;
    padding: 2px;
    background: var(--ds-chip);
    border-radius: var(--ds-radius-pill);
  }
  button {
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 0 var(--ds-space-md);
    border-radius: var(--ds-radius-pill);
    color: var(--ds-ink);
    font-weight: var(--ds-weight-medium);
  }
  button[aria-pressed='true'],
  button[aria-selected='true'] {
    background: var(--ds-on);
    color: var(--ds-on-ink);
  }
</style>
