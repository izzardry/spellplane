<!--
  "Who is typing" beside the chat field (DESIGN "Multiplayer architecture", Shared state: who is typing; "Chat and
  voice", Text chat; GAPS 22). Shows who is typing on the tab shown, then on the viewer's other tabs; nothing when nobody
  is. A polite live region, so a screen reader hears it without losing its place. M6-P2.
-->
<script lang="ts">
  import type { ChatTab } from '../../core/log';
  import { typingText, type Typer } from './typing';

  let { typers = [], tab, tabs = [tab] }: { typers?: Typer[]; tab: ChatTab; tabs?: ChatTab[] } = $props();
  const text = $derived(typingText(typers, tab, tabs));
</script>

<p class="typing" data-testid="chat-typing" data-typing={text ? 'true' : 'false'} aria-live="polite">{text}</p>

<style>
  .typing {
    margin: 0 6px 3px;
    min-height: 1.4em;
    color: var(--sp-muted, #5f5f5f);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .typing[data-typing='false'] {
    min-height: 0;
  }
</style>
