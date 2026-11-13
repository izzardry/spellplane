<!--
  The storage section (DESIGN "Card data and images", Caching: caches are rebuildable, persistent storage is requested
  but never depended on; ui/settings/storage.ts). Shows what this browser keeps for Spellplane and warns when it is
  nearly or completely full.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { StorageStatus } from '../../store/quota';
  import EmptyState from '../empty/EmptyState.svelte';
  import { formatBytes, storageLevel, storageSummary } from './storage';

  let { status, full = false }: { status: () => Promise<StorageStatus>; full?: boolean } = $props();

  let st = $state.raw<StorageStatus | null>(null);
  let read = $state(false);
  let busy = $state(false);

  async function refresh(): Promise<void> {
    busy = true;
    try {
      st = await status();
    } catch {
      st = null;
    } finally {
      busy = false;
      read = true;
    }
  }
  onMount(() => void refresh());

  const level = $derived(full ? 'full' : storageLevel(st));
</script>

<div class="storage" data-testid="storage-settings" data-level={level}>
  {#if !read}
    <p class="muted">Reading storage use…</p>
  {:else}
    <p data-testid="storage-summary">{storageSummary(st)}</p>
    {#if st && st.usage !== null && st.quota}
      <meter min="0" max={st.quota} value={st.usage} high={st.quota * 0.9} aria-label="Storage used: {formatBytes(st.usage)} of {formatBytes(st.quota)}"></meter>
    {/if}
  {/if}
  {#if level === 'full'}
    <EmptyState id="storageFull" compact />
  {:else if level === 'nearlyFull'}
    <p class="warn" data-testid="storage-nearly-full">Storage is nearly full. Card images are evicted first; saved tables and decks are kept.</p>
  {/if}
  <p class="muted">Card data and images are caches and download again when needed. Saved tables, decks and your identity live only in this browser.</p>
  <button type="button" data-testid="storage-refresh" disabled={busy} onclick={() => void refresh()}>Check again</button>
</div>

<style>
  .storage {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  p {
    margin: 0;
  }
  meter {
    width: 100%;
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
  .warn {
    color: var(--sp-danger, #b3261e);
  }
  button {
    font: inherit;
    cursor: pointer;
  }
</style>
