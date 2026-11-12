/**
 * Builder module test page (PLAN M2-P5). Mounts the builder (table view, list view, readout, dispenser, Ready) over a
 * real solo TableSession without storage (Ready goes through the real importDeck and its commitments) and a
 * DraftControls stand-in that holds the shared DeckBuild as the session's SecretStore would. Playwright bundles a small
 * entry (tests/e2e/builder/page.ts) that calls `mount` with fixture card data; the app's own entry needs no route.
 *
 * Options (the page's query string): `pool` 'draft' (45 cards) | 'sealed' (90) | 'empty' | 'none' (no pool yet),
 * `view` 'table' | 'list'. Test API: window.__builderHarness.
 */
import { mount as mountSvelte } from 'svelte';
import type { DeckBuild, SecretStore, TableState } from '../../core/types';
import type { CardData, SetDataSource } from '../../data/types';
import type { DraftControls, DraftPrivateView } from '../../draft/types';
import { mtg } from '../../games/index';
import { createBuilderSurfaceImpl, type BuilderDebugCard, type BuilderSurfaceHandle } from '../../scene/builder';
import type { BuilderSort, CreateBuilderSurface, ScreenPoint, TablePoint } from '../../scene/types';
import { createSoloSession } from '../../session/solo';
import { paper } from '../../themes/paper/index';
import { FakeCardData, FakeFaces } from '../fakes';
import type { BuilderViewKind } from '../types';
import Builder from './Builder.svelte';

export interface BuilderHarnessApi {
  /** The surface drew its cards with their faces. */
  ready(): boolean;
  idle(): boolean;
  /** The shared DeckBuild as DraftControls holds it. */
  build(): DeckBuild | null;
  /** Replace the build from outside (what the list view or a reload hands the table). */
  setBuild(build: DeckBuild): void;
  /** How many times the builder wrote the build back. */
  writes(): number;
  cards(): BuilderDebugCard[];
  sort(): { showing: BuilderSort | null; key: BuilderSort } | null;
  selection(): string[];
  locked(): boolean | null;
  state(): TableState;
  secrets(): SecretStore;
  toScreen(p: TablePoint): ScreenPoint | null;
  view(): { cx: number; cy: number; dist: number } | null;
}

declare global {
  interface Window {
    __builderHarness?: BuilderHarnessApi;
  }
}

/** A DraftControls stand-in: the build lives here as it would in the SecretStore; the draft itself is over. */
export class BuildHolder implements DraftControls {
  writes = 0;
  private listeners = new Set<(v: DraftPrivateView) => void>();
  constructor(public current: DeckBuild | null) {}
  view(): DraftPrivateView {
    return { format: 'pass', pack: null, picks: 0, marked: [], queued: 0, pool: (this.current?.cards ?? []).filter((c) => !c.basic).map((c) => c.ref), timer: null, waitingOn: [] };
  }
  subscribe(listener: (view: DraftPrivateView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  mark(): void {}
  pick(): boolean {
    return false;
  }
  pileLook(): boolean {
    return false;
  }
  gridTake(): boolean {
    return false;
  }
  build(): DeckBuild | null {
    return this.current ? (JSON.parse(JSON.stringify(this.current)) as DeckBuild) : null;
  }
  setBuild(build: DeckBuild): void {
    this.writes++;
    this.current = JSON.parse(JSON.stringify(build)) as DeckBuild;
  }
  /** An outside change (another view, a reload): listeners hear about it. */
  replace(build: DeckBuild): void {
    this.current = JSON.parse(JSON.stringify(build)) as DeckBuild;
    const v = this.view();
    for (const l of this.listeners) l(v);
  }
  ready(): Promise<void> {
    return Promise.resolve();
  }
}

/** A pool of `n` M19 cards, spread over the set (every few cards), with every 11th card foil and the land-slot basics. */
export function harnessPool(cards: readonly CardData[], n: number): DeckBuild {
  const playable = cards.filter((c) => !/\bBasic\b/.test(c.type_line) && !/Token/.test(c.type_line));
  const basics = cards.filter((c) => /\bBasic\b/.test(c.type_line));
  const out: DeckBuild = { cards: [], main: [] };
  const step = Math.max(1, Math.floor(playable.length / n));
  for (let i = 0; out.cards.length < n - Math.floor(n / 15); i += step) {
    const c = playable[(i + Math.floor(i / playable.length)) % playable.length]!;
    const k = out.cards.length + 1;
    out.cards.push({ id: `p${k}`, ref: k % 11 === 0 ? { sid: c.id, foil: true } : { sid: c.id } });
  }
  // One basic per pack (the land slot), as drafted cards (not dispensed).
  for (let i = 0; out.cards.length < n; i++) out.cards.push({ id: `p${out.cards.length + 1}`, ref: { sid: basics[(i * 5) % basics.length]!.id } });
  return out;
}

/** Set data for the dispenser from the card list: the basics of each set by collector number. */
export function harnessSets(cards: readonly CardData[]): SetDataSource {
  const bySet = new Map<string, CardData[]>();
  for (const c of cards) if (/\bBasic\b/.test(c.type_line)) bySet.set(c.set.toUpperCase(), [...(bySet.get(c.set.toUpperCase()) ?? []), c]);
  const data = (code: string) => {
    const list = bySet.get(code.toUpperCase());
    if (!list) return null;
    return {
      code: code.toUpperCase(),
      name: code,
      releaseDate: '2018-07-13',
      boosterType: 'draft' as const,
      booster: { boosters: [], boostersTotalWeight: 0, sheets: {} },
      cards: Object.fromEntries(list.map((c) => [`u-${c.id}`, { scryfallId: c.id, name: c.name, rarity: 'common', types: ['Land'], number: c.collector_number }])),
    };
  };
  return {
    listSets: () => Promise.resolve([]),
    get: (code) => Promise.resolve(data(code)),
    peek: (code) => data(code),
  };
}

export async function mount(target: HTMLElement, cards: readonly CardData[]): Promise<BuilderHarnessApi> {
  const q = new URLSearchParams(location.search);
  target.textContent = '';
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  const data = new FakeCardData([...cards]);
  const faces = new FakeFaces(data);
  const session = await createSoloSession({ game: mtg, cardData: data, playerName: 'Anna' });
  const kind = q.get('pool') ?? 'draft';
  const pool = kind === 'none' ? null : kind === 'empty' ? { cards: [], main: [] } : harnessPool(cards, kind === 'sealed' ? 90 : 45);
  const holder = new BuildHolder(pool);
  let surface: BuilderSurfaceHandle | null = null;
  const createSurface: CreateBuilderSurface = (host, o) => (surface = createBuilderSurfaceImpl(host, o));
  const view: BuilderViewKind = q.get('view') === 'list' ? 'list' : 'table';
  // The origin a drafted pool reports to the deck library; the dispenser's printings come from its sets.
  mountSvelte(Builder, {
    target,
    props: { session, draft: holder, createSurface, faces, cardData: data, theme: paper, origin: { format: 'pass', sets: ['M19'] }, sets: harnessSets(cards), view },
  });
  const api: BuilderHarnessApi = {
    ready: () => !!surface && surface.debug.pendingTextures() === 0 && surface.debug.cards().every((c) => c.screen.width > 0),
    idle: () => !surface || surface.debug.idle(),
    build: () => holder.build(),
    setBuild: (b) => holder.replace(b),
    writes: () => holder.writes,
    cards: () => surface?.debug.cards() ?? [],
    sort: () => surface?.debug.sort() ?? null,
    selection: () => surface?.debug.selection() ?? [],
    locked: () => surface?.debug.locked() ?? null,
    state: () => session.getState(),
    secrets: () => session.secrets(),
    toScreen: (p) => surface?.toScreen(p) ?? null,
    view: () => surface?.debug.view() ?? null,
  };
  window.__builderHarness = api;
  return api;
}
