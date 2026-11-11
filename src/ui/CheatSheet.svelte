<!--
  The `?` cheat sheet: every bound key, grouped as in the canonical keymap, with remapping (DESIGN "Input and
  interaction design", Discoverable: `?` opens a cheat sheet; all keys are remappable).
-->
<script lang="ts">
  import type { ActionId, KeyChord, KeyContext, Keymap } from '../games/types';
  import { cheatSheet, chordFromEvent, chordToString } from './keymap';

  let {
    keymap,
    onremap,
    onreset,
    onclose,
  }: {
    keymap: Keymap;
    onremap: (action: ActionId, context: KeyContext, chord: KeyChord) => string | null;
    onreset: () => void;
    onclose: () => void;
  } = $props();

  const groups = $derived(cheatSheet(keymap));
  let capturing = $state<{ action: ActionId; context: KeyContext; label: string } | null>(null);
  let message = $state('');


  /** While capturing, the next chord goes to the remap and nothing else sees the key. */
  function capture(e: KeyboardEvent) {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      capturing = null;
      message = '';
      return;
    }
    const chord = chordFromEvent(e);
    if (!chord) return;
    const err = onremap(capturing.action, capturing.context, chord);
    if (err) message = err;
    else {
      message = `${capturing.label}: ${chordToString(chord)}`;
      capturing = null;
    }
  }
  function swallowUp(e: KeyboardEvent) {
    if (capturing) e.stopImmediatePropagation();
  }
</script>

<svelte:window onkeydowncapture={capture} onkeyupcapture={swallowUp} />

<section class="sheet" data-testid="cheat-sheet" aria-label="Keyboard shortcuts">
  <header>
    <h2>Keys</h2>
    <span class="hint">Hover a card and press a key. Keys act on the selection when the hovered card is selected.</span>
    <button type="button" onclick={onreset} data-testid="reset-keys">Reset to defaults</button>
    <button type="button" onclick={onclose} aria-label="Close">×</button>
  </header>
  {#if capturing}
    <p class="capture" data-testid="capture">Press the new key for “{capturing.label}”, or Esc to cancel. {message}</p>
  {:else if message}
    <p class="capture">{message}</p>
  {/if}
  <div class="groups">
    {#each groups as g (g.group)}
      <div class="group">
        <h3>{g.group}</h3>
        <table>
          <tbody>
            {#each g.rows as row (row.context + row.action)}
              <tr data-testid="cheat-row" data-action={row.action} data-context={row.context}>
                <td class="label">{row.label}{row.context === 'prompt' ? ' (prompt)' : ''}</td>
                <td class="keys">
                  {#each row.chords as c, i (i)}<kbd data-testid="cheat-key">{chordToString(c)}</kbd>{/each}
                </td>
                <td>
                  <button
                    type="button"
                    class="change"
                    aria-label="Change key for {row.label}"
                    onclick={() => {
                      message = '';
                      capturing = { action: row.action, context: row.context, label: row.label };
                    }}>change</button
                  >
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  </div>
  <p class="mouse">
    Mouse: drag moves, Alt+drag moves temporarily, right-drag draws a line, Shift+right-drag a lasting mark, right-click opens the menu, double-click taps, middle-click inspects.
  </p>
</section>

<style>
  .sheet {
    position: fixed;
    z-index: 70;
    inset: 48px 5vw auto;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
    padding: var(--sp-space-lg, 16px);
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size-large, 18px);
  }
  .hint {
    flex: 1;
    color: var(--sp-muted, #5f5f5f);
  }
  .groups {
    columns: 3 280px;
    column-gap: 24px;
  }
  .group {
    break-inside: avoid;
    margin-top: 12px;
  }
  h3 {
    margin: 0 0 4px;
    font-variant: small-caps;
    letter-spacing: 0.05em;
    font-size: var(--sp-font-size, 14px);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 1px 4px;
    vertical-align: baseline;
  }
  .keys {
    text-align: right;
    white-space: nowrap;
  }
  kbd {
    display: inline-block;
    margin-left: 4px;
    padding: 0 4px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    font-family: var(--sp-font-mono, monospace);
  }
  button {
    font: inherit;
    background: none;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    color: inherit;
    cursor: pointer;
  }
  .change {
    border: 0;
    color: var(--sp-muted, #5f5f5f);
    text-decoration: underline;
  }
  .capture {
    margin: 8px 0 0;
    padding: 6px 8px;
    border: 1px dashed var(--sp-fg, #111);
  }
  .mouse {
    color: var(--sp-muted, #5f5f5f);
    margin: 12px 0 0;
  }
</style>
