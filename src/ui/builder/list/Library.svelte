<!--
  The local deck and pool library (DESIGN "Pre-game: draft, sealed and deck building", Local deck library: "Decks and
  drafted pools are saved in the browser, reusable across evenings, and exportable and importable as files"). Nothing
  modal: replacing the builder's cards and deleting a record ask inline. Implementer: M2-P6.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { CardRef, DeckBuild } from '../../../core/types';
  import type { CardData } from '../../../data/types';
  import { buildFromDeckRecord, deckRecordFromBuild, exportFileName, exportLibrary, importLibrary, newDeckId, planImport } from '../../../store/decks';
  import type { DeckRecord, DeckStore } from '../../../store/types';
  import { currentRecordId, forgetOtherPool, listUi, markSaved } from './state.svelte';

  let {
    decks,
    build,
    origin,
    card,
    onOpen,
  }: { decks: DeckStore; build: DeckBuild; origin?: DeckRecord['origin'] | undefined; card: (ref: CardRef) => CardData | null; onOpen: (build: DeckBuild) => void } = $props();

  /** Largest library file read (bytes). */
  const MAX_FILE = 20 * 1024 * 1024;

  let records = $state<DeckRecord[]>([]);
  let status = $state('');
  let problems = $state<string[]>([]);
  let confirming = $state<{ id: string; kind: 'open' | 'delete' } | null>(null);
  let fileInput = $state<HTMLInputElement | undefined>();
  let busy = $state(false);
  /** Whether the first read of the library has finished: until then `current` cannot be known, so Save waits. */
  let loaded = $state(false);

  /** The record "Save changes" updates: the one last saved or opened, while the builder still holds that pool. */
  const currentId = $derived(currentRecordId(build));
  const current = $derived(records.find((r) => r.id === currentId) ?? null);

  // A new pool on the same page (a new draft without a reload) is not the saved one: forget its record and name. Runs
  // when the build changes only, so opening a record (which marks it before the builder hands the new build back)
  // is never undone by a look at the old build.
  $effect(() => {
    const b = build;
    untrack(() => forgetOtherPool(b));
  });

  async function refresh() {
    try {
      records = await decks.list();
    } catch (e) {
      status = `The library could not be read: ${message(e)}`;
    } finally {
      loaded = true;
    }
  }
  $effect(() => {
    void refresh();
  });

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function defaultName(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return origin ? `${origin.sets.join(' ')} pool ${stamp}` : `Deck ${stamp}`;
  }

  async function save(asNew: boolean) {
    busy = true;
    problems = [];
    try {
      // `current` comes from the last listing; if that listing failed, ask the store for the record itself.
      const id = asNew ? null : currentId;
      const target = id === null ? null : (current ?? (await decks.get(id)));
      const name = listUi.name.trim() || target?.name || defaultName();
      const now = Date.now();
      const record = deckRecordFromBuild(build, {
        id: target?.id ?? newDeckId(),
        name,
        now,
        ...(target ? { createdAt: target.createdAt } : {}),
        ...(origin ? { origin } : target?.origin ? { origin: target.origin } : {}),
      });
      await decks.put(record);
      markSaved(record.id, name, record.pool ?? build);
      status = target ? `Saved changes to “${name}”.` : `Saved “${name}” to the library.`;
      await refresh();
    } catch (e) {
      status = `Saving failed: ${message(e)}`;
    } finally {
      busy = false;
    }
  }

  function open(record: DeckRecord) {
    confirming = null;
    const opened = buildFromDeckRecord(record);
    markSaved(record.id, record.name, opened);
    onOpen(opened);
    status = `Opened “${record.name}”.`;
  }

  async function remove(record: DeckRecord) {
    confirming = null;
    try {
      await decks.delete(record.id);
      if (listUi.savedId === record.id) {
        listUi.savedId = null;
        listUi.savedPool = null;
      }
      status = `Deleted “${record.name}”.`;
      await refresh();
    } catch (e) {
      status = `Deleting failed: ${message(e)}`;
    }
  }

  function download(list: DeckRecord[]) {
    const now = Date.now();
    const blob = new Blob([exportLibrary(list, now)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(list, now);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status = list.length === 1 ? `Exported “${list[0]!.name}”.` : `Exported ${list.length} decks.`;
  }

  async function importFile(file: File) {
    busy = true;
    problems = [];
    try {
      if (file.size > MAX_FILE) {
        status = `“${file.name}” is too large for a deck file.`;
        return;
      }
      const result = importLibrary(await file.text());
      problems = result.errors.map((e) => e.message);
      const existing = await decks.list();
      const plan = planImport(existing, result.decks, newDeckId);
      for (const r of plan.put) await decks.put(r);
      const parts: string[] = [];
      parts.push(plan.put.length === 1 ? 'Imported 1 deck.' : `Imported ${plan.put.length} decks.`);
      if (plan.unchanged) parts.push(`${plan.unchanged} already in the library.`);
      if (plan.copied) parts.push(`${plan.copied} added as ${plan.copied === 1 ? 'a copy' : 'copies'}, since the library holds a different deck with the same id.`);
      if (result.errors.length && result.decks.length === 0 && result.errors[0]!.index === -1) status = 'Nothing was imported.';
      else status = parts.join(' ');
      await refresh();
    } catch (e) {
      status = `Import failed: ${message(e)}`;
    } finally {
      busy = false;
      if (fileInput) fileInput.value = '';
    }
  }

  function when(ms: number): string {
    return new Date(ms).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function summary(r: DeckRecord): string {
    return `${r.main.length} + ${r.side.length}`;
  }
  /** A few names from the deck, so similar records can be told apart. */
  function preview(r: DeckRecord): string {
    const names: string[] = [];
    for (const ref of r.main) {
      const n = card(ref)?.name;
      if (n && !names.includes(n)) names.push(n);
      if (names.length === 3) break;
    }
    return names.join(', ');
  }
</script>

<section class="library" data-testid="deck-library" aria-label="Deck library">
  <h2>Deck library</h2>
  <div class="save">
    <input type="text" placeholder={current?.name ?? 'Deck name'} aria-label="Deck name" data-testid="library-name" bind:value={listUi.name} maxlength="200" />
    <button type="button" data-testid="library-save" disabled={busy || !loaded} onclick={() => save(false)}>{current ? 'Save changes' : 'Save to library'}</button>
    {#if current}<button type="button" data-testid="library-save-new" disabled={busy || !loaded} onclick={() => save(true)}>Save as new</button>{/if}
  </div>
  <div class="files">
    <button type="button" data-testid="library-export-all" disabled={records.length === 0} onclick={() => download(records)}>Export all</button>
    <label class="file">
      Import file…
      <input
        bind:this={fileInput}
        type="file"
        accept=".json,application/json"
        data-testid="library-import"
        onchange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void importFile(f);
        }}
      />
    </label>
  </div>
  <div class="status" aria-live="polite" data-testid="library-status">
    {#if status}<p>{status}</p>{/if}
    {#if problems.length}
      <ul class="problems" data-testid="library-problems">
        {#each problems as p, i (i)}<li>{p}</li>{/each}
      </ul>
    {/if}
  </div>
  {#if records.length === 0}
    <p class="muted">No saved decks yet.</p>
  {:else}
    <ul class="records">
      {#each records as r (r.id)}
        <li data-testid="library-record" data-id={r.id} class:current={r.id === currentId}>
          <div class="what">
            <span class="name" data-testid="library-record-name">{r.name}</span>
            <span class="muted"><span class="tag">{r.source === 'drafted' ? 'pool' : r.source}</span> {summary(r)} cards · {when(r.updatedAt)}</span>
            {#if preview(r)}<span class="muted preview">{preview(r)}</span>{/if}
          </div>
          {#if confirming?.id === r.id}
            <span class="confirm" role="group" aria-label="Confirm">
              {#if confirming.kind === 'open'}
                Replace the builder's cards?
                <button type="button" data-testid="library-confirm" onclick={() => open(r)}>Replace</button>
              {:else}
                Delete for good?
                <button type="button" data-testid="library-confirm" onclick={() => remove(r)}>Delete</button>
              {/if}
              <button type="button" onclick={() => (confirming = null)}>Cancel</button>
            </span>
          {:else}
            <span class="actions">
              <button type="button" data-testid="library-open" onclick={() => (build.cards.length === 0 ? open(r) : (confirming = { id: r.id, kind: 'open' }))}>Open</button>
              <button type="button" data-testid="library-export" onclick={() => download([r])}>Export</button>
              <button type="button" data-testid="library-delete" onclick={() => (confirming = { id: r.id, kind: 'delete' })}>Delete</button>
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .library {
    margin-top: 16px;
    border-top: 1px solid var(--sp-border, #d8d8d8);
    padding-top: 10px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1.1em;
  }
  input,
  button {
    font: inherit;
    color: inherit;
  }
  .save,
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .save input {
    flex: 1 1 200px;
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    min-height: 32px;
    box-sizing: border-box;
    background: var(--sp-surface, #fff);
  }
  button,
  .file {
    border: 1px solid var(--sp-border, #d8d8d8);
    background: var(--sp-surface, #fff);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 4px 10px;
    min-height: 32px;
    box-sizing: border-box;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .file {
    display: inline-flex;
    align-items: center;
    position: relative;
  }
  .file input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .file:focus-within {
    outline: 2px solid var(--sp-fg, #111);
  }
  .status p {
    margin: 4px 0;
  }
  .problems {
    margin: 4px 0;
    padding-left: 18px;
    color: var(--sp-danger, #a00);
  }
  .records {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .records li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--sp-border, #eee);
  }
  .records li.current .name {
    font-weight: 600;
  }
  .what {
    flex: 1 1 220px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    font-variant: small-caps;
    letter-spacing: 0.05em;
  }
  .actions,
  .confirm {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
</style>
