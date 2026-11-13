<!--
  Key remapping (PLAN M5-P5: every action in the keymap, conflict detection, reset; DESIGN "Input and interaction
  design": all keys are remappable, no chord twice within one context; PLAN Milestone 5, owner decisions, Talk key:
  Ctrl, remappable here). Change a key by pressing the new one; Ctrl alone is offered for the talk key. A key another
  action holds is refused and named, with a swap offered; each action resets alone, or all at once.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { KeyChord, KeyContext } from '../../games/types';
  import { chordToString } from '../keymap';
  import { ChordCapture, remapMessage, type KeymapSettings, type KeyRow, type RemapResult } from './keys';

  let { keys }: { keys: KeymapSettings } = $props();

  let groups = $state.raw(untrack(() => keys.rows()));
  onMount(() => {
    const off = keys.subscribe(() => (groups = keys.rows()));
    groups = keys.rows();
    return off;
  });

  let filter = $state('');
  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ group: g.group, rows: g.rows.filter((r) => r.label.toLowerCase().includes(q) || r.chords.some((c) => chordToString(c).toLowerCase().includes(q)) || g.group.toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length > 0);
  });

  /** The row waiting for its new key. */
  let capturing = $state<{ action: KeyRow['action']; context: KeyContext; label: string; modifierOk: boolean } | null>(null);
  /** A refused key, with what holds it (a conflict may be swapped). */
  let refused = $state<{ result: Exclude<RemapResult, { ok: true }>; action: KeyRow['action']; context: KeyContext; label: string } | null>(null);
  let message = $state('');
  const capture = new ChordCapture();

  function start(row: KeyRow): void {
    capture.reset();
    refused = null;
    message = '';
    capturing = { action: row.action, context: row.context, label: row.label, modifierOk: row.modifierOk };
  }

  function cancel(): void {
    capture.reset();
    capturing = null;
  }

  function offer(chord: KeyChord): void {
    const c = capturing;
    if (!c) return;
    const r = keys.remap(c.action, c.context, chord);
    capturing = null;
    if (r.ok) {
      refused = null;
      message = `${c.label}: ${chordToString(chord)}`;
    } else {
      refused = { result: r, action: c.action, context: c.context, label: c.label };
      message = '';
    }
  }

  function swap(): void {
    const r = refused;
    if (!r || r.result.reason !== 'conflict') return;
    const res = keys.swap(r.action, r.context, r.result.chord);
    if (res.ok) {
      message = `${r.label}: ${chordToString(r.result.chord)}; “${r.result.holder.label}” takes its old key.`;
      refused = null;
    } else refused = { ...r, result: res };
  }

  // While a row waits for its key, every key goes here and nowhere else (not to the table's keymap).
  function onkeydown(e: KeyboardEvent): void {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      cancel();
      return;
    }
    const chord = capture.keydown(e);
    if (chord) offer(chord);
  }
  function onkeyup(e: KeyboardEvent): void {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const chord = capture.keyup(e);
    if (chord) offer(chord);
  }

  const keyText = (cs: readonly KeyChord[]): string => cs.map(chordToString).join(' or ');
</script>

<svelte:window onkeydowncapture={onkeydown} onkeyupcapture={onkeyup} onpointerdowncapture={() => capture.reset()} onblur={() => capturing && cancel()} />

<div class="keys" data-testid="key-settings">
  <div class="bar">
    <input type="search" bind:value={filter} placeholder="Find an action or key" aria-label="Find an action or key" data-testid="key-filter" />
    <button type="button" data-testid="keys-reset-all" onclick={() => { keys.resetAll(); refused = null; message = 'Every key is back to its default.'; }}>Reset all keys</button>
  </div>
  <p class="hint">Change a key, then press the new one (Esc cancels). The talk key may be Ctrl alone: it opens the microphone only when held by itself, so Ctrl shortcuts keep working.</p>
  <div aria-live="polite">
    {#if capturing}
      <p class="capture" data-testid="key-capture">Press the new key for “{capturing.label}”{capturing.modifierOk ? ' (Ctrl alone works)' : ''}, or Esc to cancel.</p>
    {:else if refused}
      <p class="conflict" role="alert" data-testid="key-conflict" data-holder={refused.result.reason === 'conflict' ? refused.result.holder.action : null}>
        {remapMessage(refused.result)}
        {#if refused.result.reason === 'conflict'}
          <button type="button" data-testid="key-swap" onclick={swap}>Swap the keys</button>
        {/if}
        <button type="button" data-testid="key-conflict-cancel" onclick={() => (refused = null)}>Keep both as they are</button>
      </p>
    {:else if message}
      <p class="done" data-testid="key-message">{message}</p>
    {/if}
  </div>
  {#each shown as g (g.group)}
    <table>
      <caption>{g.group}</caption>
      <tbody>
        {#each g.rows as row (row.context + row.action)}
          <tr data-testid="key-row" data-action={row.action} data-context={row.context} data-remapped={row.remapped} class:active={capturing?.action === row.action && capturing.context === row.context} class:clash={refused?.result.reason === 'conflict' && refused.result.holder.action === row.action && refused.result.holder.context === row.context}>
            <th scope="row">{row.label}{row.context === 'prompt' ? ' (while a prompt shows)' : ''}</th>
            <td class="now">
              {#each row.chords as c, i (i)}<kbd data-testid="key-current">{chordToString(c)}</kbd>{/each}
              {#if row.remapped}<small data-testid="key-default">default {keyText(row.defaults)}</small>{/if}
            </td>
            <td class="act">
              <button type="button" data-testid="key-change" aria-label="Change key for {row.label}" onclick={() => start(row)}>Change</button>
              {#if row.remapped}<button type="button" data-testid="key-reset" aria-label="Reset key for {row.label}" onclick={() => { keys.reset(row.action, row.context); refused = null; message = `${row.label}: back to ${keyText(row.defaults)}`; }}>Reset</button>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}
  {#if shown.length === 0}<p class="hint" data-testid="key-filter-empty">No action matches “{filter}”.</p>{/if}
</div>

<style>
  .keys {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .bar input {
    flex: 1;
    min-width: 10em;
    font: inherit;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  .hint {
    margin: 0;
    color: var(--sp-muted, #5f5f5f);
  }
  .capture,
  .conflict,
  .done {
    margin: 0;
    padding: 6px 8px;
    border-left: 3px solid var(--sp-accent, #1f6fd1);
  }
  .conflict {
    border-left-color: var(--sp-danger, #b3261e);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    width: 46%;
  }
  .act {
    width: 9.5em;
  }
  caption {
    text-align: left;
    font-weight: var(--sp-font-weight-bold, 600);
    padding: 6px 0 2px;
  }
  th {
    text-align: left;
    font-weight: var(--sp-font-weight, 400);
    padding: 2px 4px 2px 0;
  }
  td {
    padding: 2px 0;
  }
  .now {
    overflow-wrap: anywhere;
  }
  .act {
    text-align: right;
    white-space: nowrap;
  }
  tr.active th,
  tr.clash th {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  tr.clash kbd {
    outline: 2px solid var(--sp-danger, #b3261e);
  }
  kbd {
    display: inline-block;
    margin-right: 4px;
    padding: 0 4px;
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: 3px;
    font: inherit;
  }
  small {
    color: var(--sp-muted, #5f5f5f);
  }
</style>
