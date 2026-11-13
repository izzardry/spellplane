/**
 * HUD module test page (`?harness=ui`, dev and test builds only; see src/main.ts and docs/DECISIONS.md M0).
 * Mounts the HUD over a fake session and a fake DOM scene, so Playwright can hover cards, press keys and assert the
 * dispatched actions through `window.__uiHarness` (PLAN M0-P4).
 */
import { mount as mountSvelte } from 'svelte';
import type { Action } from '../core/actions';
import type { InstanceId, SecretStore, TableState, ZoneId } from '../core/types';
import type { SceneEvents, TableSceneOptions, ViewState } from '../scene/types';
import { paper } from '../themes/paper/index';
import { FakeCardData, FakeFaces, FakeSession, MemorySettings, RecordingScene, fakeGame, tableWith, type FakeCardSpec, type SceneCall, type SessionCall } from './fakes';
import Hud from './Hud.svelte';
import type { HudProps } from './props';
import type { Settings } from '../store/types';

/** The page's harness API (Playwright reads it with page.evaluate). */
export interface UiHarness {
  /** Actions the HUD dispatched, stamped by the fake session. */
  actions(): Action[];
  /** Non-dispatch session calls: draw, shuffle, mulligan, lookAt, importDeck, undo. */
  calls(): SessionCall[];
  /** Scene calls: camera moves and drag hand-overs. */
  scene(): SceneCall[];
  /** Voice control events. */
  voice(): { action: string; phase: string }[];
  /** Settings writes (keymap remapping). */
  settingsWrites(): { name: string; value: unknown }[];
  /** Change a stored setting, as another tab or a settings panel would (not recorded in settingsWrites). */
  setSetting(name: string, value: unknown): Promise<void>;
  /** The last view state the HUD gave the scene. */
  view(): ViewState | null;
  state(): TableState;
  /** Change the table as a remote action would: `fn` receives a copy and returns or mutates it. */
  update(fn: (state: TableState, secrets: SecretStore) => TableState | void): void;
  /** Forget recorded actions and calls. */
  clear(): void;
  /** Let the HUD's scene report a hover (as pointer moves over a card on the table would). */
  hover(id: InstanceId | null): void;
  select(ids: InstanceId[]): void;
}

declare global {
  interface Window {
    __uiHarness?: UiHarness;
  }
}

/** The harness table: two seats, you (Anna) and Ben, with cards in every zone kind. */
export const HARNESS_CARDS: FakeCardSpec[] = [
  { id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -300, y: -260, rot: 0 } },
  { id: 'bf2', zone: 'battlefield:s0', sid: 'sid-caller', tapped: true, pose: { x: -200, y: -260, rot: 90 } },
  { id: 'dfc', zone: 'battlefield:s0', sid: 'sid-dfc', pose: { x: -100, y: -260, rot: 0 } },
  { id: 'fd1', zone: 'battlefield:s0', sid: 'sid-bear', face: 'down', pose: { x: 0, y: -260, rot: 0 } },
  { id: 'land1', zone: 'battlefield:s0', sid: 'sid-land', pose: { x: 100, y: -380, rot: 0 } },
  { id: 'h1', zone: 'hand:s0', sid: 'sid-bolt' },
  { id: 'h2', zone: 'hand:s0', sid: 'sid-bear' },
  { id: 'h3', zone: 'hand:s0', sid: 'sid-caller' },
  { id: 'h4', zone: 'hand:s0', sid: 'sid-dfc' },
  { id: 'lib1', zone: 'library:s0', sid: 'sid-land' },
  { id: 'lib2', zone: 'library:s0', sid: 'sid-bear' },
  { id: 'lib3', zone: 'library:s0', sid: 'sid-bolt' },
  { id: 'gy1', zone: 'graveyard:s0', sid: 'sid-land' },
  { id: 'gy2', zone: 'graveyard:s0', sid: 'sid-bolt' },
  { id: 'opp1', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: 0, y: 260, rot: 180 } },
  { id: 'opph1', zone: 'hand:s1' },
  { id: 'opplib1', zone: 'library:s1' },
];

/** A DOM stand-in for the Three.js scene: one box per public card at 0.5 px/mm, pile badges, the same events. */
class DomScene extends RecordingScene {
  private readonly layer: HTMLElement;
  constructor(
    host: HTMLElement,
    readonly opts: TableSceneOptions,
  ) {
    super();
    this.layer = document.createElement('div');
    this.layer.dataset.testid = 'fake-scene';
    this.layer.style.cssText = 'position:absolute;inset:0;background:#fff;';
    this.layer.addEventListener('contextmenu', (e) => {
      if (e.target !== this.layer) return;
      e.preventDefault();
      this.opts.events.contextMenu?.(null, { x: e.clientX, y: e.clientY });
    });
    host.appendChild(this.layer);
  }
  private get ev(): Partial<SceneEvents> {
    return this.opts.events;
  }
  private toScreen(x: number, y: number): { left: number; top: number } {
    const r = this.layer.getBoundingClientRect();
    return { left: r.width / 2 + x * 0.5, top: r.height * 0.42 - y * 0.5 };
  }
  private readonly items = new Map<string, HTMLElement>();
  /** One element per card or pile, created once and updated in place, so hover is never disturbed by re-rendering. */
  private item(key: string, make: () => HTMLElement): HTMLElement {
    let el = this.items.get(key);
    if (!el) {
      el = make();
      this.items.set(key, el);
      this.layer.appendChild(el);
    }
    return el;
  }
  private cardElement(id: InstanceId): HTMLElement {
    const el = document.createElement('div');
    el.dataset.testid = 'scene-card';
    el.dataset.card = id;
    el.addEventListener('pointerenter', () => this.ev.hover?.(id));
    el.addEventListener('pointerleave', () => this.ev.hover?.(null));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.ev.contextMenu?.(id, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
    el.addEventListener('auxclick', (e) => e.button === 1 && this.ev.inspect?.(id));
    return el;
  }
  override update(state: TableState, view: ViewState): void {
    super.update(state, view);
    const data = new FakeCardData();
    const live = new Set<string>();
    for (const zone of Object.values(state.zones)) {
      if (zone.kind !== 'battlefield' && zone.kind !== 'stack') continue;
      zone.ids.forEach((id, i) => {
        const c = state.cards[id];
        if (!c) return;
        live.add(`card:${id}`);
        const el = this.item(`card:${id}`, () => this.cardElement(id));
        const ref = c.identity ?? view.privateFaces[id];
        const name = ref ? (data.peek(ref.sid)?.name ?? 'Card') : 'Face-down card';
        const text = `${name}${c.tapped ? ' (tapped)' : ''}`;
        if (el.textContent !== text) el.textContent = text;
        const p = zone.kind === 'stack' ? this.toScreen(-30 + i * 6, 40 - i * 22) : this.toScreen(c.pose.x, c.pose.y);
        const css = `position:absolute;left:${p.left - 31}px;top:${p.top - 44}px;width:63px;height:88px;border:1px solid ${view.hovered === id ? '#111' : '#bbb'};background:#fafafa;font:10px system-ui;overflow:hidden;box-sizing:border-box;padding:2px;user-select:none;${view.selection.includes(id) ? 'outline:2px solid #1f6fd1;' : ''}`;
        if (el.style.cssText !== css) el.style.cssText = css;
      });
    }
    const badge = (zone: ZoneId, label: string, x: number, y: number) => {
      const z = state.zones[zone];
      if (!z) return;
      live.add(`pile:${zone}`);
      const el = this.item(`pile:${zone}`, () => {
        const b = document.createElement('div');
        b.dataset.testid = 'scene-pile';
        b.dataset.zone = zone;
        b.addEventListener('dblclick', () => this.ev.pileOpen?.(zone));
        return b;
      });
      el.textContent = `${label} ${z.ids.length}`;
      const p = this.toScreen(x, y);
      el.style.cssText = `position:absolute;left:${p.left - 31}px;top:${p.top - 20}px;width:63px;height:40px;border:1px dashed #111;font:10px system-ui;background:#fff;`;
    };
    badge('library:s0', 'Library', 560, -470);
    badge('graveyard:s0', 'Graveyard', 560, -400);
    badge('exile:s0', 'Exile', 560, -330);
    badge('library:s1', 'Library', -560, 470);
    badge('graveyard:s1', 'Graveyard', -560, 400);
    for (const [key, el] of this.items) {
      if (!live.has(key)) {
        el.remove();
        this.items.delete(key);
      }
    }
  }
  override cardAt(x: number, y: number): InstanceId | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.dataset.card ?? null;
  }
  override screenToTable(x: number, y: number): { x: number; y: number } | null {
    const r = this.layer.getBoundingClientRect();
    return { x: (x - r.width / 2) / 0.5, y: (r.height * 0.42 - y) / 0.5 };
  }
  override dispose(): void {
    this.layer.remove();
  }
}

export function mount(target: HTMLElement): void {
  target.textContent = '';
  document.documentElement.style.cssText = 'margin:0;height:100%;overflow:hidden';
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#fff';
  const label = document.createElement('div');
  label.textContent = 'UI harness';
  label.style.cssText = 'position:fixed;right:8px;bottom:4px;font:10px system-ui;color:#999;z-index:1000;pointer-events:none';
  target.appendChild(label);

  const params = new URLSearchParams(location.search);
  const names = (params.get('seats') ?? 'Anna,Ben').split(',').filter(Boolean);
  const { state, secrets } = tableWith(names, HARNESS_CARDS.filter((c) => Number(c.zone.split(':s')[1] ?? 0) < names.length));
  const data = new FakeCardData();
  const session = new FakeSession(state, secrets, data, 's0');
  const settings = new MemorySettings({}, typeof localStorage === 'undefined' ? null : localStorage);
  const voice: { action: string; phase: string }[] = [];
  let scene: DomScene | null = null;
  let n = 0;

  const host = document.createElement('div');
  target.appendChild(host);
  const props: HudProps = {
      session,
      createScene: (h, opts) => (scene = new DomScene(h, opts)),
      faces: new FakeFaces(data),
      cardData: data,
      game: fakeGame(),
      theme: paper,
      settings,
      onVoice: (action, phase) => voice.push({ action, phase }),
      newId: (p) => `${p}${++n}`,
  };
  mountSvelte(Hud, { target: host, props });

  window.__uiHarness = {
    actions: () => JSON.parse(JSON.stringify(session.dispatched)) as Action[],
    calls: () => JSON.parse(JSON.stringify(session.calls)) as SessionCall[],
    scene: () => JSON.parse(JSON.stringify(scene?.calls ?? [])) as SceneCall[],
    voice: () => [...voice],
    settingsWrites: () => JSON.parse(JSON.stringify(settings.writes)) as { name: string; value: unknown }[],
    setSetting: async (name, value) => {
      await settings.set(name as keyof Settings, value as never);
      settings.writes.pop();
    },
    view: () => (scene?.lastView ? (JSON.parse(JSON.stringify(scene.lastView)) as ViewState) : null),
    state: () => JSON.parse(JSON.stringify(session.getState())) as TableState,
    update: (fn) => {
      const st = structuredClone(session.getState());
      const sec = structuredClone(session.secrets());
      const next = fn(st, sec) ?? st;
      session.setState(next, sec);
    },
    clear: () => {
      session.dispatched.length = 0;
      session.calls.length = 0;
      if (scene) scene.calls.length = 0;
      voice.length = 0;
    },
    hover: (id) => scene?.opts.events.hover?.(id),
    select: (ids) => scene?.opts.events.selectionChange?.(ids),
  };
}
