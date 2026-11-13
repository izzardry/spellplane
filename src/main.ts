import { mount } from 'svelte';
import { createFaceSource, createSetDataSource, generatePack, parseDecklist, ScryfallCardDataSource, type CardDataSource, type SetDataSource } from './data/index';
import { mtg } from './games/index';
import { createTableScene } from './scene/index';
import { createSoloSession, LONE_WAIT_MS, openNetSession, openSpectatorSession, type NetSession, type TableSession } from './session/index';
import { liveIdentity } from './session/live-identity';
import { createPageTransport, KillableTransport, pageTransportKind } from './session/transports';
import { createSetCache, openStores, SOLO_ROOM_ID, type LocalStores } from './store/index';
import App from './ui/App.svelte';
import { startProps } from './ui/lobby/start';
import { parseRoute } from './ui/routes';
import { flags } from './util/flags';
import { FAKE_SPEECH, SPEECH_ENGINES, type MediaDevicesLike } from './voice/index';
import type { AppProps, RoomLink, StartPageProps } from './ui/types';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');

/** Module test pages (dev and test builds only): `?harness=scene`, `?harness=ui`, `?harness=confirm` or `?harness=voice` mounts that module's harness instead of the app. */
const HARNESSES = {
  scene: () => import('./scene/harness'),
  ui: () => import('./ui/harness'),
  confirm: () => import('./ui/confirm/harness'),
  voice: () => import('./ui/voice/harness'),
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
  // A test that injects card data but no set data (the M0/M1 gates) gets an empty set source, never MTGJSON.
  const fixtureSets = __SPELLPLANE_DEBUG__
    ? await import('./debug/fixture-sets').then((m) => m.injectedSets() ?? (fixtures ? m.fixtureSetSource([]) : null))
    : null;

  let stores: LocalStores | null = null;
  try {
    stores = await openStores();
  } catch (e) {
    // Without IndexedDB (blocked storage) the table still works for this page; nothing survives a reload.
    console.warn('Spellplane: local storage is unavailable, the table will not be saved', e);
  }

  const cardData: CardDataSource = fixtures ?? new ScryfallCardDataSource(stores ? {} : { cache: null });
  // MTGJSON booster data for drafts and the lobby's set picker (M2-P1), cached in the `sets` store; injected fixtures in tests.
  const sets: SetDataSource = fixtureSets ?? createSetDataSource({ cache: stores ? createSetCache(stores.db) : null });
  const faces = createFaceSource(cardData);
  const solo = await createSoloSession({ game: mtg, cardData, roomId: SOLO_ROOM_ID, ...(stores ? { store: stores.tables } : {}) });

  const debug = __SPELLPLANE_DEBUG__ ? await import('./debug/index') : null;
  const registerSession = (session: TableSession): void => {
    debug?.registerSessionDebug(session, { cardData, parseDecklist });
    debug?.registerDraftDebug(session);
    debug?.registerSpeechDebug(session);
  };
  registerSession(solo);

  const identity = stores ? liveIdentity(stores.identity) : null;

  /**
   * Rooms this tab created on its start page (kept for the tab, so a reload still knows): their creator may sit alone
   * at once, while a browser that opened a shared link first waits for the room's table (decision M1-P8).
   */
  const CREATED = 'spellplane.created.';
  const markCreated = (roomId: string): void => {
    try {
      sessionStorage.setItem(CREATED + roomId, '1');
    } catch {
      /* storage blocked: the creator then waits like a joiner */
    }
  };
  const createdHere = (roomId: string): boolean => {
    try {
      return sessionStorage.getItem(CREATED + roomId) === '1';
    } catch {
      return false;
    }
  };

  /**
   * Join a table link with the networked session (the table route leaves it when the route goes away). A join still
   * under way when the page leaves that link's route is cancelled, so its engine and transport do not live on.
   */
  async function openRoom(link: RoomLink, as: { watch?: boolean } = {}): Promise<NetSession> {
    if (!stores || !identity) throw new Error('this browser blocks local storage, which a table needs for your identity and your hidden cards');
    let transport: KillableTransport | null = null;
    const joining = new AbortController();
    const onHash = (): void => {
      const r = parseRoute(location.hash);
      if (r.name !== 'room' || r.room !== link.roomId || r.key !== link.roomKey || (r.watch === true) !== (as.watch === true)) joining.abort();
    };
    window.addEventListener('hashchange', onHash);
    let session: NetSession;
    try {
      const options = {
        game: mtg,
        cardData,
        roomId: link.roomId,
        roomKey: link.roomKey,
        transport: () => (transport = new KillableTransport(createPageTransport())),
        identity: await identity.identity(),
        store: stores.tables,
        sets,
        generatePack,
      };
      // `#/t/<room>/<key>/watch`: a spectator without a chair, keeping nothing in the local store (M3-P5).
      session = as.watch
        ? await openSpectatorSession({ ...options, role: 'spectator' }, joining.signal)
        : await openNetSession(
            {
              ...options,
              // Live voice (M3-P3): the microphone is acquired only when the player clicks "Join voice".
              voice: { media: pageMedia(), settings: stores.settings, engines: flags().speech === 'fake' ? [FAKE_SPEECH] : Object.values(SPEECH_ENGINES) },
            },
            // BroadcastChannel peers connect at once; over Trystero they come up seconds after the join.
            { createdHere: createdHere(link.roomId), loneWaitMs: pageTransportKind() === 'local' ? 0 : LONE_WAIT_MS },
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

  // `openRoom` reaches the table route (ui/lobby/RoomRoute.svelte, RoomOpener) through the props App hands it; it is
  // not part of the ui/types.ts contract (decision M1-P8).
  const props: AppProps & { openRoom: typeof openRoom } = {
    session: solo,
    createScene: createTableScene,
    faces,
    cardData,
    game: mtg,
    parseDecklist,
    openRoom,
    sets,
    diag: { createTransport: () => createPageTransport(), room: null, now: () => Date.now() },
    ...(stores && identity ? { settings: stores.settings, identity: identity.store, decks: stores.decks, start: createdRooms(startProps({ identity: identity.store, tables: stores.tables }), markCreated) } : {}),
  };
  mount(App, { target: el, props });
}

/** The page's media devices; without them (an insecure page) joining voice says so instead of failing silently. */
function pageMedia(): MediaDevicesLike {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) return navigator.mediaDevices;
  const missing = (): Promise<never> => Promise.reject(Object.assign(new Error('this page has no microphone access'), { name: 'NotFoundError' }));
  return { getUserMedia: missing, enumerateDevices: () => Promise.resolve([]) };
}

/** Start-page props whose new rooms are recorded as created by this tab. */
function createdRooms(start: StartPageProps, mark: (roomId: string) => void): StartPageProps {
  return {
    ...start,
    newRoom: () => {
      const link = start.newRoom();
      mark(link.roomId);
      return link;
    },
  };
}

if (harness && Object.hasOwn(HARNESSES, harness)) {
  void HARNESSES[harness as keyof typeof HARNESSES]().then((m) => m.mount(target));
} else {
  boot(target).catch((e: unknown) => {
    console.error('Spellplane failed to start', e);
    target.textContent = 'Spellplane failed to start. See the browser console for details.';
  });
}
