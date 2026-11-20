/**
 * Scene module test page (`?harness=scene`, dev and test builds only; see src/main.ts and docs/DECISIONS.md M0).
 * Renders a synthetic TableState with placeholder faces and applies the scene's actions with a local reducer stub,
 * so Playwright can drive the real scene before the session (M0-P7) exists.
 *
 * URL: `?harness=scene&scenario=demo|bench|empty&viewer=s0|s1|none`. `bench` renders 300 cards.
 * Multi-seat tables (M3-P1): `&format=ffa3|ffa4|2hg&viewer=s0..s3` lays out the Magic table of that format with every
 * chair taken (scenario ignored). `&rig=ego` opens in the ego rig at its default view (M5-P7's ego framing).
 * Keys: 0 fit, Home or 1 own side, 2, 3, 4 the seats clockwise from the viewer, P switches the camera rig (M4-P1),
 * Escape closes an opened pile.
 * Test API: window.__spellplane (state, dispatch, cards, camera, lines, frameStats) and window.__sceneHarness.
 */
import type { Action, ActionDraft } from '../core/actions';
import type { InstanceId, TableState } from '../core/types';
import type { FaceSource, ImageTier } from '../data/types';
import type { TableLayout } from '../games/types';
import { paper } from '../themes/paper';
import { loadTheme, type ThemeId } from '../themes/index';
import { createBuilderSurfaceImpl } from './builder';
import { createDraftSurfaceImpl } from './draft';
import { createStage } from './stage';
import { renderArenaStill } from './still';
import { registerDebug } from '../util/debug';
import type { Format } from '../core/types';
import { TABLE_FORMAT_SEATS } from '../core/teams';
import { mtgLayout } from '../games/mtg/layout';
import { buildFormatState, buildHarnessState, harnessFaces, harnessGame, harnessLayout, harnessPrivateFaces, harnessReduce, type HarnessScenario } from './harness-fixture';
import type { DropResult } from './snap';
import { hoveredStackItem } from './stack';
import { createTableScene, type SceneDebugCard } from './table-scene';
import type { CameraRig, ScreenPoint, TablePoint, TableScene, ViewState } from './types';

export interface SceneHarnessApi {
  /** First frame drawn and every requested texture uploaded. */
  ready(): boolean;
  /** No drag, camera motion or card animation in progress. */
  idle(): boolean;
  layout(): TableLayout;
  toScreen(x: number, y: number, z?: number): ScreenPoint | null;
  toTable(x: number, y: number): TablePoint | null;
  /** Drafts the scene dispatched, in order. */
  actions(): ActionDraft[];
  /** Scene events (hover, selectionChange, pileOpen, inspect, contextMenu), in order. */
  events(): { type: string; args: unknown[] }[];
  view(): ViewState;
  setView(v: Partial<ViewState>): void;
  lastDrop(): DropResult | null;
  cards(): SceneDebugCard[];
  cardAt(x: number, y: number): InstanceId | null;
  zoneAt(x: number, y: number): string | null;
  camera: TableScene['camera'];
  /** Every FaceSource request the scene made, in order: face key and tier. */
  faceRequests(): { key: string; tier: ImageTier }[];
  /** While on, the scene's drafts are recorded but not applied (an asynchronous confirmation); off applies them. */
  hold(on: boolean): void;
  /** Switch to Paper with this preferred camera rig (a theme switch: its default rig applies until the viewer chose one). */
  themeWithRig(rig: CameraRig): void;
  /** The stack item the scene reports as hovered (scene/stack.ts hoveredStackItem: the lane or the badge's list). */
  stackHover(): string | null;
  /** Dispose the scene (leak checks): also releases the harness's own listeners. */
  dispose(): void;
  /** Dispose the scene if it is mounted and mount a new one on the same page (mount / dispose soak; M7-P1). */
  remount(): void;
  /** Mount another of the scene module's WebGL surfaces (draft table, builder table, the flow's stage) on its own host (M7-P1). */
  mountSurface(kind: 'draft' | 'builder' | 'stage'): void;
  /** Dispose the surface mountSurface mounted. */
  disposeSurface(): void;
  /**
   * The arena still of a look (scene/still.ts; M7-P1): the Blob's size and the still's pixel size, the mean difference
   * between neighbouring pixels of the unsoftened frame and of the still scaled up to the frame's size by the browser,
   * and whether the still contains card-face colours. `noWebgl` makes WebGL unavailable for this call.
   */
  arenaStill(theme: string, width: number, noWebgl?: boolean): Promise<ArenaStillReport | null>;
}

/** What `arenaStill` reports (tests/e2e/scene/still.spec.ts). */
export interface ArenaStillReport {
  bytes: number;
  type: string;
  width: number;
  height: number;
  frame: { width: number; height: number };
  sharpDiff: number;
  softDiff: number;
}

declare global {
  interface Window {
    __sceneHarness?: SceneHarnessApi;
  }
}

/** Mean absolute difference between horizontally and vertically neighbouring pixels (RGB), 0..255. */
function neighbourDiff(c: HTMLCanvasElement): number {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  let n = 0;
  for (let y = 0; y < c.height - 1; y++)
    for (let x = 0; x < c.width - 1; x++) {
      const i = (y * c.width + x) * 4;
      const r = i + 4;
      const b = i + c.width * 4;
      for (let k = 0; k < 3; k++) s += Math.abs(d[i + k]! - d[r + k]!) + Math.abs(d[i + k]! - d[b + k]!);
      n += 6;
    }
  return n ? s / n : 0;
}

let surface: { dispose(): void; host: HTMLElement } | null = null;

export function mount(target: HTMLElement): void {
  /** What this mount added to the window, released by `dispose`. */
  const cleanups: (() => void)[] = [];
  let mounted = true;
  const params = new URLSearchParams(location.search);
  const scenario = (['demo', 'bench', 'empty'] as const).find((s) => s === params.get('scenario')) ?? ('demo' satisfies HarnessScenario);
  const viewerParam = params.get('viewer');
  const format = (['ffa3', 'ffa4', '2hg'] as const).find((f) => f === params.get('format')) ?? null;
  const seatCount = format ? TABLE_FORMAT_SEATS[format] : 2;
  const viewerSeat = viewerParam === 'none' ? null : viewerParam && /^s[0-3]$/.test(viewerParam) && Number(viewerParam.slice(1)) < seatCount ? viewerParam : 's0';

  target.textContent = '';
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', overflow: 'hidden', background: '#fff' });
  const label = document.createElement('div');
  label.textContent = `harness: scene (${format ?? scenario})`;
  Object.assign(label.style, { position: 'fixed', left: '8px', bottom: '6px', font: '11px system-ui, sans-serif', color: '#8a8a8a', pointerEvents: 'none', letterSpacing: '0.04em', zIndex: '1' });
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  target.append(host, label);

  const layout = format ? mtgLayout(format) : harnessLayout();
  const game = format ? { ...harnessGame, layout: (f: Format) => (f === format ? mtgLayout(f) : harnessLayout()) } : harnessGame;
  let state: TableState = format ? buildFormatState(format, layout, seatCount) : buildHarnessState({ scenario });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let view: ViewState = { selection: [], hovered: null, privateFaces: viewerSeat === 's0' && !format ? harnessPrivateFaces() : {}, reducedMotion: motionQuery.matches, pings: [], openPile: null };
  const actions: ActionDraft[] = [];
  const events: { type: string; args: unknown[] }[] = [];
  let cid = 0;
  let held: Action[] | null = null;
  const faceRequests: { key: string; tier: ImageTier }[] = [];
  const faces: FaceSource = {
    faceFor(ref, faceIndex, tier) {
      faceRequests.push({ key: `${ref.sid}#${faceIndex}`, tier });
      return harnessFaces.faceFor(ref, faceIndex, tier);
    },
  };

  const apply = (a: Action) => {
    state = harnessReduce(state, a);
    scene.update(state, view);
  };
  const setView = (v: Partial<ViewState>) => {
    view = { ...view, ...v };
    scene.update(state, view);
  };
  const log = (type: string) => (...args: unknown[]) => events.push({ type, args: JSON.parse(JSON.stringify(args)) as unknown[] });

  const startRig = params.get('rig') === 'ego' ? ('ego' as const) : params.get('rig') === 'birdseye' ? ('birdseye' as const) : null;
  const scene = createTableScene(host, {
    ...(startRig ? { rig: startRig } : {}),
    game,
    layout,
    viewerSeat,
    theme: paper,
    faces,
    dispatch(draft) {
      actions.push(draft);
      const a = { ...draft, by: viewerSeat ?? 's0', cid: `h${++cid}` } as Action;
      if (held) held.push(a);
      else apply(a);
    },
    events: {
      hover(card) {
        log('hover')(card);
        setView({ hovered: card });
      },
      selectionChange(ids) {
        log('selectionChange')(ids);
        setView({ selection: ids });
      },
      pileOpen(id) {
        log('pileOpen')(id);
        setView({ openPile: view.openPile === id ? null : id });
      },
      inspect: log('inspect'),
      contextMenu: log('contextMenu'),
    },
  });
  scene.update(state, view);
  const onMotion = () => setView({ reducedMotion: motionQuery.matches });
  motionQuery.addEventListener('change', onMotion);
  cleanups.push(() => motionQuery.removeEventListener('change', onMotion));

  // The P key keeps the table point under the mouse fixed through the blend (M4-P1), as the HUD's does.
  let mouse: ScreenPoint | null = null;
  const onMove = (e: PointerEvent) => (mouse = { x: e.clientX, y: e.clientY });
  addEventListener('pointermove', onMove);
  cleanups.push(() => removeEventListener('pointermove', onMove));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'p' || e.key === 'P') scene.camera.setRig(scene.camera.rig() === 'birdseye' ? 'ego' : 'birdseye', mouse ? { anchor: mouse } : undefined);
    else if (e.key === '0') scene.camera.fit();
    else if (e.key === 'Home' || e.key === '1') scene.camera.goToSeat(viewerSeat ?? 's0');
    else if (e.key === '2' || e.key === '3' || e.key === '4') {
      // Clockwise from the viewer: seat indices run clockwise (games/mtg/layout.ts).
      const n = Object.keys(state.seats).length;
      const steps = Number(e.key) - 1;
      const from = viewerSeat ? (state.seats[viewerSeat]?.index ?? 0) : 0;
      if (steps < n) scene.camera.goToSeat(`s${(from + steps) % n}`);
    }
    else if (e.key === 'Escape' && view.openPile) setView({ openPile: null });
  };
  addEventListener('keydown', onKey);
  cleanups.push(() => removeEventListener('keydown', onKey));

  registerDebug({
    state: () => state,
    dispatch: (a: Action) => apply(a),
  });
  const debug = scene.debug;
  window.__sceneHarness = {
    ready: () => debug.frameStats().drawCalls > 0 && debug.pendingTextures() === 0,
    idle: () => debug.idle(),
    layout: () => layout,
    toScreen: (x, y, z = 0) => scene.worldToScreen({ x, y, z }),
    toTable: (x, y) => scene.screenToTable(x, y),
    actions: () => actions,
    events: () => events,
    view: () => view,
    setView,
    lastDrop: () => debug.lastDrop(),
    cards: () => debug.cards(),
    cardAt: (x, y) => scene.cardAt(x, y),
    zoneAt: (x, y) => scene.zoneAt(x, y),
    camera: scene.camera,
    faceRequests: () => faceRequests,
    hold(on) {
      if (on) held ??= [];
      else if (held) {
        const queued = held;
        held = null;
        for (const a of queued) apply(a);
      }
    },
    themeWithRig: (rig) => scene.setTheme({ ...paper, camera: { ...paper.camera, defaultRig: rig } }),
    stackHover: () => hoveredStackItem(scene),
    dispose() {
      if (!mounted) return;
      mounted = false;
      scene.dispose();
      for (const c of cleanups.splice(0)) c();
    },
    remount() {
      window.__sceneHarness?.dispose();
      mount(target);
    },
    mountSurface(kind) {
      surface?.dispose();
      const h = document.createElement('div');
      Object.assign(h.style, { position: 'fixed', left: '0', top: '0', width: '480px', height: '320px' });
      document.body.append(h);
      const made =
        kind === 'stage'
          ? createStage(h)
          : kind === 'draft'
            ? createDraftSurfaceImpl(h, { game: harnessGame, layout: harnessLayout(), viewerSeat: 's0', theme: paper, faces: harnessFaces, events: {} })
            : createBuilderSurfaceImpl(h, { theme: paper, faces: harnessFaces, card: () => null, events: {} });
      surface = { host: h, dispose: () => made.dispose() };
    },
    disposeSurface() {
      surface?.dispose();
      surface?.host.remove();
      surface = null;
    },
    async arenaStill(id, width, noWebgl = false) {
      const theme = await loadTheme(id as ThemeId);
      const proto = HTMLCanvasElement.prototype;
      const getContext = proto.getContext;
      if (noWebgl)
        proto.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          return /webgl/.test(kind) ? null : (getContext as (...a: unknown[]) => unknown).call(this, kind, ...rest);
        } as typeof proto.getContext;
      let frame: HTMLCanvasElement | null = null;
      try {
        const blob = await renderArenaStill(theme, { width, onFrame: (f) => (frame = f) });
        if (!blob || !frame) return null;
        const f: HTMLCanvasElement = frame;
        const bitmap = await createImageBitmap(blob);
        // The browser scales the still up to the frame's size, as Home shows it.
        const up = document.createElement('canvas');
        up.width = f.width;
        up.height = f.height;
        const ctx = up.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, f.width, f.height);
        const report: ArenaStillReport = { bytes: blob.size, type: blob.type, width: bitmap.width, height: bitmap.height, frame: { width: f.width, height: f.height }, sharpDiff: neighbourDiff(f), softDiff: neighbourDiff(up) };
        bitmap.close();
        return report;
      } finally {
        proto.getContext = getContext;
      }
    },
  };
}
