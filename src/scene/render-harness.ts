/**
 * Lit pipeline test page (`?harness=render`, dev and test builds only; src/main.ts). Mounts the real table scene on the
 * harness table (scene/harness-fixture.ts) with any theme, including the test-only lit theme (themes/test-lit.ts), so
 * the pipeline can be tested before Dusk, Wyrm and Stonetable land (PLAN M4-P2). Added by M4-P2.
 *
 * URL: `?harness=render&faces=placeholder&scenario=empty|demo|bench&theme=paper|dusk|wyrm|stonetable|lit&quality=high|medium|low&viewer=s0|s1&rig=birdseye|ego|theme`.
 * The camera starts in the bird's-eye rig unless `rig=ego` (or `rig=theme`, the theme's default camera) asks otherwise: the
 * render specs measure materials, light and post on a near-affine view.
 * Test API: window.__renderHarness (below) and window.__spellplane (state, dispatch, render, cards, frameStats).
 */
import type { Action, ActionDraft } from '../core/actions';
import { stateHash } from '../core/hash';
import type { InstanceId, Pose, TableState } from '../core/types';
import { loadTheme, THEME_IDS, type QualityId, type Theme, type ThemeId } from '../themes/index';
import { registerDebug } from '../util/debug';
import { buildHarnessState, harnessFace, harnessFaces, harnessGame, harnessLayout, harnessReduce, type HarnessScenario } from './harness-fixture';
import { drawPlaceholderFace } from './placeholder';
import { createTableScene, type SceneDebug, type SceneDebugCard } from './table-scene';
import type { RenderStats, ScreenPoint, TableScene, ViewState } from './types';

/** A theme the harness can show: a real theme id or the test-only lit theme. */
export type HarnessThemeId = ThemeId | 'lit';

export interface RenderHarnessApi {
  /** A frame was drawn with the current theme and every requested face texture is uploaded. */
  ready(): boolean;
  idle(): boolean;
  theme(): HarnessThemeId;
  /** Switch theme without reload; resolves once a frame of the new theme was drawn. */
  setTheme(id: HarnessThemeId): Promise<void>;
  /** Apply a quality setting; resolves once a frame at that level was drawn. */
  setQuality(id: QualityId): Promise<void>;
  stats(): RenderStats;
  pipeline(): ReturnType<SceneDebug['pipeline']>;
  frames(): number;
  /** Draw a fresh frame and wait until it is on screen (two more animation frames), before a screenshot. */
  redraw(): Promise<void>;
  /** MSAA samples of the post chain (0 with post off). */
  samples(): number;
  /** What the pipeline handed the lit test theme (themes/test-lit.ts litProbe); null before it was loaded. */
  litProbe(): unknown;
  /** Hash of the shared state (core/hash.ts stateHash). */
  hash(): Promise<string>;
  /** Drafts the scene dispatched. */
  actions(): ActionDraft[];
  cards(): SceneDebugCard[];
  /** Put a face-up card with placeholder face `sid` on s0's battlefield. */
  addCard(id: InstanceId, sid: string, pose: Pose): void;
  /** Average sRGB colour (0..255) of the placeholder face `sid` as drawn, over the inner part (`inset` of each side cut off). */
  sourceAverage(sid: string, inset: number): [number, number, number];
  toScreen(x: number, y: number, z?: number): ScreenPoint | null;
  camera: TableScene['camera'];
  setView(v: Partial<ViewState>): void;
  dispose(): void;
}

declare global {
  interface Window {
    __renderHarness?: RenderHarnessApi;
  }
}

let litModule: { litTestTheme: () => Theme; litProbe: unknown } | null = null;

async function themeFor(id: HarnessThemeId): Promise<Theme> {
  if (id === 'lit') {
    litModule ??= await import('../themes/test-lit');
    return litModule.litTestTheme();
  }
  return loadTheme(id);
}

const isTheme = (v: string | null): v is HarnessThemeId => v === 'lit' || (THEME_IDS as readonly string[]).includes(v ?? '');

export async function mount(target: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const scenario = (['demo', 'bench', 'empty'] as const).find((s) => s === params.get('scenario')) ?? ('empty' satisfies HarnessScenario);
  const themeParam = params.get('theme');
  let themeId: HarnessThemeId = isTheme(themeParam) ? themeParam : 'paper';
  const quality = (['high', 'medium', 'low'] as const).find((q) => q === params.get('quality')) ?? 'high';
  const viewer = params.get('viewer') === 's1' ? 's1' : 's0';
  const rigParam = params.get('rig');
  const rig = rigParam === 'ego' ? 'ego' : rigParam === 'theme' ? undefined : 'birdseye';

  target.textContent = '';
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', overflow: 'hidden' });
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  target.append(host);

  const layout = harnessLayout();
  let state: TableState = buildHarnessState({ scenario });
  let view: ViewState = { selection: [], hovered: null, privateFaces: {}, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, pings: [], openPile: null };
  const actions: ActionDraft[] = [];
  let cid = 0;
  let switching = 0;

  const theme = await themeFor(themeId);
  const scene = createTableScene(host, {
    game: harnessGame,
    layout,
    viewerSeat: viewer,
    theme,
    ...(rig ? { rig } : {}),
    faces: harnessFaces,
    quality,
    dispatch(draft) {
      actions.push(draft);
      apply({ ...draft, by: viewer, cid: `r${++cid}` } as Action);
    },
    events: {
      hover: (card) => setView({ hovered: card }),
      selectionChange: (ids) => setView({ selection: ids }),
    },
  });
  const debug = scene.debug as SceneDebug;
  const apply = (a: Action) => {
    state = harnessReduce(state, a);
    scene.update(state, view);
  };
  const setView = (v: Partial<ViewState>) => {
    view = { ...view, ...v };
    scene.update(state, view);
  };
  scene.update(state, view);

  /** Resolve once the scene drew a frame after now. */
  const nextFrame = (): Promise<void> => {
    const start = debug.frames();
    return new Promise((resolve) => {
      const check = () => (debug.frames() > start ? resolve() : requestAnimationFrame(check));
      requestAnimationFrame(check);
    });
  };

  registerDebug({ state: () => state, dispatch: (a: Action) => apply(a) });
  window.__renderHarness = {
    ready: () => switching === 0 && debug.frames() > 0 && debug.pendingTextures() === 0,
    idle: () => debug.idle(),
    theme: () => themeId,
    async setTheme(id) {
      switching++;
      try {
        const next = await themeFor(id);
        themeId = id;
        scene.setTheme(next);
        await nextFrame();
      } finally {
        switching--;
      }
    },
    async setQuality(id) {
      scene.setQuality(id);
      await nextFrame();
    },
    async redraw() {
      setView({});
      await nextFrame();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    samples: () => debug.pipeline().samples,
    litProbe: () => litModule?.litProbe ?? null,
    stats: () => scene.renderStats(),
    pipeline: () => debug.pipeline(),
    frames: () => debug.frames(),
    hash: () => stateHash(state),
    actions: () => actions,
    cards: () => debug.cards(),
    addCard(id, sid, pose) {
      apply({ type: 'createToken', by: 's0', cid: `add-${id}`, card: id, zone: 'battlefield:s0', pose, ref: { sid } } as Action);
    },
    sourceAverage(sid, inset) {
      const canvas = drawPlaceholderFace(harnessFace(sid)) as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const x0 = Math.round(canvas.width * inset);
      const y0 = Math.round(canvas.height * inset);
      const data = ctx.getImageData(x0, y0, canvas.width - 2 * x0, canvas.height - 2 * y0).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
      }
      return [r / n, g / n, b / n];
    },
    toScreen: (x, y, z = 0) => scene.worldToScreen({ x, y, z }),
    camera: scene.camera,
    setView,
    dispose: () => scene.dispose(),
  };
}
