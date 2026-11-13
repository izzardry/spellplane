<!--
  Speech settings (PLAN M3-P4; DESIGN "Chat and voice", Dictation and captions): the dictation engine and language,
  with a plain statement of which engine is active and where audio goes. The on-device model is downloaded only after
  the player asks for it here, with its size and where it comes from stated first; nothing about it loads before (PLAN M3-P4 acceptance).
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { SpeechSettingsProps } from '../types';
  import type { SpeechEngineId, SpeechEngineInfo } from '../../voice/types';
  import { LOCAL_MODEL_SOURCES } from '../../voice/speech/index';
  import { engineStatement } from './captions';

  /** `top`: CSS px from the viewport top, below the HUD's Dictation button (the toolbar above it may wrap to two rows). */
  let { captions, onclose, top }: SpeechSettingsProps & { onclose?: () => void; top?: number } = $props();

  let active = $state<SpeechEngineInfo>(untrack(() => captions.engine()));
  let lang = $state(untrack(() => captions.lang()));
  let engines = $state<{ info: SpeechEngineInfo; available: boolean }[]>([]);
  /** The local model was picked and waits for the player to confirm the download. */
  let confirmDownload = $state(false);
  let progress = $state<{ loaded: number; total: number } | null>(null);
  let error = $state('');

  onMount(() => {
    let live = true;
    void captions.engines().then((list) => {
      if (live) engines = list;
    });
    return () => {
      live = false;
    };
  });

  /** Common dictation languages (BCP 47, with a region so the recogniser knows the accent), the browser's own first. */
  const COMMON = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pt-BR', 'pt-PT', 'pl-PL', 'sv-SE', 'da-DK', 'nb-NO', 'fi-FI', 'cs-CZ', 'ru-RU', 'uk-UA', 'tr-TR', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW'];
  const browserLangs = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language].filter((l) => l && l.includes('-'));
  const options = $derived([...new Set([lang, ...browserLangs, ...COMMON])]);
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(undefined, { type: 'language' });
  } catch {
    names = null;
  }
  const nameOf = (tag: string): string => {
    try {
      return names?.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };

  const WHERE: Record<SpeechEngineInfo['audio'], string> = {
    vendor: 'audio goes to your browser vendor',
    device: 'audio stays on this device',
    none: 'no audio is captured',
  };
  // An engine this browser cannot run is not stated as active (Web Speech in Firefox).
  const statement = $derived(engineStatement(active, engines));
  const localBytes = $derived(engines.find((e) => e.info.id === 'local')?.info.downloadBytes ?? 0);
  const mb = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`;

  async function use(id: SpeechEngineId): Promise<void> {
    error = '';
    const local = id === 'local';
    if (local) progress = { loaded: 0, total: 0 };
    try {
      await captions.setEngine(id, local ? (loaded, total) => (progress = { loaded, total }) : undefined);
      active = captions.engine();
      confirmDownload = false;
    } catch (e) {
      // The engine stays as it was, and the choice shows it again.
      confirmDownload = false;
      active = captions.engine();
      error = `${local ? 'The model could not be downloaded' : 'The engine could not start'}: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      progress = null;
    }
  }

  function pick(info: SpeechEngineInfo): void {
    error = '';
    if (info.id === active.id) {
      confirmDownload = false;
      return;
    }
    // The on-device model is a download: the player confirms it with its size in view.
    if (info.id === 'local') confirmDownload = true;
    else {
      confirmDownload = false;
      void use(info.id);
    }
  }

  async function setLang(next: string): Promise<void> {
    lang = next;
    await captions.setLang(next);
    lang = captions.lang();
  }
</script>

<section class="speech" data-testid="speech-settings" aria-label="Dictation settings" style={top !== undefined ? `top: ${top}px; max-height: calc(100vh - ${top + 48}px)` : undefined}>
  <header>
    <h2>Dictation</h2>
    {#if onclose}<button type="button" class="x" onclick={onclose} aria-label="Close">×</button>{/if}
  </header>

  {#if statement.available}
    <p class="statement" data-testid="speech-statement" data-engine={active.id} data-audio={active.audio} data-available="true">
      Active engine: <strong>{active.label}</strong>. {active.statement}
    </p>
  {:else}
    <p class="statement off" data-testid="speech-statement" data-engine={active.id} data-audio="none" data-available="false">{statement.text}</p>
  {/if}

  <fieldset>
    <legend>Engine</legend>
    {#each engines as e (e.info.id)}
      <label class="engine" data-testid="speech-engine" data-engine={e.info.id} class:off={!e.available}>
        <input
          type="radio"
          name="speech-engine"
          value={e.info.id}
          checked={e.info.id === (confirmDownload ? 'local' : active.id)}
          disabled={!e.available || progress !== null}
          onchange={() => pick(e.info)}
        />
        <span>
          {e.info.label}
          <small>
            — {WHERE[e.info.audio]}{#if e.info.downloadBytes}; downloads about {mb(e.info.downloadBytes)} once{/if}{#if !e.available}; not available in this browser{/if}
          </small>
        </span>
      </label>
    {/each}
  </fieldset>

  {#if confirmDownload && progress === null}
    <p class="confirm" data-testid="speech-download-confirm">
      The on-device model is downloaded once{#if localBytes}&nbsp;(about {mb(localBytes)}){/if} and then kept in this browser.
      <span data-testid="speech-download-sources">{LOCAL_MODEL_SOURCES}</span>
      <button type="button" data-testid="speech-download" onclick={() => use('local')}>Download and use it</button>
      <button type="button" onclick={() => (confirmDownload = false)}>Cancel</button>
    </p>
  {/if}
  {#if progress}
    <p class="progress">
      Downloading the model…
      <progress data-testid="speech-progress" max={progress.total || 1} value={progress.total ? progress.loaded : 0}></progress>
      {#if progress.total}{mb(progress.loaded)} of {mb(progress.total)}{/if}
    </p>
  {/if}
  {#if error}<p class="error" role="alert" data-testid="speech-error">{error}</p>{/if}

  <label class="lang">
    Language
    <select data-testid="speech-lang" value={lang} onchange={(e) => void setLang((e.currentTarget as HTMLSelectElement).value)}>
      {#each options as tag (tag)}
        <option value={tag}>{nameOf(tag)} ({tag})</option>
      {/each}
    </select>
  </label>
</section>

<style>
  .speech {
    position: fixed;
    z-index: 70;
    /* Below the HUD's Dictation button (its own row under the toolbar), so the button still closes it. */
    top: 76px;
    left: 16px;
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 124px);
    overflow-y: auto;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
    padding: var(--sp-space-lg, 16px);
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size-large, 18px);
  }
  .statement {
    margin: 8px 0 12px;
    padding: 8px;
    border-left: 3px solid var(--sp-accent, #1f6fd1);
    background: color-mix(in srgb, var(--sp-surface, #fff) 92%, var(--sp-fg, #111));
  }
  .statement.off {
    border-left-color: var(--sp-danger, #b00020);
  }
  fieldset {
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-sm, 4px);
    margin: 0 0 12px;
    padding: 6px 10px;
  }
  .engine {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 3px 0;
  }
  .engine.off {
    color: var(--sp-muted, #5f5f5f);
  }
  small {
    color: var(--sp-muted, #5f5f5f);
  }
  .confirm button,
  .x {
    margin-left: 4px;
  }
  .error {
    color: var(--sp-danger, #b00020);
  }
  .lang {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  select {
    flex: 1;
  }
</style>
