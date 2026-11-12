<!--
  The voice panel (DESIGN "Chat and voice", Talk modes, Live voice: talk mode, voice and dictation together, a personal
  volume and mute control per other player; PLAN M3-P3 device picker). Implementer: M3-P3.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { PeerInfo } from '../../net/types';
  import { chosenDevice } from '../../voice/mic';
  import type { PeerAudioSetting, TalkSettings } from '../../voice/types';
  import type { VoicePanelProps } from '../types';
  import { GATES, TALK_BUTTONS } from './labels';

  let { voice, session, onclose }: VoicePanelProps & { onclose?: () => void } = $props();

  let talk = $state<TalkSettings>(untrack(() => voice.talk()));
  let joined = $state(untrack(() => voice.joined));
  let peers = $state.raw<PeerInfo[]>([]);
  let audio = $state<Record<string, PeerAudioSetting>>({});
  let devices = $state.raw<MediaDeviceInfo[]>([]);
  let device = $state('');

  function refresh(): void {
    talk = voice.talk();
    device = chosenDevice(voice) ?? '';
    joined = voice.joined;
    // One row per player: a peer connected twice (a stale connection) is listed once.
    peers = session.netStatus().peers.filter((p, i, all) => p.peerId && all.findIndex((q) => q.peerId === p.peerId) === i);
    audio = Object.fromEntries(peers.map((p) => [p.peerId, voice.peerAudio(p.peerId)]));
  }
  /** Devices are listed once the microphone was granted: before that the browser hides their names. */
  async function loadDevices(): Promise<void> {
    if (voice.joined) devices = await voice.devices();
  }
  onMount(() => {
    refresh();
    void loadDevices();
    const a = voice.subscribe(() => {
      const was = joined;
      refresh();
      // Device labels are readable once the microphone was granted.
      if (!was && joined) void loadDevices();
    });
    const b = session.subscribeNet(refresh);
    return () => {
      a();
      b();
    };
  });

  function nameOf(p: PeerInfo): string {
    const seat = p.seat ? session.getState().seats[p.seat] : undefined;
    return seat?.name || p.nickname || (p.role === 'spectator' ? 'Spectator' : 'Player');
  }
  function setPeer(peerId: string, patch: Partial<PeerAudioSetting>): void {
    const next = { ...voice.peerAudio(peerId), ...patch };
    audio = { ...audio, [peerId]: next };
    void voice.setPeerAudio(peerId, next);
  }
  function chooseDevice(id: string): void {
    device = id;
    void voice.setDevice(id || null);
  }
</script>

<section class="panel" data-testid="voice-panel" aria-label="Voice settings">
  <header>
    <h2>Voice</h2>
    <button type="button" class="close" aria-label="Close voice settings" onclick={() => onclose?.()}>×</button>
  </header>

  <fieldset>
    <legend>Talk mode</legend>
    {#each GATES as g (g.gate)}
      <label title={g.hint}>
        <input type="radio" name="talk-gate" value={g.gate} data-testid="talk-gate-{g.gate}" checked={talk.gate === g.gate} onchange={() => void voice.setTalk({ gate: g.gate })} />
        {g.label}
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Send</legend>
    <label>
      <input type="checkbox" data-testid="talk-voice" checked={talk.voice} disabled={talk.voice && !talk.dictation} onchange={(e) => void voice.setTalk({ voice: e.currentTarget.checked })} />
      Live voice
    </label>
    <label>
      <input type="checkbox" data-testid="talk-dictation" checked={talk.dictation} disabled={talk.dictation && !talk.voice} onchange={(e) => void voice.setTalk({ dictation: e.currentTarget.checked })} />
      Captions (dictation)
    </label>
  </fieldset>

  <label class="row">
    Microphone
    <select data-testid="mic-device" value={device} onchange={(e) => {
        chooseDevice(e.currentTarget.value);
        // A focused select counts as a text field (the talk key is ignored there) and would take V to pick an option.
        e.currentTarget.blur();
      }}>
      <option value="">Default microphone</option>
      {#each devices as d, i (d.deviceId || i)}
        {#if d.deviceId && d.deviceId !== 'default'}
          <option value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
        {/if}
      {/each}
    </select>
  </label>
  {#if !joined}<p class="hint">Join voice to hear the table and to choose a named microphone.</p>{/if}

  <label class="row">
    Talk mouse button
    <select data-testid="talk-button" value={talk.mouseButton === null ? '' : String(talk.mouseButton)} onchange={(e) => {
        void voice.setTalk({ mouseButton: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) });
        e.currentTarget.blur();
      }}>
      {#each TALK_BUTTONS as b (b.label)}
        <option value={b.button === null ? '' : String(b.button)}>{b.label}</option>
      {/each}
    </select>
  </label>

  <h3>Players</h3>
  {#if peers.length === 0}
    <p class="hint">Nobody else is connected.</p>
  {:else}
    <ul>
      {#each peers as p (p.peerId)}
        <li data-testid="peer-audio" data-peer={p.peerId}>
          <span class="who">{nameOf(p)}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="Volume of {nameOf(p)}"
            data-testid="peer-volume"
            value={Math.round((audio[p.peerId]?.volume ?? 1) * 100)}
            oninput={(e) => setPeer(p.peerId, { volume: Number(e.currentTarget.value) / 100 })}
          />
          <label><input type="checkbox" data-testid="peer-mute" checked={audio[p.peerId]?.muted ?? false} onchange={(e) => setPeer(p.peerId, { muted: e.currentTarget.checked })} /> Mute</label>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    width: 280px;
    max-width: calc(100vw - 32px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-md, 4px);
    padding: 8px 10px;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
    pointer-events: auto;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2,
  h3 {
    margin: 4px 0;
    font-size: inherit;
    font-weight: var(--sp-font-weight-bold, 600);
  }
  fieldset {
    border: none;
    margin: 4px 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  legend {
    font-weight: var(--sp-font-weight-bold, 600);
    padding: 0;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 4px 0;
  }
  select,
  button {
    font: inherit;
    color: inherit;
    background: var(--sp-surface, #fff);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
  }
  .close {
    cursor: pointer;
    padding: 0 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 1fr 90px auto;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input[type='range'] {
    width: 90px;
  }
  .hint {
    color: var(--sp-muted, #5f5f5f);
    margin: 2px 0;
  }
</style>
