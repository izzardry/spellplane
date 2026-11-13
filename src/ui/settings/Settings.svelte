<!--
  The settings panel (PLAN M5-P5 settings consolidation: theme, quality, follow, sound, talk mode and devices, speech
  engine, keymap, card back, storage, and About). It reuses the pieces that already exist (the theme picker with sound,
  quality and follow; the voice panel; the dictation settings) and adds key remapping, the card back and storage.
  Everything here belongs to this browser and never reaches the other players. Non-modal: the table stays live under
  it, Esc or × closes it (DESIGN "Input and interaction design", Nothing modal). The HUD's theme popover stays as a
  shortcut to the display section.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { TableSession } from '../../session/types';
  import type { StorageStatus } from '../../store/quota';
  import { storageStatus } from '../../store/quota';
  import { DEFAULT_TALK, type SettingsStore, type TalkSettings } from '../../store/types';
  import type { CaptionControls, VoiceControls } from '../../voice/types';
  import About from '../about/About.svelte';
  import type { SoundMode } from '../sound';
  import { GATES, TALK_BUTTONS } from '../voice/labels';
  import VoicePanel from '../voice/VoicePanel.svelte';
  import type { CardBackSetting } from './back';
  import CardBack from './CardBack.svelte';
  import type { KeymapSettings } from './keys';
  import Keys from './Keys.svelte';
  import { SETTINGS_SECTIONS, type SettingsSection } from './sections';
  import Speech from './Speech.svelte';
  import Storage from './Storage.svelte';
  import ThemePicker from './Theme.svelte';
  import { ThemeChoice } from './theme';
  import type { ViewPrefs } from './view';

  let {
    settings = null,
    keys,
    cardBack,
    themeChoice = null,
    sound,
    view,
    voice,
    session,
    captions,
    storage = () => storageStatus(),
    storageFull = false,
    section = 'display',
    placement = 'panel',
    talkKey = null,
    onclose,
  }: {
    settings?: SettingsStore | null | undefined;
    keys: KeymapSettings;
    cardBack: CardBackSetting;
    themeChoice?: ThemeChoice | null;
    sound?: { mode: SoundMode; set(mode: SoundMode): void } | undefined;
    view?: { prefs: ViewPrefs; set<K extends keyof ViewPrefs>(name: K, value: ViewPrefs[K]): void } | undefined;
    /** A table's live voice (talk mode, devices, per-player volume); absent off the table. */
    voice?: VoiceControls | undefined;
    session?: TableSession | undefined;
    captions?: CaptionControls | undefined;
    storage?: () => Promise<StorageStatus>;
    storageFull?: boolean;
    section?: SettingsSection;
    /** 'panel': floats over the table; 'page': in a page's flow. */
    placement?: 'panel' | 'page';
    /** The talk key's label, for the voice section. */
    talkKey?: string | null;
    onclose?: () => void;
  } = $props();

  /** The section shown: the one asked for (the HUD's storage-full notice opens Storage), then the tab the player picks. */
  let current = $derived<SettingsSection>(section);

  /** Without the app's theme choice (a harness page), a local one keeps the picker working on the stored setting. */
  const choice = untrack(() => themeChoice ?? new ThemeChoice({ settings }));

  // Off the table: the stored talk mode and talk button, which a table's voice session reads when it starts.
  let storedTalk = $state<TalkSettings>({ ...DEFAULT_TALK });
  onMount(() => {
    if (voice || !settings) return;
    void settings
      .get('talk')
      .then((t) => (storedTalk = { ...DEFAULT_TALK, ...t }))
      .catch(() => {});
  });
  function setStoredTalk(patch: Partial<TalkSettings>): void {
    storedTalk = { ...storedTalk, ...patch };
    void settings?.set('talk', storedTalk).catch(() => {});
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || !onclose) return;
    // A key capture in progress takes Esc itself (it stops the event before it gets here).
    e.preventDefault();
    e.stopPropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="settings {placement}" data-testid="settings" data-section={current} aria-label="Settings" onkeydown={onkeydown}>
  <header>
    <h2>Settings</h2>
    <span class="note">For this browser only.</span>
    {#if onclose}<button type="button" class="x" data-testid="settings-close" aria-label="Close settings" onclick={onclose}>×</button>{/if}
  </header>
  <div class="tabs" role="tablist" aria-label="Settings sections">
    {#each SETTINGS_SECTIONS as s (s.id)}
      <button type="button" role="tab" id="sp-settings-tab-{s.id}" aria-selected={current === s.id} aria-controls="sp-settings-{s.id}" data-testid="settings-tab" data-section={s.id} onclick={() => (current = s.id)}>{s.label}</button>
    {/each}
  </div>
  <div class="body" role="tabpanel" id="sp-settings-{current}" aria-labelledby="sp-settings-tab-{current}" data-testid="settings-body">
    {#if current === 'display'}
      <div class="embed"><ThemePicker {choice} {sound} {view} /></div>
    {:else if current === 'voice'}
      {#if voice && session}
        <div class="embed"><VoicePanel {voice} {session} /></div>
      {:else}
        <div class="voice-off" data-testid="voice-settings-offline">
          <fieldset>
            <legend>Talk mode</legend>
            {#each GATES as g (g.gate)}
              <label><input type="radio" name="sp-talk-gate" value={g.gate} checked={storedTalk.gate === g.gate} onchange={() => setStoredTalk({ gate: g.gate })} /> {g.label} <small>— {g.hint}</small></label>
            {/each}
          </fieldset>
          <label class="row">
            Talk mouse button
            <select value={String(storedTalk.mouseButton)} onchange={(e) => setStoredTalk({ mouseButton: (e.currentTarget as HTMLSelectElement).value === 'null' ? null : Number((e.currentTarget as HTMLSelectElement).value) })}>
              {#each TALK_BUTTONS as b (String(b.button))}<option value={String(b.button)}>{b.label}</option>{/each}
            </select>
          </label>
          <p class="muted">{talkKey ? `Hold ${talkKey} to talk (change it under Keys).` : 'The talk key is under Keys.'} The microphone, its device and each player's volume are chosen at a table, after joining voice.</p>
        </div>
      {/if}
    {:else if current === 'dictation'}
      {#if captions}
        <div class="embed"><Speech {captions} embedded /></div>
      {:else}
        <p class="muted" data-testid="dictation-settings-offline">The dictation engine and language are chosen at a table with captions, where the active engine and where its audio goes are stated.</p>
      {/if}
    {:else if current === 'keys'}
      <Keys {keys} />
    {:else if current === 'cardBack'}
      <CardBack {cardBack} />
    {:else if current === 'storage'}
      <Storage status={storage} full={storageFull} />
    {:else if current === 'about'}
      <About embedded />
    {/if}
  </div>
</section>

<style>
  .settings {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
    padding: var(--sp-space-lg, 16px);
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  .settings.panel {
    position: fixed;
    z-index: 70;
    top: 56px;
    left: max(16px, env(safe-area-inset-left));
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 72px);
  }
  .settings.page {
    width: 100%;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size-large, 18px);
  }
  .note {
    color: var(--sp-muted, #5f5f5f);
  }
  .x {
    margin-left: auto;
    font: inherit;
    font-size: 16px;
    background: none;
    color: inherit;
    border: none;
    cursor: pointer;
    min-width: 32px;
    min-height: 32px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tabs button {
    font: inherit;
    cursor: pointer;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: var(--sp-radius-sm, 4px);
    padding: 3px 8px;
    min-height: 28px;
  }
  .tabs button[aria-selected='true'] {
    border-color: var(--sp-fg, #111);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .body {
    overflow-y: auto;
    min-height: 0;
  }
  .embed :global(section) {
    width: auto;
    border: none;
    box-shadow: none;
    padding: 0;
    background: none;
  }
  .voice-off {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  fieldset {
    margin: 0;
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: var(--sp-radius-sm, 4px);
    padding: 4px 8px 8px;
  }
  fieldset label {
    display: block;
    padding: 2px 0;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .muted,
  small {
    color: var(--sp-muted, #5f5f5f);
  }
  p {
    margin: 0;
  }
  @media (pointer: coarse) {
    .tabs button,
    .x {
      min-height: 44px;
    }
  }
</style>
