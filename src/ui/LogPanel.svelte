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
  import { onDestroy, untrack, type Snippet } from 'svelte';
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
  import Icon from './design/Icon.svelte';
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
    under,
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
    /** Added by M7-P2: controls stacked under the Activity button and above the ticker (the View control). */
    under?: Snippet;
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
  /** The newest unread lines, at most TICKER_LINES, each shown for TICKER_MS (a CSS fade, or a delayed cut under reduced motion; no timers, no per-frame state). */
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
    <button type="button" class="ds-btn ds-icon-btn sp-h-md sp-round" data-testid="open-log" title="Log and chat" aria-expanded={false} onclick={ontoggle}><Icon name="chat" /><span class="sp-sr">Log and chat</span>{#if unread}<span class="ds-badge" data-testid="unread">{unread}</span><span class="sp-sr"> new</span>{/if}</button>
    {#if under}<div class="under">{@render under()}</div>{/if}
    <!-- The ticker repeats lines the page's live region already announces (ui/a11y), so it is hidden from screen readers. -->
    <ol class="ticker" aria-hidden="true" data-testid="log-ticker">
      {#each ticker as l (l.key)}
        <li class="tick" style:--seat={l.colour === null ? 'transparent' : `var(--sp-seat-${l.colour})`} style:--life="{TICKER_MS}ms"><SeatGlyph colour={l.colour} />{tickerText(l)}</li>
      {/each}
    </ol>
  </div>
{:else}
  <aside class="log ds-pop" data-testid="log" data-open="true" aria-label="Log and chat">
    <header>
      <h2 class="ds-heading">Activity</h2>
      <FilterBar bind:filter bind:tab tabs={shownTabs} />
      <button type="button" class="ds-btn ds-btn--quiet ds-icon-btn sp-h-sm sp-round" data-testid="close-log" aria-label="Hide the log" title="Hide the log" aria-expanded={true} onclick={ontoggle}><Icon name="close" /></button>
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
  .sp-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .under {
    pointer-events: auto;
  }
  .activity > button {
    position: relative;
    pointer-events: auto;
  }
  .activity .ds-badge {
    position: absolute;
    top: -4px;
    right: -4px;
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
    border-radius: var(--ds-radius-card);
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
    animation-duration: var(--life);
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  /*
   * Reduced motion: the page-wide rule (ui/a11y/motion.ts) cuts every animation to 1 ms, which would end each line
   * invisible at once. The line rests visible instead and is cut away after its lifetime (the rule leaves delays alone).
   */
  @media (prefers-reduced-motion: reduce) {
    .tick {
      opacity: 1;
      animation-name: tick-cut;
      animation-delay: var(--life);
    }
  }
  @keyframes tick-cut {
    from,
    to {
      opacity: 0;
    }
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
    width: min(360px, calc(100vw - 32px));
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
    height: var(--ds-control-sm);
    box-sizing: border-box;
    padding: 0 var(--ds-space-md);
    color: var(--ds-ink);
    background: var(--ds-panel);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-sm);
  }
  :global(.touch-ui) .chat {
    height: var(--ds-control-md);
  }
  .chat:focus {
    outline: 2px solid var(--ds-focus);
  }
</style>
