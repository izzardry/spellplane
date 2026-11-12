import { mount } from 'svelte';
import { createFaceSource, parseDecklist, ScryfallCardDataSource, type CardDataSource } from './data/index';
import { mtg } from './games/index';
import { createTableScene } from './scene/index';
import { createSoloSession, openNetSession, type NetSession, type TableSession } from './session/index';
import { liveIdentity } from './session/live-identity';
import { createPageTransport, KillableTransport } from './session/transports';
import { openStores, SOLO_ROOM_ID, type LocalStores } from './store/index';
import App from './ui/App.svelte';
import { startProps } from './ui/lobby/start';
import { parseRoute } from './ui/routes';
import type { AppProps, RoomLink } from './ui/types';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');

/** Module test pages (dev and test builds only): `?harness=scene`, `?harness=ui` or `?harness=confirm` mounts that module's harness instead of the app. */
const HARNESSES = {
  scene: () => import('./scene/harness'),
  ui: () => import('./ui/harness'),
  confirm: () => import('./ui/confirm/harness'),
} as const;

const harness = __SPELLPLANE_DEBUG__ ? new URLSearchParams(location.search).get('harness') : null;

/**
 * The app (PLAN M0-P7, M1-P8): stores, card data, faces, the solo session at `#/`, the networked session for a table
 * link `#/t/<room>/<key>` (joined by the table route through `openRoom`, over Trystero, or BroadcastChannel with
 * `?transport=local`), the debug hook, then the app shell.
 */
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
  const solo = await createSoloSession({ game: mtg, cardData, roomId: SOLO_ROOM_ID, ...(stores ? { store: stores.tables } : {}) });

  const debug = __SPELLPLANE_DEBUG__ ? await import('./debug/index') : null;
  const registerSession = (session: TableSession): void => debug?.registerSessionDebug(session, { cardData, parseDecklist });
  registerSession(solo);

  const identity = stores ? liveIdentity(stores.identity) : null;

  /**
   * Join a table link with the networked session (the table route leaves it when the route goes away). A join still
   * under way when the page leaves that link's route is cancelled, so its engine and transport do not live on.
   */
  async function openRoom(link: RoomLink): Promise<NetSession> {
    if (!stores || !identity) throw new Error('this browser blocks local storage, which a table needs for your identity and your hidden cards');
    let transport: KillableTransport | null = null;
    const joining = new AbortController();
    const onHash = (): void => {
      const r = parseRoute(location.hash);
      if (r.name !== 'room' || r.room !== link.roomId || r.key !== link.roomKey) joining.abort();
    };
    window.addEventListener('hashchange', onHash);
    let session: NetSession;
    try {
      session = await openNetSession(
        {
          game: mtg,
          cardData,
          roomId: link.roomId,
          roomKey: link.roomKey,
          transport: () => (transport = new KillableTransport(createPageTransport())),
          identity: await identity.identity(),
          store: stores.tables,
        },
        {},
        joining.signal,
      );
    } finally {
      window.removeEventListener('hashchange', onHash);
    }
    if (debug) {
      registerSession(session);
      debug.registerNetDebug(session, () => transport);
    }
    const leave = session.leave.bind(session);
    // Leaving the route hands the debug hook back to the solo table (and drops the left room's `net` part).
    const left = (): void => {
      leave();
      registerSession(solo);
      debug?.clearNetDebug();
    };
    return Object.assign(session, { leave: left, dispose: left });
  }

  const props: AppProps = {
    session: solo,
    createScene: createTableScene,
    faces,
    cardData,
    game: mtg,
    parseDecklist,
    openRoom,
    diag: { createTransport: () => createPageTransport(), room: null, now: () => Date.now() },
    ...(stores && identity ? { settings: stores.settings, identity: identity.store, decks: stores.decks, start: startProps({ identity: identity.store, tables: stores.tables }) } : {}),
  };
  mount(App, { target: el, props });
}

if (harness && Object.hasOwn(HARNESSES, harness)) {
  void HARNESSES[harness as keyof typeof HARNESSES]().then((m) => m.mount(target));
} else {
  boot(target).catch((e: unknown) => {
    console.error('Spellplane failed to start', e);
    target.textContent = 'Spellplane failed to start. See the browser console for details.';
  });
}
