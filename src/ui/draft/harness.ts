/**
 * Draft UI module test page (PLAN M2-P4). Mounts the lobby settings panel (for the host and for a guest, side by side)
 * or the draft HUD around the real draft surface, over a LocalTable whose public actions go through the real reducer
 * and a simulated draft (ui/draft/fakes.ts). Playwright bundles a small entry (tests/e2e/draft/page.ts) that calls
 * `mount` with fixture card data, so the app's own entry needs no route for it.
 *
 * Options (from the caller, or the page's query string): `view` 'lobby' | 'draft', `seats` names, `me` seat,
 * `format` 'pass' | 'rochester' | 'grid' | 'sealed' | 'winston', `packs`, `picks`, `burn`, `grids`, `timer` (pick timer on),
 * `packSize`, `foil` (every n-th card foil), `setsDelay` ms before the set list arrives.
 * Test API: window.__draftHarness.
 */
import { mount as mountSvelte } from 'svelte';
import type { Action } from '../../core/actions';
import type { InstanceId, SeatId, TableState } from '../../core/types';
import type { CardData, SetSummary } from '../../data/types';
import type { DraftPrivateView } from '../../draft/types';
import { createDraftSurfaceImpl, type DraftDebugCard, type DraftDebugQueue, type DraftSurfaceHandle } from '../../scene/draft';
import type { CreateDraftSurface } from '../../scene/types';
import { tokensToCssVars } from '../../themes/index';
import { paper } from '../../themes/paper/index';
import { FakeCardData, FakeFaces } from '../fakes';
import Draft from './Draft.svelte';
import { DraftSim, FakeEvening, FakeSets, LocalTable, type SimFormat } from './fakes';
import LobbySettings from './LobbySettings.svelte';

export interface DraftHarnessOptions {
  view: 'lobby' | 'draft';
  seats: string[];
  me: SeatId;
  format: SimFormat;
  packs?: number;
  picks?: number;
  burn?: number;
  grids?: number;
  timer: boolean;
  packSize?: number;
  foil?: number;
  setsDelay: number;
}

export interface DraftHarnessApi {
  /** The surface's first frame is drawn and its face textures are loaded. */
  ready(): boolean;
  idle(): boolean;
  state(): TableState;
  /** Actions the reducer applied, and proposals it refused. */
  applied(): Action[];
  refused(): { action: Action; reason: string }[];
  /** This seat's private draft view. */
  view(): DraftPrivateView | null;
  /** DraftControls calls (mark, pick, gridTake, pileLook) made by the HUD. */
  calls(): { method: string; args: unknown[] }[];
  /** Accepted picks of every seat. */
  picks(): { seat: SeatId; packId: string; cards: InstanceId[] }[];
  cards(): DraftDebugCard[];
  queues(): DraftDebugQueue[];
  /** The draft surface's camera view (centre, distance). */
  camera(): { cx: number; cy: number; dist: number } | null;
  /** Another seat picks the first cards of its front pack (or takes from the grid). */
  autoPick(seat: SeatId): boolean;
  gridTake(seat: SeatId, line: 'row' | 'col', index: 0 | 1 | 2): boolean;
  /** Start the simulated draft (the host's Start). */
  start(): void;
  /** Another seat proposes lobby settings or table settings. */
  dispatchAs(seat: SeatId, draft: Record<string, unknown>): void;
}

declare global {
  interface Window {
    __draftHarness?: DraftHarnessApi;
  }
}

/** Sets for the picker: the ten featured sets in a scrambled order, plus others, as a set source might list them. */
export const HARNESS_SETS: SetSummary[] = [
  { code: 'DOM', name: 'Dominaria', releaseDate: '2018-04-27', featured: false },
  { code: 'M21', name: 'Core Set 2021', releaseDate: '2020-07-03', featured: true },
  { code: 'M10', name: 'Magic 2010', releaseDate: '2009-07-17', featured: true },
  { code: 'ORI', name: 'Magic Origins', releaseDate: '2015-07-17', featured: true },
  { code: 'M19', name: 'Core Set 2019', releaseDate: '2018-07-13', featured: true },
  { code: 'M11', name: 'Magic 2011', releaseDate: '2010-07-16', featured: true },
  { code: 'M12', name: 'Magic 2012', releaseDate: '2011-07-15', featured: true },
  { code: 'M13', name: 'Magic 2013', releaseDate: '2012-07-13', featured: true },
  { code: 'M14', name: 'Magic 2014', releaseDate: '2013-07-19', featured: true },
  { code: 'M15', name: 'Magic 2015', releaseDate: '2014-07-18', featured: true },
  { code: 'M20', name: 'Core Set 2020', releaseDate: '2019-07-12', featured: true },
  { code: 'KLD', name: 'Kaladesh', releaseDate: '2016-09-30', featured: false },
  { code: 'FDN', name: 'Foundations', releaseDate: '2024-11-15', featured: false },
];

export function optionsFromQuery(search: string): DraftHarnessOptions {
  const q = new URLSearchParams(search);
  const num = (k: string): number | undefined => (q.has(k) ? Number(q.get(k)) : undefined);
  const format = (['pass', 'rochester', 'grid', 'sealed', 'winston'] as const).find((f) => f === q.get('format')) ?? 'pass';
  const out: DraftHarnessOptions = {
    view: q.get('view') === 'lobby' ? 'lobby' : 'draft',
    seats: (q.get('seats') ?? 'Anna,Ben,Cleo').split(',').filter(Boolean),
    me: q.get('me') ?? 's0',
    format,
    timer: q.get('timer') === '1',
    setsDelay: num('setsDelay') ?? 0,
  };
  for (const k of ['packs', 'picks', 'burn', 'grids', 'packSize', 'foil'] as const) {
    const v = num(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function mount(target: HTMLElement, cards: readonly CardData[], opts: DraftHarnessOptions = optionsFromQuery(location.search)): DraftHarnessApi {
  target.textContent = '';
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  const data = new FakeCardData([...cards]);
  const faces = new FakeFaces(data);
  const table = new LocalTable(opts.seats);
  const sim = new DraftSim(table, {
    format: opts.format,
    cards,
    pickTimer: opts.timer,
    ...(opts.packs !== undefined ? { packs: opts.packs } : {}),
    ...(opts.picks !== undefined ? { picks: opts.picks } : {}),
    ...(opts.burn !== undefined ? { burn: opts.burn } : {}),
    ...(opts.grids !== undefined ? { grids: opts.grids } : {}),
    ...(opts.packSize !== undefined ? { packSize: opts.packSize } : {}),
    ...(opts.foil !== undefined ? { foilEvery: opts.foil } : {}),
  });
  const controls = sim.controls(opts.me);
  let surface: DraftSurfaceHandle | null = null;
  const createSurface: CreateDraftSurface = (host, o) => (surface = createDraftSurfaceImpl(host, o));

  if (opts.view === 'lobby') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;padding:16px;box-sizing:border-box;';
    // The panel lives inside the lobby, which supplies the theme's tokens as CSS custom properties.
    for (const [k, v] of Object.entries(tokensToCssVars(paper.tokens))) wrap.style.setProperty(k, v);
    target.appendChild(wrap);
    const sets = new FakeSets(HARNESS_SETS, opts.setsDelay);
    for (const seat of [opts.me, ...Object.keys(table.state.seats).filter((s) => s !== opts.me).slice(0, 1)]) {
      const box = document.createElement('div');
      box.dataset.testid = `panel-${seat}`;
      wrap.appendChild(box);
      const session = table.session(seat, data);
      mountSvelte(LobbySettings, { target: box, props: { session, evening: new FakeEvening(session), sets } });
    }
  } else {
    sim.start();
    const session = table.session(opts.me, data);
    mountSvelte(Draft, { target, props: { session, draft: controls, createSurface, faces, cardData: data, theme: paper } });
  }

  const api: DraftHarnessApi = {
    ready: () => !!surface && surface.debug.pendingTextures() === 0 && surface.debug.cards().every((c) => c.screen.width > 0),
    idle: () => !surface || surface.debug.idle(),
    state: () => table.state,
    applied: () => table.applied,
    refused: () => table.refused,
    view: () => (table.state.draft ? sim.view(opts.me) : null),
    calls: () => controls.calls,
    picks: () => sim.picks,
    cards: () => surface?.debug.cards() ?? [],
    queues: () => surface?.debug.queues() ?? [],
    camera: () => surface?.debug.view() ?? null,
    autoPick: (seat) => (opts.format === 'grid' ? false : sim.autoPick(seat)),
    gridTake: (seat, line, index) => sim.gridTake(seat, line, index),
    start: () => sim.start(),
    dispatchAs: (seat, d) => void table.dispatch(seat, d as never),
  };
  window.__draftHarness = api;
  return api;
}
