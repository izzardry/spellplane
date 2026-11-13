<!--
  The settings at `#/settings`, away from a table (PLAN M5-P5 settings consolidation): the same panel as on the table,
  writing this browser's settings, which a table reads when it opens.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Keymap } from '../../games/types';
  import type { SettingsStore } from '../../store/types';
  import { soundModeOf, type SoundMode } from '../sound';
  import { CardBackSetting } from './back';
  import { KeymapSettings } from './keys';
  import { keyLabel } from '../keymap';
  import Settings from './Settings.svelte';
  import { themeContext } from './theme';
  import { ViewSettings, type ViewPrefs } from './view';

  let { settings, keymap }: { settings?: SettingsStore | undefined; keymap: Keymap } = $props();

  const keys = new KeymapSettings(untrack(() => keymap), untrack(() => settings));
  const cardBack = new CardBackSetting({ settings: untrack(() => settings) });
  const view = new ViewSettings(untrack(() => settings));
  let prefs = $state.raw<ViewPrefs>(view.state());
  let sound = $state<SoundMode>('theme');
  let talkKey = $state<string | null>(untrack(() => keyLabel(keymap, 'talk')));

  onMount(() => {
    const offView = view.subscribe((p) => (prefs = p));
    const offKeys = keys.subscribe(() => (talkKey = keyLabel(keys.keymap(), 'talk')));
    void view.refresh();
    void keys.load();
    void cardBack.refresh();
    void settings
      ?.get('sound')
      .then((m) => (sound = soundModeOf(m)))
      .catch(() => {});
    return () => {
      offView();
      offKeys();
      view.dispose();
      cardBack.dispose();
    };
  });

  function setSound(mode: SoundMode): void {
    sound = mode;
    void settings?.set('sound', mode).catch(() => {});
  }
</script>

<h1>Settings</h1>
{#if !settings}<p role="alert">This browser blocks local storage, so changes last only until the page reloads.</p>{/if}
<Settings
  {settings}
  {keys}
  {cardBack}
  themeChoice={themeContext()}
  sound={{ mode: sound, set: setSound }}
  view={{ prefs, set: (name, value) => void view.set(name, value).catch(() => {}) }}
  {talkKey}
  placement="page"
/>
