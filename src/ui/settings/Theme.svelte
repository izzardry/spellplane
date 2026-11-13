<!--
  The theme picker (PLAN M4-P6; DESIGN "Themes and rendering": themes are chosen per viewer, loaded on demand as
  separate chunks and switchable mid-game without reloading; two players at the same table can use different themes).
  A radio group over the four themes; picking one loads its chunk if needed and switches this page only. While a chunk
  loads the group says so; a chunk that cannot be loaded leaves the current theme and says why. Nothing here is modal.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { THEME_IDS, THEME_LABELS, type ThemeId } from '../../themes/index';
  import { SOUND_MODES, type SoundMode } from '../sound';
  import { THEME_BLURBS, type ThemeChoice, type ThemeChoiceState } from './theme';

  let { choice, onclose, sound }: { choice: ThemeChoice; onclose?: () => void; sound?: { mode: SoundMode; set(mode: SoundMode): void } } = $props();

  let st = $state.raw<ThemeChoiceState>(untrack(() => choice.state()));
  /** The radio the viewer picked last, shown checked while its chunk loads. */
  let picking = $state<ThemeId | null>(null);
  onMount(() =>
    choice.subscribe((next) => {
      st = next;
      if (next.loading === null) picking = null;
    }),
  );

  const checked = $derived<ThemeId>(st.loading ?? picking ?? st.theme.id);

  const inputs: Partial<Record<ThemeId, HTMLInputElement>> = {};

  function pick(id: ThemeId): void {
    picking = id;
    // A failed load is reported through the state (st.error); the theme shown stays.
    choice.set(id).catch(async () => {
      picking = null;
      // A load that fails fast (a cached failed import) can take `checked` from the shown theme to the pick and back
      // inside one update, so Svelte never re-applies it and the browser keeps the clicked radio checked. Put the DOM
      // back to the theme shown.
      await tick();
      for (const t of THEME_IDS) {
        const el = inputs[t];
        if (el) el.checked = t === checked;
      }
    });
  }
</script>

<section class="theme" data-testid="theme-settings" aria-label="Theme settings" data-theme={st.theme.id} aria-busy={st.loading !== null}>
  <header>
    <h2>Theme</h2>
    {#if onclose}<button type="button" class="x" data-testid="theme-close" onclick={onclose} aria-label="Close">×</button>{/if}
  </header>
  <fieldset data-testid="theme-picker">
    <legend>Table theme for this browser</legend>
    {#each THEME_IDS as id (id)}
      <label class="option" data-testid="theme-option" data-theme={id} class:current={st.theme.id === id}>
        <input type="radio" name="sp-theme" value={id} checked={checked === id} bind:this={inputs[id]} onchange={() => pick(id)} />
        <span>
          {THEME_LABELS[id]}
          <small>— {THEME_BLURBS[id]}{#if st.loading === id}; loading…{/if}</small>
        </span>
      </label>
    {/each}
  </fieldset>
  {#if sound}
    <label class="sound">
      Sound
      <select data-testid="theme-sound" value={sound.mode} onchange={(e) => sound.set((e.currentTarget as HTMLSelectElement).value as SoundMode)}>
        {#each SOUND_MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </label>
  {/if}
  {#if st.loading}<p class="status" role="status" data-testid="theme-loading">Loading {THEME_LABELS[st.loading]}…</p>{/if}
  {#if st.error}<p class="error" role="alert" data-testid="theme-error">{st.error}</p>{/if}
  <p class="note">Only this browser changes: the other players keep their own themes, and the game goes on.</p>
</section>

<style>
  .theme {
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: var(--sp-radius-lg, 8px);
    box-shadow: var(--sp-hud-shadow, none);
    padding: var(--sp-space-lg, 16px);
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
    width: min(340px, calc(100vw - 32px));
    box-sizing: border-box;
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
  .x {
    font: inherit;
    font-size: 16px;
    background: none;
    color: inherit;
    border: none;
    cursor: pointer;
  }
  fieldset {
    margin: 8px 0 0;
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: var(--sp-radius-sm, 4px);
    padding: 4px 8px 8px;
  }
  legend {
    padding: 0 4px;
  }
  .option {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 3px 0;
    cursor: pointer;
  }
  .option.current span {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  small {
    font-weight: var(--sp-font-weight, 400);
    color: var(--sp-muted, #5f5f5f);
  }
  .status {
    margin: 8px 0 0;
  }
  .sound {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 8px 0 0;
  }
  .sound select {
    font: inherit;
  }
  .error {
    margin: 8px 0 0;
    color: var(--sp-danger, #b3261e);
  }
  .note {
    margin: 8px 0 0;
    color: var(--sp-muted, #5f5f5f);
  }
</style>
