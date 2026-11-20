<!--
  Action log with chat (DESIGN "Turn flow and confirmation", Action log: one line per state change with seat colour,
  actor and card names; hovering a card name previews it and highlights the card on the table; chat interleaves in the
  same timeline. "Input and interaction design", Accessibility: the log is a live region). M1-P6: the timeline, its
  filters and chat tabs and the `[[card name]]` previews live in ui/chat/. M7-P2 (docs/design/m7-hud-proposal.md,
  Activity button and Activity drawer): closed, it is one button with an unread count and a quiet ticker of the last
  two or three lines, which fade after about six seconds; open, a drawer over the right edge of the table with the
  timeline, its tabs and the chat field. Never a permanent column.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { ChatTab, TimelineFilter } from '../core/log';
  import type { InstanceId } from '../core/types';
  import type { CardDataSource, FaceSource } from '../data/types';
  import type { TextureSource } from '../util/texture';
  import ChatLines from './chat/ChatLines.svelte';
  import FilterBar from './chat/FilterBar.svelte';
  import { CardNameResolver } from './chat/names';
  import { TypingSender, type Typer } from './chat/typing';
  import TypingLine from './chat/TypingLine.svelte';
  import type { LogLine } from './describe';
  import IconButton from './design/IconButton.svelte';
  import SeatGlyph from './a11y/SeatGlyph.svelte';
  import { tickerText, TICKER_LINES, TICKER_MS } from './hud/ticker';

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
    typers = [],
    ontyping,
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
    /** Added by M6-P2: who is typing that this viewer may see (ui/chat/typing.ts typersOf). */
    typers?: Typer[];
    /** Added by M6-P2: announce this field's typing on presence (Presence.typing); absent at the solo table. */
    ontyping?: (channel: ChatTab | null) => void;
  } = $props();

  let text = $state('');
  let input = $state<HTMLInputElement | undefined>();
  let filter = $state<TimelineFilter>('all');
  let tab = $state<ChatTab>('table');
  const resolver = $derived(cardData ? new CardNameResolver(cardData) : null);
  /**
   * The tabs offered: a tab that disappears (a team dissolved, the last spectator left) stays while the field holds a
   * draft written on it, so Enter never sends that draft to another audience (M6-P2); once it is sent or emptied the
   * tab goes and the field falls back to the table tab.
   */
  const shownTabs = $derived(tabs.includes(tab) || !text.trim() ? tabs : [...tabs, tab]);
  $effect(() => {
    if (!shownTabs.includes(tab)) tab = 'table';
  });
  /** This field's typing indicator (M6-P2): announced while it holds text, on the tab it would go to. */
  const typing = new TypingSender({ send: (channel) => ontyping?.(channel) });
  // Another tab while typing: the indicator follows it (and stops on the team tab, which is never announced).
  $effect(() => {
    const t = tab;
    untrack(() => {
      if (typing.channel() !== null) typing.input(text, t);
    });
  });
  onDestroy(() => typing.dispose());

  /** Focus the chat field (Enter with no prompt showing, DESIGN "Input and interaction design"). */
  export function focusChat() {
    input?.focus();
  }

  // --- Unread count and ticker (closed drawer) -------------------------------------------------------------------
  /** Lines the viewer has seen: all of them while the drawer is open, else as many as when it closed. */
  let seen = $state(untrack(() => lines.length));
  $effect(() => {
    if (open) seen = lines.length;
  });
  // A log that shrank (a resume replaced it) counts from there.
  $effect(() => {
    if (lines.length < seen) seen = lines.length;
  });
  const unread = $derived(open ? 0 : Math.max(0, lines.length - seen));
  /** The newest unread lines, at most TICKER_LINES, each shown for TICKER_MS (a CSS fade; no timers, no per-frame state). */
  const ticker = $derived(open ? [] : lines.slice(Math.max(seen, lines.length - TICKER_LINES)));

  function send() {
    const t = text.trim();
    if (t) onchat(t, tab);
    text = '';
    typing.stop();
  }
</script>

{#if !open}
  <div class="activity" data-testid="log" data-open="false">
    <IconButton icon="chat" label="Log and chat" data-testid="open-log" aria-expanded={false} badge={unread || null} onclick={ontoggle} />
    <!-- The ticker repeats lines the page's live region already announces (ui/a11y), so it is hidden from screen readers. -->
    <ol class="ticker" aria-hidden="true" data-testid="log-ticker">
      {#each ticker as l (l.key)}
        <li class="tick" style:--seat={l.colour === null ? 'transparent' : `var(--sp-seat-${l.colour})`} style:animation-duration="{TICKER_MS}ms"><SeatGlyph colour={l.colour} />{tickerText(l)}</li>
      {/each}
    </ol>
  </div>
{:else}
  <aside class="log ds-pop" data-testid="log" data-open="true" aria-label="Log and chat">
    <header>
      <h2 class="ds-heading">Activity</h2>
      <FilterBar bind:filter bind:tab tabs={shownTabs} />
      <IconButton icon="close" label="Hide the log" variant="quiet" data-testid="close-log" aria-expanded={true} onclick={ontoggle} />
    </header>
    <ChatLines {lines} {filter} {tab} {onhovercard} {resolver} {faces} {back} />
    <input
      bind:this={input}
      bind:value={text}
      class="chat"
      data-testid="chat-input"
      maxlength="500"
      placeholder={tab === 'table' ? 'Chat (Enter), [[card name]] previews' : `${tab === 'team' ? 'Team' : 'Spectator'} chat (Enter)`}
      aria-label="Chat message"
      oninput={(e) => typing.input(e.currentTarget.value, tab)}
      onblur={() => typing.stop()}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          send();
        } else if (e.key === 'Escape') input?.blur();
      }}
    />
    <TypingLine {typers} {tab} tabs={shownTabs} />
  </aside>
{/if}

<style>
  .activity {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--ds-space-sm);
    pointer-events: none;
  }
  .ticker {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    max-width: min(320px, 60vw);
  }
  .tick {
    padding: 4px 10px;
    border-radius: var(--ds-radius-md);
    border-left: 3px solid var(--seat);
    background: var(--ds-panel);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-raised);
    font-size: var(--ds-type-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    box-sizing: border-box;
    opacity: 0;
    animation-name: tick;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  @keyframes tick {
    0% {
      opacity: 0;
      transform: translateY(-4px);
    }
    4% {
      opacity: 1;
      transform: none;
    }
    85% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .log {
    display: flex;
    flex-direction: column;
    width: min(340px, calc(100vw - 32px));
    max-height: 100%;
    box-sizing: border-box;
    font: var(--ds-type-small) / 1.4 var(--ds-font-body);
    pointer-events: auto;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-md);
    border-bottom: 1px solid var(--ds-line);
  }
  header :global(.ds-icon-btn) {
    margin-left: auto;
  }
  h2 {
    font-size: var(--ds-type-body);
  }
  .chat {
    margin: var(--ds-space-sm);
    font: inherit;
    min-height: 34px;
    padding: 0 var(--ds-space-md);
    color: var(--ds-ink);
    background: var(--ds-panel);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-sm);
  }
  .chat:focus {
    outline: 2px solid var(--ds-focus);
  }
</style>
