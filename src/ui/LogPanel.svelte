<!--
  Action log with chat (DESIGN "Turn flow and confirmation", Action log: one line per state change with seat colour,
  actor and card names; hovering a card name previews it and highlights the card on the table; chat interleaves in the
  same timeline. "Input and interaction design", Accessibility: the log is a live region). M1-P6: the timeline, its
  filters and chat tabs and the `[[card name]]` previews live in ui/chat/.
-->
<script lang="ts">
  import type { ChatTab, TimelineFilter } from '../core/log';
  import type { InstanceId } from '../core/types';
  import type { CardDataSource, FaceSource } from '../data/types';
  import type { TextureSource } from '../util/texture';
  import ChatLines from './chat/ChatLines.svelte';
  import FilterBar from './chat/FilterBar.svelte';
  import { CardNameResolver } from './chat/names';
  import type { LogLine } from './describe';

  let {
    lines,
    open,
    ontoggle,
    onchat,
    onhovercard,
    cardData = null,
    faces = null,
    back = null,
    tabs = ['table'],
  }: {
    lines: LogLine[];
    open: boolean;
    ontoggle: () => void;
    /** Send a chat line on the current tab. */
    onchat: (text: string, channel: ChatTab) => void;
    onhovercard: (card: InstanceId | null, x: number, y: number) => void;
    /** Resolves `[[card name]]` previews (M1-P6). */
    cardData?: CardDataSource | null;
    faces?: FaceSource | null;
    back?: TextureSource | null;
    /** Chat tabs to offer (M1-P6); 'table' only by default. */
    tabs?: ChatTab[];
  } = $props();

  let text = $state('');
  let input = $state<HTMLInputElement | undefined>();
  let filter = $state<TimelineFilter>('all');
  let tab = $state<ChatTab>('table');
  const resolver = $derived(cardData ? new CardNameResolver(cardData) : null);
  // A tab that disappears (a team dissolved) falls back to the table tab.
  $effect(() => {
    if (!tabs.includes(tab)) tab = 'table';
  });

  /** Focus the chat field (Enter with no prompt showing, DESIGN "Input and interaction design"). */
  export function focusChat() {
    input?.focus();
  }

  function send() {
    const t = text.trim();
    if (t) onchat(t, tab);
    text = '';
  }
</script>

<aside class="log" class:closed={!open} data-testid="log" aria-label="Log and chat">
  <header>
    <h2>Log</h2>
    {#if open}<FilterBar bind:filter bind:tab {tabs} />{/if}
    <button type="button" onclick={ontoggle} aria-expanded={open}>{open ? 'Hide' : 'Log'}</button>
  </header>
  {#if open}
    <ChatLines {lines} {filter} {tab} {onhovercard} {resolver} {faces} {back} />
  {/if}
  <input
    bind:this={input}
    bind:value={text}
    class="chat"
    data-testid="chat-input"
    maxlength="500"
    placeholder={tab === 'table' ? 'Chat (Enter), [[card name]] previews' : `${tab === 'team' ? 'Team' : 'Spectator'} chat (Enter)`}
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
    /* Hidden, it is a small bar (header and chat input), not a full-height box over the table. */
    align-self: flex-start;
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
