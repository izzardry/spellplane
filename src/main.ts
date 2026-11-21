import { mount } from 'svelte';
import { createFaceSource, createSetDataSource, generatePack, parseDecklist, ScryfallCardDataSource, type CardDataSource, type SetDataSource } from './data/index';
import { mtg } from './games/index';
import { createTableScene } from './scene/index';
import { registerBaseRender } from './scene/lifecycle';
import { createSoloSession, LONE_WAIT_MS, openNetSession, openSpectatorSession, type NetSession, type TableSession } from './session/index';
import { liveIdentity } from './session/live-identity';
import { randomNickname } from './ui/lobby/names';
import { createPageTransport, KillableTransport, pageTransportKind } from './session/transports';
import { createSetCache, openStores, requestPersistentStorage, SOLO_ROOM_ID, storageStatus, type LocalStores } from './store/index';
import App from './ui/App.svelte';
import { startProps } from './ui/lobby/start';
import { HARNESSES, isHarness } from './ui/harnesses';
import { createMatchmaker } from './session/matchmaker';
import { createsMatchTable, matchSessionInternals } from './session/match-room';
import { createComputerGame, resumeComputerGame } from './session/computer';
import { FakeAppUpdate, pageWorker } from './ui/storage/worker';
import type { AppUpdate } from './ui/update';
import { registerDebug } from './util/debug';
import { parseRoute } from './ui/routes';
import { flags } from './util/flags';
import { FAKE_SPEECH, SPEECH_ENGINES, type MediaDevicesLike } from './voice/index';
import type { AppProps, RoomLink, StartPageProps } from './ui/types';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');

const harness = __SPELLPLANE_DEBUG__ ? new URLSearchParams(location.search).get('harness') : null;

/**
 * The app (PLAN M0-P7, M1-P8; M8-C, contracts.md Part C): stores (with M8's games, ratings and matches), card data,
 * faces, one matchmaker, the sandbox's solo session (eager only at `#/solo`), practice and computer tables, the
 * networked session for a table link `#/t/<room>/<key>` (joined by the table route through `openRoom`, over Trystero,
 * or BroadcastChannel with `?transport=local`), the debug hook, then the app. `#/` is Home.
 */
async function boot(el: HTMLElement): Promise<void> {
  if (__SPELLPLANE_PREVIEW__) previewLabel();
  // Browser tests inject recorded card data (tests/fixtures/) so they never touch the network; dev and test builds only.
  const fixtures = __SPELLPLANE_DEBUG__ ? (await import('./debug/fixture-cards')).injectedCardData() : null;
  // A test that injects card data but no set data (the M0/M1 gates) gets an empty set source, never MTGJSON.
  const fixtureSets = __SPELLPLANE_DEBUG__
    ? await import('./debug/fixture-sets').then((m) => m.injectedSets() ?? (fixtures ? m.fixtureSetSource([]) : null))
    : null;

  // Offline and updates (M5-P3): the service worker that precaches the app shell, and the update it holds back until
  // the page is between games. Browser tests drive a fake with `?update=fake` (dev and test builds only).
  const update = appUpdate();
  if (__SPELLPLANE_DEBUG__) registerDebug({ storage: { status: () => storageStatus(), update: () => update?.status() ?? 'current' } });
  // The app asks for persistent storage but never depends on it (DESIGN "Card data and images", Caching); browsers
  // that prompt for it ask here, the others decide by themselves. The start page explains it when it was not granted.
  void requestPersistentStorage();

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

  const debug = __SPELLPLANE_DEBUG__ ? await import('./debug/index') : null;
  // Input counters for the M7 gate's "no key pressed" (M7-C, debug/input.ts).
  debug?.registerInputDebug();
  // The lifecycle counters are readable on every page, also before a table scene mounts (contracts.md Part C).
  if (debug) registerBaseRender();
  const registerSession = (session: TableSession): void => {
    debug?.registerSessionDebug(session, { cardData, parseDecklist });
    debug?.registerDraftDebug(session);
    debug?.registerSpeechDebug(session);
  };

  // The table sandbox (`#/solo`, contracts.md Part C): created eagerly only when the page opens there, else the first
  // time the route shows; it lives for the page (decision M8-C).
  let sandbox: Promise<TableSession> | null = null;
  let sandboxSession: TableSession | null = null;
  const openSandbox = (): Promise<TableSession> => {
    sandbox ??= createSoloSession({ game: mtg, cardData, roomId: SOLO_ROOM_ID, ...(stores ? { store: stores.tables } : {}) }).then((s) => {
      sandboxSession = s;
      registerSession(s);
      return s;
    });
    return sandbox;
  };
  const solo = parseRoute(location.hash).name === 'solo' ? await openSandbox() : null;
  /** After a table route went away, the hook points at the sandbox again when there is one. */
  const backToSandbox = (): void => {
    if (sandboxSession) registerSession(sandboxSession);
  };

  // A practice table (`#/p/<room>`, computer.md section 11): a solo session with its own room id, saved like any game.
  const openPractice = async (roomId: string): Promise<TableSession> => {
    const s = await createSoloSession({ game: mtg, cardData, roomId, ...(stores ? { store: stores.tables } : {}) });
    registerSession(s);
    const dispose = s.dispose.bind(s);
    return Object.assign(s, {
      dispose: () => {
        dispose();
        backToSandbox();
      },
    });
  };

  const identity = stores ? liveIdentity(stores.identity) : null;

  // One matchmaker per page (matchmaking.md 2.13; a stub with phase `off` until M8-P7).
  // [M8-P7] The profile's own games store and identity: the matchmaker opens no second IndexedDB connection.
  const matchmaker = stores ? createMatchmaker({ settings: stores.settings, decks: stores.decks, ratings: stores.ratings, matches: stores.matches, games: stores.games, identityStore: stores.identity }) : null;
  // The page's clock for networked sessions; specs pin it with `__spellplane.net.setClock` (dev and test builds).
  const clock = debug?.pageClock() ?? null;
  if (debug && matchmaker) debug.registerM8Debug({ matchmaker, decks: stores?.decks ?? null, games: stores?.games ?? null });

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
  async function openRoom(link: RoomLink, as: { watch?: boolean; signal?: AbortSignal } = {}): Promise<NetSession> {
    if (!stores || !identity) throw new Error('this browser blocks local storage, which a table needs for your identity and your hidden cards');
    // A matched room (matchmaking.md 2.9; contracts.md Part D): seat 0 of its MatchRecord creates the table, every
    // other member never sits alone; so does a browser that opens a re-invite link (`rejoin`).
    const me = await identity.identity();
    // A fresh browser that opens a link sits down under a made-up two-word nickname, as Home gives one on a first visit
    // (journey.md J27 and 4.9; gate M8 finding F9: two guests were both "Player"). A spectator needs none.
    if (!as.watch && !me.nickname.trim()) await identity.store.setNickname(randomNickname()).catch(() => undefined);
    const record = await stores.matches.get(link.roomId).catch(() => null);
    const here = parseRoute(location.hash);
    const rejoin = here.name === 'room' && here.room === link.roomId && !!here.rejoin;
    const creator = record ? createsMatchTable(record, me.peerId) : createdHere(link.roomId);
    const neverAlone = (!!record && !creator) || rejoin;
    let transport: KillableTransport | null = null;
    const joining = new AbortController();
    // The route gave the join up (RoomRoute: it went away, or the link or watching changed).
    if (as.signal?.aborted) joining.abort();
    else as.signal?.addEventListener('abort', () => joining.abort(), { once: true });
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
        // A matched room's table opens in its queue's format (a 4 FFA has four chairs; session/match-room.ts).
        ...(record ? { format: matchSessionInternals(record, me.peerId).format } : {}),
        transport: () => (transport = new KillableTransport(createPageTransport())),
        identity: me,
        ...(clock ? { now: () => clock.now() } : {}),
        store: stores.tables,
        sets,
        generatePack,
      };
      // `#/t/<room>/<key>/watch`: a spectator without a chair, keeping nothing in the local store (M3-P5).
      // Live voice (M3-P3): the microphone is acquired only when the player clicks "Join voice". Dictation (M3-P4): the
      // fake engine replaces the others with `?speech=fake`. A spectator only shows the players' captions.
      const voice = { media: pageMedia(), settings: stores.settings, engines: flags().speech === 'fake' ? [FAKE_SPEECH] : Object.values(SPEECH_ENGINES) };
      session = as.watch
        ? await openSpectatorSession({ ...options, role: 'spectator', voice }, joining.signal)
        : await openNetSession(
            { ...options, voice },
            // BroadcastChannel peers connect at once; over Trystero they come up seconds after the join.
            // [M8-P7] A member of a matched room sits in its planned chair (teams and seats follow the offer).
            { createdHere: creator, neverAlone, loneWaitMs: pageTransportKind() === 'local' ? 0 : LONE_WAIT_MS, ...(record ? { preferSeat: matchSessionInternals(record, me.peerId).preferSeat } : {}) },
            joining.signal,
          );
    } finally {
      window.removeEventListener('hashchange', onHash);
    }
    if (debug) {
      registerSession(session);
      debug.registerNetDebug(session, () => transport, clock ?? undefined);
    }
    const leave = session.leave.bind(session);
    // Leaving the route hands the debug hook back to the sandbox (and drops the left room's `net` part).
    let leaving: Promise<void> | null = null;
    const left = (): Promise<void> => {
      if (!leaving) {
        leaving = leave();
        backToSandbox();
        debug?.clearNetDebug();
      }
      return leaving;
    };
    return Object.assign(session, {
      leave: left,
      dispose: () => {
        void left();
      },
    });
  }

  // `openRoom` reaches the table route (ui/lobby/RoomRoute.svelte, RoomOpener) through the props App hands it; it is
  // not part of the ui/types.ts contract (decision M1-P8).
  const start = stores && identity ? createdRooms(startProps({ identity: identity.store, tables: stores.tables }), markCreated) : null;
  const props: Partial<AppProps> & { openRoom: typeof openRoom; newRoom?: () => RoomLink; registerTable?: (s: TableSession) => () => void } = {
    ...(solo ? { session: solo } : {}),
    openSandbox,
    openPractice,
    openComputer: (roomId: string) => resumeComputerGame(roomId).catch(() => createComputerGame({ roomId, deckId: null })),
    createScene: createTableScene,
    faces,
    cardData,
    game: mtg,
    parseDecklist,
    openRoom,
    // Dev and test builds: a computer table's human session answers the debug hook while it is shown (ui/computer/ComputerRoute.svelte).
    ...(debug
      ? {
          registerTable: (s: TableSession) => {
            registerSession(s);
            return backToSandbox;
          },
        }
      : {}),
    sets,
    diag: { createTransport: () => createPageTransport(), room: null, now: () => Date.now() },
    ...(update ? { update } : {}),
    ...(stores && identity && start ? { settings: stores.settings, identity: identity.store, decks: stores.decks, start, newRoom: () => start.newRoom() } : {}),
    ...(stores ? { games: stores.games, ratings: stores.ratings, matches: stores.matches } : {}),
    ...(matchmaker ? { matchmaker } : {}),
  };
  mount(App, { target: el, props });
}

/** A small fixed label so the owner always knows the preview build from the live site (M7 fast feedback). */
function previewLabel(): void {
  const tag = document.createElement('div');
  tag.textContent = 'Preview';
  tag.setAttribute('aria-hidden', 'true');
  tag.style.cssText =
    'position:fixed;left:50%;bottom:4px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;' +
    'font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:4px 8px;' +
    'border-radius:999px;background:#b4232a;color:#fff;opacity:.85';
  document.body.append(tag);
}

/** The service worker's AppUpdate, a test's fake one (`?update=fake`, dev and test builds), or null without a worker. */
function appUpdate(): AppUpdate | null {
  if (__SPELLPLANE_DEBUG__ && new URLSearchParams(location.search).get('update') === 'fake') {
    const fake = new FakeAppUpdate();
    (window as Window & { __spellplaneFakeUpdate?: FakeAppUpdate }).__spellplaneFakeUpdate = fake;
    return fake;
  }
  // The preview build runs no worker: the live site's worker owns the origin's offline caches.
  if (__SPELLPLANE_PREVIEW__) return null;
  return pageWorker({ production: import.meta.env.MODE === 'production', dev: import.meta.env.DEV, search: location.search, base: import.meta.env.BASE_URL });
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

if (isHarness(harness)) {
  void HARNESSES[harness]().then((m) => m.mount(target));
} else {
  boot(target).catch((e: unknown) => {
    console.error('Spellplane failed to start', e);
    target.textContent = 'Spellplane failed to start. See the browser console for details.';
  });
}
