<!--
  The settings module test page (`?harness=settings`, dev and test builds only; PLAN M5-P5 acceptance): the settings
  panel with key remapping and the card back, the About panel, the first-run hints, and every empty and error state,
  each from the component that shows it in the app.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardRef } from '../../core/types';
  import type { FaceSource } from '../../data/types';
  import type { Keymap } from '../../games/types';
  import type { StorageStatus } from '../../store/quota';
  import type { SettingsStore } from '../../store/types';
  import type { TextureSource } from '../../util/texture';
  import About from '../about/About.svelte';
  import CardFace from '../CardFace.svelte';
  import EmptyState from '../empty/EmptyState.svelte';
  import { EMPTY_STATES, type EmptyStateId } from '../empty/states';
  import Hint from '../hints/Hint.svelte';
  import type { HintController } from '../hints/hints';
  import { keyLabel } from '../keymap';
  import type { CardBackSetting, CardBackState } from './back';
  import type { KeymapSettings } from './keys';
  import type { SettingsSection } from './sections';
  import Settings from './Settings.svelte';
  import Storage from './Storage.svelte';

  let {
    settings,
    keys,
    cardBack,
    neutralBack,
    hints,
    storage,
    faces,
    failingFaces,
    section,
  }: {
    settings: SettingsStore;
    keys: KeymapSettings;
    cardBack: CardBackSetting;
    neutralBack: TextureSource;
    hints: HintController;
    storage: () => Promise<StorageStatus>;
    faces: FaceSource;
    failingFaces: FaceSource;
    section: SettingsSection;
  } = $props();

  let keymap = $state.raw<Keymap>(untrack(() => keys.keymap()));
  let back = $state.raw<CardBackState>(untrack(() => cardBack.state()));
  onMount(() => {
    const a = keys.subscribe(() => (keymap = keys.keymap()));
    const b = cardBack.subscribe((s) => (back = s));
    keymap = keys.keymap();
    back = cardBack.state();
    return () => {
      a();
      b();
    };
  });

  const bear: CardRef = { sid: 'sid-bear' };
  const ids = Object.keys(EMPTY_STATES) as EmptyStateId[];
</script>

<main class="harness" data-testid="settings-harness" data-card-back={back.status}>
  <section class="col">
    <Settings {settings} {keys} {cardBack} {storage} {section} talkKey={keyLabel(keymap, 'talk')} placement="page" />
  </section>
  <section class="col">
    <h2>Hint</h2>
    <div data-testid="harness-hints"><Hint {hints} keyOf={(a) => keyLabel(keymap, a)} placement="inline" /></div>
    <h2>Card back preview</h2>
    <div class="cards">
      <div class="card" data-testid="back-preview" data-back={back.back?.id ?? neutralBack.id}><CardFace {faces} cardRef={null} back={back.back ?? neutralBack} alt="Hidden card" /></div>
      <div class="card" data-testid="face-ok"><CardFace {faces} cardRef={bear} alt="Grizzly Bears" /></div>
      <div class="card" data-testid="face-broken"><CardFace faces={failingFaces} cardRef={bear} alt="Grizzly Bears" /></div>
    </div>
    <h2>Storage, full</h2>
    <div data-testid="harness-storage-full"><Storage status={storage} full /></div>
    <h2>Empty and error states</h2>
    <div class="states" data-testid="harness-states">
      {#each ids as id (id)}<EmptyState {id} />{/each}
    </div>
    <h2>About</h2>
    <About />
  </section>
</main>

<style>
  .harness {
    display: grid;
    grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
    gap: 16px;
    padding: 16px;
    height: 100%;
    box-sizing: border-box;
    overflow: auto;
    font-family: system-ui, sans-serif;
  }
  .col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 8px 0 0;
    font-size: 14px;
  }
  .cards {
    display: flex;
    gap: 8px;
  }
  .card {
    width: 146px;
    height: 204px;
  }
  .states {
    display: grid;
    gap: 6px;
  }
</style>
