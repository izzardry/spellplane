/**
 * Browser entry for Dusk's Playwright specs (PLAN M4-P3), bundled from source by ./bundle.ts and served on the app's
 * own origin. It mounts the real table scene (scene/table-scene.ts) with the Dusk theme over a 1v1 Magic table
 * (games/mtg layout), driven by the real reducer (core/reducer), and the real HUD avatars (ui/Avatar.svelte) styled
 * by Dusk's tokens as CSS custom properties (themes/index.ts hudCssVars), so every functional signal
 * (themes/signals.ts) can be put on screen: the ten scene signals through shared and view state, speaking and away on
 * the avatars. Card faces are placeholders (scene/harness-fixture.ts harnessFaces); nothing touches the network.
 *
 * Query: `?theme=dusk|paper` (default dusk), `?quality=high|medium|low` (default high).
 * Test API: window.__dusk (below) and window.__spellplane (cards, drawnLines, stack, render, …).
 */
import { mount, unmount } from 'svelte';
import type { Action } from '../../../../src/core/actions';
import { createTable, explain, reduce } from '../../../../src/core/reducer/index';
import type { SeatId, TableState } from '../../../../src/core/types';
import { mtg } from '../../../../src/games/index';
import { harnessFaces } from '../../../../src/scene/harness-fixture';
import { createTableScene, type SceneDebug } from '../../../../src/scene/table-scene';
import type { RenderStats, ScreenPoint, TableScene, ViewState } from '../../../../src/scene/types';
import { DUSK_SOUNDS } from '../../../../src/themes/dusk/sounds';
import { loadTheme, hudCssVars, type QualityId, type Theme, type ThemeId } from '../../../../src/themes/index';
import Avatar from '../../../../src/ui/Avatar.svelte';
import { registerDebug } from '../../../../src/util/debug';

export interface CueReport {
  cue: string;
  peak: number;
  /** Seconds from the start until the last sample louder than -80 dB. */
  lastSoundS: number;
  rms: number;
}

export interface DuskPageApi {
  ready(): boolean;
  idle(): boolean;
  frames(): number;
  theme(): ThemeId;
  setTheme(id: ThemeId): Promise<void>;
  setQuality(id: QualityId): Promise<void>;
  /** Apply an action from `by` through the real reducer; throws with the reducer's reason when it does not apply. */
  dispatch(a: Record<string, unknown>): void;
  state(): TableState;
  setView(v: Partial<ViewState>): void;
  setSpeaking(seat: SeatId, on: boolean): void;
  stats(): RenderStats;
  pipeline(): ReturnType<SceneDebug['pipeline']>;
  toScreen(x: number, y: number, z?: number): ScreenPoint | null;
  camera: TableScene['camera'];
  /** Draw a fresh frame and wait until it is on screen. */
  redraw(): Promise<void>;
  /** Render each Dusk cue offline (OfflineAudioContext) at `gain` and report its level and length. */
  renderCues(gain: number): Promise<CueReport[]>;
  /** Render the room tone offline for `seconds`, stopping it at `stopAt`. */
  renderAmbience(gain: number, seconds: number, stopAt: number): Promise<{ peak: number; rmsBefore: number; peakAfterStop: number }>;
}

declare global {
  interface Window {
    __dusk?: DuskPageApi;
  }
}

type Seat2 = 's0' | 's1';
const SEATS: Seat2[] = ['s0', 's1'];

async function main(target: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  let themeId: ThemeId = params.get('theme') === 'paper' ? 'paper' : 'dusk';
  const quality = (['high', 'medium', 'low'] as const).find((q) => q === params.get('quality')) ?? 'high';
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  target.textContent = '';
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', overflow: 'hidden' });
  target.append(host);
  // The HUD layer: avatars in screen space above the scene, styled by the theme's CSS custom properties.
  const hud = document.createElement('div');
  hud.dataset.testid = 'hud';
  Object.assign(hud.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  target.append(hud);

  let theme: Theme = await loadTheme(themeId);
  const layout = mtg.layout('1v1');
  let state: TableState = { ...createTable({ game: mtg, format: '1v1', seats: [{ name: 'Ada', colour: 0 }, { name: 'Bo', colour: 1 }] }), stage: 'match' };
  let view: ViewState = { selection: [], hovered: null, privateFaces: {}, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, pings: [], openPile: null };
  let cid = 0;
  let switching = 0;
  const speaking: Record<Seat2, boolean> = { s0: false, s1: false };

  const scene = createTableScene(host, {
    game: mtg,
    layout,
    viewerSeat: 's0',
    theme,
    faces: harnessFaces,
    quality,
    rig: 'birdseye',
    dispatch(draft) {
      apply({ ...draft, by: 's0', cid: `d${++cid}` } as unknown as Action);
    },
    events: {},
  });
  const debug = scene.debug as SceneDebug;

  function applyTokens(): void {
    // As the app's HUD does (App.svelte, M4-P6): panels in tokens.hud.panel, the felt colour as --sp-table-surface.
    for (const [k, v] of Object.entries(hudCssVars(theme.tokens))) hud.style.setProperty(k, v);
  }

  const mounted: Record<Seat2, ReturnType<typeof mount> | null> = { s0: null, s1: null };
  const slots: Record<Seat2, HTMLElement> = { s0: document.createElement('div'), s1: document.createElement('div') };
  // Where the HUD puts them: own avatar bottom-left, the opponent's top-left.
  Object.assign(slots.s0.style, { position: 'absolute', left: '16px', bottom: '16px' });
  Object.assign(slots.s1.style, { position: 'absolute', left: '16px', top: '16px' });
  hud.append(slots.s0, slots.s1);
  function renderAvatars(): void {
    for (const id of SEATS) {
      const seat = state.seats[id];
      if (!seat) continue;
      if (mounted[id]) void unmount(mounted[id]);
      mounted[id] = mount(Avatar, {
        target: slots[id],
        props: {
          seat,
          life: seat.life,
          me: id === 's0',
          active: state.turn.active === id,
          responding: false,
          speaking: speaking[id],
          glyph: theme.tokens.colours.seats[seat.colour]?.glyph ?? 'circle',
          zones: [],
          onlife: () => undefined,
          oncounter: () => undefined,
          onopenzone: () => undefined,
        },
      });
    }
  }

  function apply(a: Action): void {
    const why = explain(state, a);
    if (why) throw new Error(`${a.type} does not apply: ${why}`);
    state = reduce(state, a);
    scene.update(state, view);
    renderAvatars();
  }
  const setView = (v: Partial<ViewState>): void => {
    view = { ...view, ...v };
    scene.update(state, view);
  };

  applyTokens();
  scene.update(state, view);
  renderAvatars();

  const nextFrame = (): Promise<void> => {
    const start = debug.frames();
    return new Promise((resolve) => {
      const check = () => (debug.frames() > start ? resolve() : requestAnimationFrame(check));
      requestAnimationFrame(check);
    });
  };

  /** Render `play` into an offline context and measure it. */
  async function offline(seconds: number, play: (ctx: OfflineAudioContext) => void): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(1, Math.round(44100 * seconds), 44100);
    play(ctx);
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }
  const peakOf = (d: Float32Array, from = 0, to = d.length): number => {
    let p = 0;
    for (let i = from; i < to; i++) p = Math.max(p, Math.abs(d[i]!));
    return p;
  };

  registerDebug({ state: () => state, dispatch: (a: Action) => apply(a) });
  window.__dusk = {
    ready: () => switching === 0 && debug.frames() > 0 && debug.pendingTextures() === 0,
    idle: () => debug.idle(),
    frames: () => debug.frames(),
    theme: () => themeId,
    async setTheme(id) {
      switching++;
      try {
        theme = await loadTheme(id);
        themeId = id;
        scene.setTheme(theme);
        applyTokens();
        renderAvatars();
        await nextFrame();
      } finally {
        switching--;
      }
    },
    async setQuality(id) {
      scene.setQuality(id);
      await nextFrame();
    },
    dispatch(a) {
      apply({ by: 's0', cid: `t${++cid}`, ...a } as unknown as Action);
    },
    state: () => state,
    setView,
    setSpeaking(seat, on) {
      if (seat !== 's0' && seat !== 's1') throw new Error(`no avatar for ${seat}`);
      speaking[seat] = on;
      renderAvatars();
    },
    stats: () => scene.renderStats(),
    pipeline: () => debug.pipeline(),
    toScreen: (x, y, z = 0) => scene.worldToScreen({ x, y, z }),
    camera: scene.camera,
    async redraw() {
      setView({});
      await nextFrame();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    async renderCues(gain) {
      const out: CueReport[] = [];
      for (const name of ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick'] as const) {
        const src = DUSK_SOUNDS[name];
        if (!src) continue;
        const d = await offline(3, (ctx) => src.play(ctx as unknown as AudioContext, gain));
        let last = 0;
        let sum = 0;
        for (let i = 0; i < d.length; i++) {
          if (Math.abs(d[i]!) > 1e-4) last = i;
          sum += d[i]! * d[i]!;
        }
        out.push({ cue: name, peak: peakOf(d), lastSoundS: last / 44100, rms: Math.sqrt(sum / d.length) });
      }
      return out;
    },
    async renderAmbience(gain, seconds, stopAt) {
      const amb = DUSK_SOUNDS.ambience!;
      const ctx = new OfflineAudioContext(1, Math.round(44100 * seconds), 44100);
      const handle = amb.start(ctx as unknown as AudioContext, gain);
      void ctx.suspend(stopAt).then(() => {
        handle.stop();
        void ctx.resume();
      });
      const d = (await ctx.startRendering()).getChannelData(0);
      const stop = Math.round(stopAt * 44100);
      let sum = 0;
      const from = Math.round(Math.min(stopAt, 2) * 44100 * 0.75);
      for (let i = from; i < stop; i++) sum += d[i]! * d[i]!;
      return { peak: peakOf(d), rmsBefore: Math.sqrt(sum / Math.max(1, stop - from)), peakAfterStop: peakOf(d, Math.min(d.length, stop + Math.round(44100 * 0.6))) };
    },
  };
}

void main(document.getElementById('app')!);
