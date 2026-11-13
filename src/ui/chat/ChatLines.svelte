<!--
  The timeline of the log panel (DESIGN "Chat and voice", Text chat: chat lines and action-log lines share one
  timeline, filterable to chat only or actions only; card names typed in double brackets become hover previews.
  "Turn flow and confirmation", Action log: hovering a card name previews it and highlights the card on the table.
  "Input and interaction design", Accessibility: the log is a live region). PLAN M1-P6.
-->
<script lang="ts">
  import { filterTimeline, type ChatTab, type TimelineFilter } from '../../core/log';
  import type { InstanceId } from '../../core/types';
  import type { FaceSource } from '../../data/types';
  import type { TextureSource } from '../../util/texture';
  import CardFace from '../CardFace.svelte';
  import SeatGlyph from '../a11y/SeatGlyph.svelte';
  import type { LogLine } from '../describe';
  import type { CardNameResolver, NameLookup } from './names';

  let {
    lines,
    filter = 'all',
    tab = 'table',
    onhovercard,
    resolver = null,
    faces = null,
    back = null,
  }: {
    lines: LogLine[];
    filter?: TimelineFilter;
    tab?: ChatTab;
    onhovercard: (card: InstanceId | null, x: number, y: number) => void;
    /** Resolves `[[card name]]`; without it named cards show as plain names. */
    resolver?: CardNameResolver | null;
    faces?: FaceSource | null;
    back?: TextureSource | null;
  } = $props();

  const shown = $derived(filterTimeline(lines, filter, tab));
  let list = $state<HTMLElement | undefined>();

  // Follow the newest line, and keep following when the filter changes.
  $effect(() => {
    void shown.length;
    void filter;
    if (list) list.scrollTop = list.scrollHeight;
  });

  /** The `[[name]]` preview: where, which name, and its lookup once known. */
  let named = $state<{ name: string; set: string | undefined; x: number; y: number; lookup: NameLookup | null; n: number } | null>(null);
  let seq = 0;
  let vh = $state(typeof window === 'undefined' ? 900 : window.innerHeight);

  function showNamed(name: string, set: string | undefined, x: number, y: number) {
    if (!resolver) return;
    const n = ++seq;
    named = { name, set, x, y, lookup: resolver.peek(name, set), n };
    if (!named.lookup)
      void resolver.resolve(name, set).then((lookup) => {
        if (named?.n === n) named = { ...named, lookup };
      });
  }
  function hideNamed() {
    seq++;
    named = null;
  }
  // A line that a filter or tab change hides fires no pointerleave: drop its preview with it.
  $effect(() => {
    void filter;
    void tab;
    hideNamed();
  });
  function centreOf(e: FocusEvent): { x: number; y: number } {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2 };
  }
</script>

<svelte:window bind:innerHeight={vh} />

<!-- Not a live region itself: the page's live region (ui/a11y) announces new lines once, whatever the filter or tab, and
     batches bursts (M5-P4); a live list here would re-read lines whenever a filter or tab brings them back. -->
<ol bind:this={list} aria-label="Log lines" data-testid="log-lines" data-filter={filter}>
  {#each shown as line (line.key)}
    <li class={line.kind} class:warn={line.level === 'warn'} data-testid="log-line" data-kind={line.kind} style:--seat={line.colour === null ? 'transparent' : `var(--sp-seat-${line.colour})`}>
      {#if line.kind !== 'system'}<SeatGlyph colour={line.colour} /><b class="actor">{line.actor}</b>{(line.kind === 'chat' && !line.told) || line.joined ? ': ' : ' '}{/if}{#each line.segs as s, i (i)}{#if 'card' in s}<span
            class="card"
            data-testid="log-card"
            data-card={s.card}
            role="note"
            onpointerenter={(e) => onhovercard(s.card, e.clientX, e.clientY)}
            onpointerleave={(e) => onhovercard(null, e.clientX, e.clientY)}>{s.name}</span
          >{:else if 'named' in s && resolver}<span
            class="card named"
            data-testid="chat-card"
            data-name={s.named}
            role="button"
            tabindex="0"
            aria-label="Preview {s.named}"
            onpointerenter={(e) => showNamed(s.named, s.set, e.clientX, e.clientY)}
            onpointerleave={hideNamed}
            onfocus={(e) => {
              const c = centreOf(e);
              showNamed(s.named, s.set, c.x, c.y);
            }}
            onblur={hideNamed}>{s.text}</span
          >{:else}{s.text}{/if}{/each}
    </li>
  {:else}
    <li class="empty" data-testid="log-empty">{filter === 'chat' ? 'No chat yet.' : filter === 'actions' ? 'No actions yet.' : 'Nothing yet.'}</li>
  {/each}
</ol>

{#if named}
  {@const l = named.lookup}
  <div
    class="named-preview"
    class:text={!l || l.status === 'missing'}
    data-testid="chat-card-preview"
    data-state={!l ? 'loading' : l.status}
    data-sid={l?.status === 'found' ? l.ref.sid : null}
    style:left="{Math.max(8, named.x - 330)}px"
    style:top="{Math.min(Math.max(8, named.y - 120), vh - 290)}px"
    role="tooltip"
  >
    {#if !l}
      <p>Looking up “{named.name}”…</p>
    {:else if l.status === 'found' && faces}
      <CardFace {faces} cardRef={l.ref} {back} alt={l.card.name} />
    {:else if l.status === 'found'}
      <p>{l.card.name}</p>
    {:else}
      <p>No card named “{named.name}”.{#if l.nearMatches.length}<br />Did you mean {l.nearMatches.slice(0, 3).join(', ')}?{/if}</p>
    {/if}
  </div>
{/if}

<style>
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
  li.empty {
    border-left: 0;
    color: var(--sp-muted, #5f5f5f);
  }
  .card {
    text-decoration: underline dotted;
    cursor: help;
  }
  .named {
    font-style: normal;
    font-weight: 600;
  }
  .named:focus-visible {
    outline: 2px solid var(--sp-focus, #1f6fd1);
  }
  .named-preview {
    position: fixed;
    z-index: 75;
    width: 200px;
    height: 279px;
    pointer-events: none;
    box-shadow: 0 0 0 1px var(--sp-fg, #111);
    border-radius: 4.76% / 3.41%;
    background: var(--sp-surface, #fff);
  }
  .named-preview.text {
    height: auto;
    border-radius: var(--sp-radius-md, 4px);
    padding: 6px 8px;
    font-style: normal;
  }
  .named-preview p {
    margin: 0;
  }
</style>
