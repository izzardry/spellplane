<!--
  The theme picker (PLAN M4-P6; DESIGN "Themes and rendering": themes are chosen per viewer, loaded on demand as
  separate chunks and switchable mid-game without reloading; two players at the same table can use different themes).
  With `view`, it also holds the quality level and the two follow toggles (DESIGN "Themes and rendering", Renderer;
  "Camera and navigation", Follow options), which belong to this browser like the theme. A radio group over the four themes; picking one loads its chunk if needed and switches this page only. While a chunk
  loads the group says so; a chunk that cannot be loaded leaves the current theme and says why. Nothing here is modal.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { LISTED_THEME_IDS, lookOfTheme, THEME_IDS, THEME_LABELS, type ThemeId } from '../../themes/index';
  import { lookContext } from '../design/look';
  import { lookTokens } from '../design/tokens';
  import { SOUND_MODES, type SoundMode } from '../sound';
  import { THEME_BLURBS, type ThemeChoice, type ThemeChoiceState } from './theme';
  import { QUALITY_OPTIONS, qualityIdOf, type ViewPrefs } from './view';

  let {
    choice,
    onclose,
    sound,
    view,
  }: {
    choice: ThemeChoice;
    onclose?: () => void;
    sound?: { mode: SoundMode; set(mode: SoundMode): void };
    view?: { prefs: ViewPrefs; set<K extends keyof ViewPrefs>(name: K, value: ViewPrefs[K]): void };
  } = $props();

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
  /**
   * The picker offers the three looks (PLAN Milestone 7, Owner decisions: the M4 themes leave the picker; themes/index.ts
   * LISTED_THEME_IDS); a theme set otherwise (an older save, the debug hook) is shown too, so the radio group says what
   * is on the table.
   */
  const offered = $derived<ThemeId[]>(LISTED_THEME_IDS.includes(st.theme.id) ? [...LISTED_THEME_IDS] : [...LISTED_THEME_IDS, st.theme.id]);
  /** Picking a look also stores it as the HUD's look (ui/design/look.ts), so the HUD skin switches with the table. */
  const looks = lookContext();

  const inputs: Partial<Record<ThemeId, HTMLInputElement>> = {};

  function pick(id: ThemeId): void {
    picking = id;
    // A failed load is reported through the state (st.error); the theme shown stays.
    const look = lookOfTheme(id);
    const done = look && looks ? looks.set(look) : choice.set(id);
    done.catch(async () => {
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
    <h2>Look</h2>
    {#if onclose}<button type="button" class="x" data-testid="theme-close" onclick={onclose} aria-label="Close">×</button>{/if}
  </header>
  <fieldset data-testid="theme-picker">
    <legend>Look of the table and the controls, for this browser</legend>
    {#each offered as id (id)}
      {@const look = lookOfTheme(id)}
      <label class="option" data-testid="theme-option" data-theme={id} data-look={look} class:current={st.theme.id === id}>
        <input type="radio" name="sp-theme" value={id} checked={checked === id} bind:this={inputs[id]} onchange={() => pick(id)} />
        {#if look}
          {@const t = lookTokens(look)}
          <span class="swatch" aria-hidden="true" style:background={t.colour.mat} style:border-color={t.colour.frame}><i style:background={t.colour.panel}></i><i style:background={t.colour.accent}></i></span>
        {/if}
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
  {#if view}
    <label class="sound">
      Quality
      <select data-testid="theme-quality" aria-describedby="sp-quality-hint" value={view.prefs.quality} onchange={(e) => view.set('quality', qualityIdOf((e.currentTarget as HTMLSelectElement).value))}>
        {#each QUALITY_OPTIONS as q (q.id)}<option value={q.id}>{q.label}</option>{/each}
      </select>
    </label>
    <p class="hint" id="sp-quality-hint">Lower levels drop shadows first, then effects such as glow.</p>
    <fieldset data-testid="theme-follow">
      <legend>Camera</legend>
      <label class="check">
        <input type="checkbox" data-testid="follow-stack" checked={view.prefs.followStack} onchange={(e) => view.set('followStack', (e.currentTarget as HTMLInputElement).checked)} />
        Follow the stack
      </label>
      <label class="check">
        <input type="checkbox" data-testid="follow-active" checked={view.prefs.followActive} onchange={(e) => view.set('followActive', (e.currentTarget as HTMLInputElement).checked)} />
        Follow the active player
      </label>
    </fieldset>
  {/if}
  {#if st.loading}<p class="status" role="status" data-testid="theme-loading">Loading {THEME_LABELS[st.loading]}…</p>{/if}
  {#if st.error}<p class="error" role="alert" data-testid="theme-error">{st.error}</p>{/if}
  <p class="note">Only this browser changes: the other players keep their own themes, and the game goes on.</p>
</section>

<style>
  .theme {
    background: var(--ds-panel-raised, var(--sp-surface, #fff));
    color: var(--ds-ink, var(--sp-fg, #111));
    border: 1px solid var(--ds-border, var(--sp-border, #8c8c8c));
    border-radius: var(--ds-radius-md, 8px);
    box-shadow: var(--ds-elevation-pop, none);
    padding: var(--sp-space-lg, 16px);
    font: var(--ds-type-small, 12px) / 1.45 var(--ds-font-body, system-ui);
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
    font-family: var(--ds-font-heading, inherit);
    font-variant: var(--ds-heading-variant, normal);
    font-size: var(--ds-type-title, 18px);
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
  .swatch {
    display: inline-flex;
    align-self: center;
    gap: 3px;
    padding: 4px;
    border: 2px solid;
    border-radius: 6px;
    flex: none;
  }
  .swatch i {
    width: 10px;
    height: 14px;
    border-radius: 2px;
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
    color: var(--ds-muted, var(--sp-muted, #5f5f5f));
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
  .hint {
    margin: 2px 0 0;
    color: var(--sp-muted, #5f5f5f);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 3px 0;
    cursor: pointer;
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
