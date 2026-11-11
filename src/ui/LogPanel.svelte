<!--
  Action log with chat (DESIGN "Turn flow and confirmation", Action log: one line per state change with seat colour,
  actor and card names; hovering a card name previews it and highlights the card on the table; chat interleaves in the
  same timeline. "Input and interaction design", Accessibility: the log is a live region).
-->
<script lang="ts">
  import type { InstanceId } from '../core/types';
  import type { LogLine } from './describe';

  let {
    lines,
    open,
    ontoggle,
    onchat,
    onhovercard,
  }: {
    lines: LogLine[];
    open: boolean;
    ontoggle: () => void;
    onchat: (text: string) => void;
    onhovercard: (card: InstanceId | null, x: number, y: number) => void;
  } = $props();

  let text = $state('');
  let input = $state<HTMLInputElement | undefined>();
  let list = $state<HTMLElement | undefined>();

  /** Focus the chat field (Enter with no prompt showing, DESIGN "Input and interaction design"). */
  export function focusChat() {
    input?.focus();
  }

  $effect(() => {
    void lines.length;
    if (list) list.scrollTop = list.scrollHeight;
  });

  function send() {
    const t = text.trim();
    if (t) onchat(t);
    text = '';
  }
</script>

<aside class="log" class:closed={!open} data-testid="log" aria-label="Log and chat">
  <header>
    <h2>Log</h2>
    <button type="button" onclick={ontoggle} aria-expanded={open}>{open ? 'Hide' : 'Log'}</button>
  </header>
  {#if open}
    <ol bind:this={list} aria-live="polite" aria-relevant="additions">
      {#each lines as line (line.key)}
        <li class={line.kind} class:warn={line.level === 'warn'} data-testid="log-line" style:--seat={line.colour === null ? 'transparent' : `var(--sp-seat-${line.colour})`}>
          {#if line.kind !== 'system'}<b class="actor">{line.actor}</b>{line.kind === 'chat' ? ': ' : ' '}{/if}{#each line.segs as s, i (i)}{#if 'card' in s}<span
                class="card"
                data-testid="log-card"
                data-card={s.card}
                role="note"
                onpointerenter={(e) => onhovercard(s.card, e.clientX, e.clientY)}
                onpointerleave={(e) => onhovercard(null, e.clientX, e.clientY)}>{s.name}</span
              >{:else}{s.text}{/if}{/each}
        </li>
      {/each}
    </ol>
  {/if}
  <input
    bind:this={input}
    bind:value={text}
    class="chat"
    data-testid="chat-input"
    placeholder="Chat (Enter)"
    aria-label="Chat message"
    onkeydown={(e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        send();
      } else if (e.key === 'Escape') input?.blur();
    }}
  />
</aside>

<style>
  .log {
    display: flex;
    flex-direction: column;
    width: 300px;
    max-height: 100%;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-md, 4px);
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
    pointer-events: auto;
  }
  .log.closed {
    width: 200px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 8px;
    border-bottom: 1px solid var(--sp-border, #d8d8d8);
  }
  h2 {
    margin: 0;
    font-size: inherit;
    font-variant: small-caps;
    letter-spacing: 0.05em;
  }
  button {
    font: inherit;
    background: none;
    border: 0;
    color: var(--sp-muted, #5f5f5f);
    cursor: pointer;
  }
  ol {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 4px 8px;
  }
  li {
    padding-left: 6px;
    border-left: 3px solid var(--seat);
    margin: 1px 0;
  }
  li.system {
    color: var(--sp-muted, #5f5f5f);
    border-left-style: dotted;
  }
  li.warn {
    color: var(--sp-warning, #8a5a00);
  }
  li.chat {
    font-style: italic;
  }
  .card {
    text-decoration: underline dotted;
    cursor: help;
  }
  .chat {
    margin: 4px;
    font: inherit;
    padding: 3px 6px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
  }
  .chat:focus {
    outline: 2px solid var(--sp-focus, #1f6fd1);
  }
</style>
