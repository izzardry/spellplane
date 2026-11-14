<!--
  The talk-mode indicator (DESIGN "Chat and voice", Talk modes, Live voice; PLAN M3-G "talk-mode indicator states"):
  shows whether the mic is off, idle, live to everyone, live to the teammate only, dictating, or muted; a "Join voice"
  button acquires the microphone (the click also satisfies autoplay rules), a mute toggle (M), and the voice panel.
  Implementer: M3-P3. A spectator's listen-only session (M5-P7) shows "Listening" only, with the panel for each
  player's volume: no microphone to join, nothing to mute.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { HoldAloneState, TalkIndicatorState } from '../../voice/types';
  import type { TalkIndicatorProps } from '../types';
  import { indicatorLabel } from './labels';

  let {
    voice,
    talkKey = 'Ctrl',
    muteKey = 'M',
    panelOpen = false,
    ontogglepanel,
    hold = 'idle',
  }: TalkIndicatorProps & {
    /** Where a held modifier talk key stands under the hold-alone rule (ui/voice/input.ts), shown as `data-hold`. */
    hold?: HoldAloneState;
    /** The talk key's label from the keymap. */
    talkKey?: string;
    muteKey?: string;
    panelOpen?: boolean;
    ontogglepanel?: () => void;
  } = $props();

  let shown = $state<TalkIndicatorState>('noMic');
  let settings = $state(untrack(() => voice.talk()));
  let joined = $state(false);
  let joining = $state(false);
  let error = $state('');

  function refresh(): void {
    shown = voice.indicator();
    settings = voice.talk();
    joined = voice.joined;
  }
  onMount(() => {
    refresh();
    return voice.subscribe(refresh);
  });

  async function join(): Promise<void> {
    if (joining) return;
    joining = true;
    error = '';
    try {
      await voice.join();
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      error = name === 'NotAllowedError' ? 'Microphone access was refused.' : name === 'NotFoundError' ? 'No microphone found.' : `Microphone unavailable${e instanceof Error && e.message ? `: ${e.message}` : ''}.`;
    } finally {
      joining = false;
      refresh();
    }
  }

  const label = $derived(indicatorLabel(shown, settings, talkKey));
</script>

<div class="talk" data-testid="talk-indicator" data-state={shown} data-gate={settings.gate} data-hold={hold} role="group" aria-label="Voice">
  <span class="state {shown}" data-testid="talk-state" aria-live="polite" title={label}>
    <span class="dot" aria-hidden="true"></span>{label}
  </span>
  {#if shown !== 'listening'}
    {#if !joined && settings.voice}
      <button type="button" data-testid="voice-join" disabled={joining} onclick={join}>{joining ? 'Joining…' : 'Join voice'}</button>
    {/if}
    <button type="button" data-testid="voice-mute" aria-pressed={settings.muted} onclick={() => voice.toggleMute()}>
      {settings.muted ? 'Unmute' : 'Mute'} <kbd>{muteKey}</kbd>
    </button>
  {/if}
  <button type="button" data-testid="voice-settings" aria-expanded={panelOpen} aria-label="Voice settings" onclick={() => ontogglepanel?.()}>⚙</button>
  {#if error}<span class="error" role="alert" data-testid="voice-error">{error}</span>{/if}
</div>

<style>
  .talk {
    display: flex;
    align-items: center;
    gap: 4px;
    pointer-events: auto;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: 999px;
    padding: 1px 8px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    white-space: nowrap;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid currentColor;
    background: transparent;
  }
  /* Each state has a distinct shape as well as a colour (DESIGN "Input and interaction design", Accessibility). */
  .live {
    border-color: var(--sp-fg, #111);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .live .dot {
    background: var(--sp-accent, #1a7f37);
    border-color: var(--sp-accent, #1a7f37);
  }
  .team {
    border-style: double;
    border-width: 3px;
    border-color: var(--sp-fg, #111);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .team .dot {
    background: var(--sp-fg, #111);
    border-radius: 2px;
  }
  .dictating {
    border-style: dashed;
    border-color: var(--sp-fg, #111);
  }
  .dictating .dot {
    border-style: dashed;
  }
  .muted {
    text-decoration: line-through;
    color: var(--sp-muted, #5f5f5f);
  }
  .muted .dot {
    background: linear-gradient(45deg, transparent 40%, currentColor 40% 60%, transparent 60%);
  }
  /* Listen-only (a spectator): a ring with a solid centre, distinct from every talking state. */
  .listening {
    border-style: solid;
  }
  .listening .dot {
    background: radial-gradient(circle, currentColor 35%, transparent 40%);
  }
  .noMic {
    color: var(--sp-muted, #5f5f5f);
    border-style: dotted;
  }
  button {
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 2px 8px;
    font: inherit;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: var(--sp-fg, #111);
    color: var(--sp-surface, #fff);
  }
  kbd {
    font-family: var(--sp-font-mono, monospace);
    opacity: 0.7;
  }
  .error {
    color: var(--sp-danger, #b42318);
  }
</style>
