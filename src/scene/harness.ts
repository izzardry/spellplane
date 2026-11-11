/**
 * Scene module test page (`?harness=scene`, dev and test builds only; see src/main.ts and docs/DECISIONS.md M0).
 * Renders a synthetic TableState with placeholder faces and applies the scene's actions with a local reducer stub,
 * so Playwright can drive the real scene before the session (M0-P7) exists.
 *
 * URL: `?harness=scene&scenario=demo|bench|empty&viewer=s0|s1|none`. `bench` renders 300 cards.
 * Keys: 0 fit, Home or 1 own side, 2 the other seat, Escape closes an opened pile.
 * Test API: window.__spellplane (state, dispatch, cards, camera, lines, frameStats) and window.__sceneHarness.
 */
import type { Action, ActionDraft } from '../core/actions';
import type { InstanceId, TableState } from '../core/types';
import type { TableLayout } from '../games/types';
import { paper } from '../themes/paper';
import { registerDebug } from '../util/debug';
import { buildHarnessState, harnessFaces, harnessGame, harnessLayout, harnessPrivateFaces, harnessReduce, type HarnessScenario } from './harness-fixture';
import type { DropResult } from './snap';
import { createTableScene, type SceneDebugCard } from './table-scene';
import type { ScreenPoint, TablePoint, TableScene, ViewState } from './types';

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
}

declare global {
  interface Window {
    __sceneHarness?: SceneHarnessApi;
  }
}

export function mount(target: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const scenario = (['demo', 'bench', 'empty'] as const).find((s) => s === params.get('scenario')) ?? ('demo' satisfies HarnessScenario);
  const viewerParam = params.get('viewer');
  const viewerSeat = viewerParam === 'none' ? null : viewerParam === 's1' ? 's1' : 's0';

  target.textContent = '';
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', overflow: 'hidden', background: '#fff' });
  const label = document.createElement('div');
  label.textContent = `harness: scene (${scenario})`;
  Object.assign(label.style, { position: 'fixed', left: '8px', bottom: '6px', font: '11px system-ui, sans-serif', color: '#8a8a8a', pointerEvents: 'none', letterSpacing: '0.04em', zIndex: '1' });
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  target.append(host, label);

  const layout = harnessLayout();
  let state: TableState = buildHarnessState({ scenario });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let view: ViewState = { selection: [], hovered: null, privateFaces: viewerSeat === 's0' ? harnessPrivateFaces() : {}, reducedMotion: motionQuery.matches, pings: [], openPile: null };
  const actions: ActionDraft[] = [];
  const events: { type: string; args: unknown[] }[] = [];
  let cid = 0;

  const apply = (a: Action) => {
    state = harnessReduce(state, a);
    scene.update(state, view);
  };
  const setView = (v: Partial<ViewState>) => {
    view = { ...view, ...v };
    scene.update(state, view);
  };
  const log = (type: string) => (...args: unknown[]) => events.push({ type, args: JSON.parse(JSON.stringify(args)) as unknown[] });

  const scene = createTableScene(host, {
    game: harnessGame,
    layout,
    viewerSeat,
    theme: paper,
    faces: harnessFaces,
    dispatch(draft) {
      actions.push(draft);
      apply({ ...draft, by: viewerSeat ?? 's0', cid: `h${++cid}` } as Action);
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
  motionQuery.addEventListener('change', () => setView({ reducedMotion: motionQuery.matches }));

  addEventListener('keydown', (e) => {
    if (e.key === '0') scene.camera.fit();
    else if (e.key === 'Home' || e.key === '1') scene.camera.goToSeat(viewerSeat ?? 's0');
    else if (e.key === '2') scene.camera.goToSeat(viewerSeat === 's1' ? 's0' : 's1');
    else if (e.key === 'Escape' && view.openPile) setView({ openPile: null });
  });

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
  };
}
