import { mount, type Component } from 'svelte';
import { createFaceSource, parseDecklist, ScryfallCardDataSource, type CardDataSource, type ParseResult } from './data/index';
import { mtg } from './games/index';
import { createTableScene } from './scene/index';
import { createSoloSession } from './session/index';
import { openStores, SOLO_ROOM_ID, type LocalStores, type SettingsStore } from './store/index';
import App from './ui/App.svelte';
import type { AppProps } from './ui/types';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');

/** Module test pages (dev and test builds only): `?harness=scene` or `?harness=ui` mounts that module's harness instead of the app. */
const HARNESSES = {
  scene: () => import('./scene/harness'),
  ui: () => import('./ui/harness'),
} as const;

const harness = __SPELLPLANE_DEBUG__ ? new URLSearchParams(location.search).get('harness') : null;

/**
 * Props for the app shell. `settings` and `parseDecklist` are optional AppProps the HUD (M0-P4) adds; they are
 * declared here too so this file compiles before and after that package is merged.
 */
type ShellProps = AppProps & { settings?: SettingsStore; parseDecklist?: (text: string) => ParseResult };

/** The solo table (PLAN M0-P7): stores, card data, faces, the session, the debug hook, then the app shell. */
async function boot(el: HTMLElement): Promise<void> {
  // Browser tests inject recorded card data (tests/fixtures/) so they never touch the network; dev and test builds only.
  const fixtures = __SPELLPLANE_DEBUG__ ? (await import('./debug/fixture-cards')).injectedCardData() : null;

  let stores: LocalStores | null = null;
  try {
    stores = await openStores();
  } catch (e) {
    // Without IndexedDB (blocked storage) the table still works for this page; nothing survives a reload.
    console.warn('Spellplane: local storage is unavailable, the table will not be saved', e);
  }

  const cardData: CardDataSource = fixtures ?? new ScryfallCardDataSource(stores ? {} : { cache: null });
  const faces = createFaceSource(cardData);
  const session = await createSoloSession({ game: mtg, cardData, roomId: SOLO_ROOM_ID, ...(stores ? { store: stores.tables } : {}) });

  if (__SPELLPLANE_DEBUG__) (await import('./debug/session')).registerSessionDebug(session, { cardData, parseDecklist });

  const props: ShellProps = {
    session,
    createScene: createTableScene,
    faces,
    cardData,
    game: mtg,
    parseDecklist,
    ...(stores ? { settings: stores.settings } : {}),
  };
  // TODO(integrator, M0-P4): until the HUD's App.svelte (which takes Partial<AppProps>) is merged, App is the B0 smoke
  // stage and ignores these props; after the merge the cast is redundant and can go.
  mount(App as unknown as Component<ShellProps>, { target: el, props });
}

if (harness && Object.hasOwn(HARNESSES, harness)) {
  void HARNESSES[harness as keyof typeof HARNESSES]().then((m) => m.mount(target));
} else {
  boot(target).catch((e: unknown) => {
    console.error('Spellplane failed to start', e);
    target.textContent = 'Spellplane failed to start. See the browser console for details.';
  });
}
