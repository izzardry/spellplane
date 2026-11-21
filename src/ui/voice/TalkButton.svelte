<!--
  The table's one Talk control (docs/design/m7-hud-proposal.md, Talk: "A microphone button: hold to talk, with a mute
  state … One control, not five (Voice off, Join voice, Mute, ⚙, Dictation)"; visual.md 2.8 "Table primary": a round
  `lg` talk button beside the primary; gate M8 finding F17). It replaces the voice row at the table: the round button
  joins voice on its first click (which also satisfies autoplay rules), then a press held on it talks and a click opens
  the voice panel (talk mode, devices, volumes). Mute stays on its key and in the Menu; the button shows it. A
  spectator's listen-only session shows a speaker that opens the panel. The talk state is the button's tooltip and its
  accessible live text, so the shortcut words stay out of the primary UI.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { HoldAloneState, TalkIndicatorState } from '../../voice/types';
  import type { TalkIndicatorProps } from '../types';
  import Icon from '../design/Icon.svelte';
  import { indicatorLabel } from './labels';

  let {
    voice,
    talkKey = 'Ctrl',
    panelOpen = false,
    ontogglepanel,
    hold = 'idle',
  }: TalkIndicatorProps & {
    hold?: HoldAloneState;
    talkKey?: string;
    panelOpen?: boolean;
    ontogglepanel?: () => void;
  } = $props();

  /** How long a press rests on the button before it talks (a shorter press is a click: the panel). */
  const HOLD_MS = 250;

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
  /** What the button does on a click: join voice first; afterwards (and for a listener) open the voice panel. */
  const mode = $derived<'join' | 'talk' | 'listen'>(shown === 'listening' ? 'listen' : !joined && settings.voice ? 'join' : 'talk');
  const live = $derived(shown === 'live' || shown === 'team' || shown === 'dictating');
  const tip = $derived(mode === 'join' ? (joining ? 'Joining voice…' : 'Join voice') : mode === 'listen' ? 'Listening · voice settings' : `${label} · hold here to talk · click for voice settings`);

  // A press held on the button talks (as the talk key does); a short press is a click.
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let pressing: number | null = null;
  let talking = false;
  let swallowClick = false;
  function down(e: PointerEvent): void {
    if (mode !== 'talk' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pressing = e.pointerId;
    swallowClick = false;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (pressing === null) return;
      talking = true;
      swallowClick = true;
      voice.keyDown(false);
    }, HOLD_MS);
  }
  function up(e: PointerEvent): void {
    if (pressing !== e.pointerId) return;
    pressing = null;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    if (talking) {
      talking = false;
      voice.keyUp();
    }
  }
  function click(): void {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (mode === 'join') void join();
    else ontogglepanel?.();
  }
  onDestroy(() => {
    if (holdTimer) clearTimeout(holdTimer);
    if (talking) voice.keyUp();
  });
</script>

<svelte:window onpointerup={up} onpointercancel={up} />

<div class="talk" data-testid="talk-indicator" data-state={shown} data-gate={settings.gate} data-hold={hold} role="group" aria-label="Voice">
  <span class="sr" data-testid="talk-state" aria-live="polite">{label}</span>
  <button
    type="button"
    class="ds-btn ds-btn--secondary ds-btn--lg ds-icon-btn ds-btn--icon ds-icon-only"
    class:is-pressed={live}
    class:quiet={shown === 'noMic' || shown === 'muted'}
    data-testid={mode === 'join' ? 'voice-join' : 'voice-settings'}
    data-mode={mode}
    aria-label={tip}
    aria-expanded={mode === 'join' ? undefined : panelOpen}
    title={tip}
    disabled={joining || undefined}
    onpointerdown={down}
    onclick={click}
    ><Icon name={mode === 'listen' ? 'volume' : shown === 'muted' || (mode === 'join' && !joining) || shown === 'noMic' ? 'micOff' : 'mic'} size={24} /></button
  >
  {#if error}<span class="error ds-toast" role="alert" data-testid="voice-error">{error}</span>{/if}
</div>

<style>
  .talk {
    position: relative;
    display: flex;
    align-items: center;
    pointer-events: auto;
  }
  .quiet {
    color: var(--ds-muted);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .error {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--ds-space-sm));
    white-space: nowrap;
    color: var(--ds-danger);
  }
</style>
