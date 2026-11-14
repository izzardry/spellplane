<!--
  Storage and backup (PLAN M5-P3: a storage estimate shown in settings, the storage-persistence prompt; PLAN Milestone 5,
  owner decisions, Installable on iPad: requests persistent storage, lets decks and saved tables be exported to a file
  and imported again). Shows how much this origin stores and how much it may, how many card images are cached (the
  least recently used make room, store/quota.ts), whether the browser keeps the data for good, and exports or restores
  a backup file (store/backup.ts).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { backupFileName, backupText, exportBackup, readBackupText, restoreBackup, suggestReplaceIdentity } from '../../store/backup';
  import { requestPersistentStorage } from '../../store/persist';
  import { formatBytes, storageStatus, type StorageStatus } from '../../store/quota';
  import type { LocalStores } from '../../store/stores';
  import type { BackupImport } from '../../store/types';
  import { PERSIST_HINT } from './hints';

  let { stores, now = () => Date.now(), reload = () => location.reload() }: { stores: LocalStores; now?: () => number; reload?: () => void } = $props();

  let status = $state<StorageStatus | null>(null);
  let persistMessage = $state('');
  let busy = $state(false);
  let exportMessage = $state('');
  let importing = $state<{ name: string; data: BackupImport } | null>(null);
  let replaceIdentity = $state(false);
  let overwrite = $state(false);
  let result = $state<{ summary: string; errors: string[]; reloadNeeded: boolean } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function refresh(): Promise<void> {
    status = await storageStatus();
  }
  onMount(() => {
    void refresh();
  });

  const persistSupported = typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function';

  async function keep(): Promise<void> {
    const granted = await requestPersistentStorage();
    persistMessage = granted ? PERSIST_HINT.granted : PERSIST_HINT.refused;
    await refresh();
  }

  async function doExport(): Promise<void> {
    busy = true;
    exportMessage = '';
    try {
      const at = now();
      const file = await exportBackup(stores, { decks: true, tables: 'all', settings: true }, at);
      const blob = new Blob([backupText(file)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName(at);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      exportMessage = `Exported ${count(file.decks.length, 'deck')} and ${count(file.tables.length, 'saved table')}.`;
    } catch (e) {
      exportMessage = `The backup could not be made: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }

  async function chosen(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    result = null;
    if (!file) return;
    const data = readBackupText(await file.text());
    importing = { name: file.name, data };
    replaceIdentity = await suggestReplaceIdentity(stores, data);
    overwrite = false;
  }

  async function restore(): Promise<void> {
    if (!importing) return;
    busy = true;
    try {
      const { data } = importing;
      const before = (await stores.db.get('identity', 'me'))?.peerId ?? null;
      const { errors } = await restoreBackup(stores, data, { replaceIdentity, overwrite });
      const after = (await stores.db.get('identity', 'me'))?.peerId ?? null;
      const skipped = new Set(errors.map((x) => x.where));
      const decks = data.decks.filter((d) => !skipped.has(`deck ${d.id}`)).length;
      const tables = data.tables.filter((t) => !skipped.has(`table ${t.table.roomId}`)).length;
      result = {
        summary: `Restored ${count(decks, 'deck')} and ${count(tables, 'saved table')}.`,
        errors: [...data.errors, ...errors].map((x) => x.message),
        // The identity and the solo table are read when the page starts.
        reloadNeeded: before !== after || tables > 0,
      };
      importing = null;
      await refresh();
    } catch (e) {
      result = { summary: `The backup could not be restored: ${e instanceof Error ? e.message : String(e)}`, errors: [], reloadNeeded: false };
    } finally {
      busy = false;
    }
  }

  function count(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  const usageText = $derived.by(() => {
    if (!status) return 'Checking how much is stored…';
    if (status.usage === null) return 'This browser does not say how much Spellplane stores.';
    return status.quota === null ? `Spellplane stores ${formatBytes(status.usage)} in this browser.` : `Spellplane stores ${formatBytes(status.usage)} of about ${formatBytes(status.quota)} this browser allows it.`;
  });
</script>

<section class="block storage" data-testid="storage-panel" aria-labelledby="storage-title">
  <h2 id="storage-title">Storage and backup</h2>
  <p data-testid="storage-estimate">{usageText}</p>
  {#if status && status.imageEntries !== null}
    <p class="help" data-testid="storage-images">
      Card images cached: {status.imageEntries}. When the cache is full, the images unused the longest make room for new ones.
    </p>
  {/if}
  <p data-testid="storage-persisted" data-persisted={status?.persisted ? 'true' : 'false'}>
    {#if status?.persisted}
      The browser keeps Spellplane’s data for good.
    {:else}
      The browser may clear Spellplane’s data when space runs low.
    {/if}
  </p>
  {#if status && !status.persisted && persistSupported}
    <button type="button" data-testid="storage-persist" onclick={() => void keep()}>Keep data on this device</button>
  {/if}
  {#if persistMessage}<p class="help" role="status" data-testid="storage-persist-result">{persistMessage}</p>{/if}

  <h3>Backup</h3>
  <p class="help">Save your decks, saved tables (with your hidden cards and your key to return to your chair) and settings to a file you keep. Import it here or in another browser. The file stays with you: Spellplane never sends it anywhere.</p>
  <div class="row">
    <button type="button" data-testid="backup-export" disabled={busy} onclick={() => void doExport()}>Export a backup</button>
    <button type="button" data-testid="backup-import" disabled={busy} onclick={() => fileInput?.click()}>Import a backup</button>
    <input bind:this={fileInput} class="file" type="file" accept=".json,application/json" data-testid="backup-file" aria-label="Backup file" onchange={(e) => void chosen(e)} />
  </div>
  {#if exportMessage}<p class="help" role="status" data-testid="backup-export-result">{exportMessage}</p>{/if}

  {#if importing}
    {@const d = importing.data}
    <div class="restore" data-testid="backup-preview">
      <p>
        <strong>{importing.name}</strong> holds {count(d.decks.length, 'deck')} and {count(d.tables.length, 'saved table')}{#if d.identity}, played as {d.identity.nickname || 'a player without a nickname'}{/if}{#if Object.keys(d.settings).length}, and settings{/if}.
      </p>
      {#if d.errors.length}
        <ul class="errors" data-testid="backup-read-errors">
          {#each d.errors as err, i (i)}<li>{err.message}</li>{/each}
        </ul>
      {/if}
      {#if d.decks.length || d.tables.length || d.identity || Object.keys(d.settings).length}
        {#if d.identity}
          <label><input type="checkbox" data-testid="backup-replace-identity" bind:checked={replaceIdentity} /> Take over the file’s identity (needed to return to its tables; this browser’s own tables then need their own backup)</label>
        {/if}
        <label><input type="checkbox" data-testid="backup-overwrite" bind:checked={overwrite} /> Replace decks and tables that are already here</label>
        <div class="row">
          <button type="button" class="primary" data-testid="backup-restore" disabled={busy} onclick={() => void restore()}>Restore</button>
          <button type="button" disabled={busy} onclick={() => (importing = null)}>Cancel</button>
        </div>
      {/if}
    </div>
  {/if}
  {#if result}
    <div role="status" data-testid="backup-result">
      <p>{result.summary}</p>
      {#if result.errors.length}
        <ul class="errors">
          {#each result.errors as message, i (i)}<li>{message}</li>{/each}
        </ul>
      {/if}
      {#if result.reloadNeeded}<button type="button" data-testid="backup-reload" onclick={reload}>Reload to use them</button>{/if}
    </div>
  {/if}
</section>

<style>
  .block {
    display: grid;
    gap: 6px;
    padding: var(--sp-space-lg, 16px);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--sp-font-size-large, 18px);
  }
  h3 {
    margin: 8px 0 0;
    font-size: var(--sp-font-size, 14px);
  }
  p {
    margin: 0;
    line-height: 1.4;
  }
  .help {
    font-size: var(--sp-font-size-small, 12px);
    color: var(--sp-muted, #555);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .file {
    display: none;
  }
  button {
    font: inherit;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    cursor: pointer;
    justify-self: start;
  }
  button.primary {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: 2px;
  }
  .restore {
    display: grid;
    gap: 8px;
    padding: 8px 0 0;
  }
  label {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: var(--sp-danger, #b00020);
    font-size: var(--sp-font-size-small, 12px);
  }
</style>
