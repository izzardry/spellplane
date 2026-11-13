/**
 * In-memory fakes of the HUD's seams (TableSession, TableScene camera, CardDataSource, FaceSource, SettingsStore and
 * a game definition) for unit tests and the `?harness=ui` page (PLAN M0-P4: code against interfaces only).
 * Card data here is invented for tests; no real card data is bundled (CLAUDE.md hard rules).
 */
import type { Action, ActionDraft } from '../core/actions';
import { DEFAULT_TABLE_SETTINGS, type CardInstance, type CardRef, type InstanceId, type LogEntry, type Pose, type RngPurpose, type SeatColourIndex, type SecretStore, type SeatId, type TableState, type Zone, type ZoneId, type ZoneSpec } from '../core/types';
import type { CardData, CardDataSource, DeckEntry, DeckList, FaceImage, FaceSource, ParseError, ResolvedDeck } from '../data/types';
import type { GameDefinition, SeatLayout, TableLayout } from '../games/types';
import { MTG_KEYMAP } from '../games/mtg/keymap';
import type { CameraRig, DebugCamera, FollowOptions, RenderStats, SceneDebugParts, TableCameraControls, TableScene, ViewState } from '../scene/types';
import type { QualityId, QualityLevel } from '../themes/types';
import type { ChatChannel } from '../net/messages';
import type { Presence } from '../net/types';
import { NULL_PRESENCE } from '../session/presence';
import type { DeckImport, LookedCard, NetStatusListener, SessionListener, SessionNetStatus, TableSession } from '../session/types';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../store/types';

// ---------------------------------------------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------------------------------------------

const ZONES: ZoneSpec[] = [
  { id: 'library', scope: 'seat', visibility: 'nobody', ordered: true, presentation: 'squared', label: 'Library' },
  { id: 'hand', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Hand' },
  { id: 'battlefield', scope: 'seat', visibility: 'public', ordered: false, presentation: 'free', label: 'Battlefield' },
  { id: 'graveyard', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Graveyard' },
  { id: 'exile', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Exile' },
  { id: 'command', scope: 'seat', visibility: 'public', ordered: false, presentation: 'area', label: 'Command' },
  { id: 'stack', scope: 'table', visibility: 'public', ordered: true, presentation: 'cascade-lane', label: 'Stack' },
];

/** The seven steps of the turn strip (DESIGN "Turn flow and confirmation"). */
export const FAKE_PHASES = [
  { id: 'untap', label: 'Untap' },
  { id: 'upkeep', label: 'Upkeep' },
  { id: 'draw', label: 'Draw' },
  { id: 'main1', label: 'Main 1' },
  { id: 'combat', label: 'Combat' },
  { id: 'main2', label: 'Main 2' },
  { id: 'end', label: 'End' },
];

function seat1v1(index: number): SeatLayout {
  const angle = index === 0 ? 0 : 180;
  const s = index === 0 ? 1 : -1;
  const pile = (k: number) => ({ x: s * (700 - 12 - 31.5), y: s * (-550 + 12 + 44 + k * (88 + 12)), rot: angle });
  return {
    index,
    angle,
    territory: { x: 0, y: s * -330, w: 1400, d: 440, rot: angle },
    zones: {
      library: pile(0),
      graveyard: pile(1),
      exile: pile(2),
      command: { x: s * -620, y: s * -330, w: 140, d: 200, rot: angle },
      avatar: { x: 0, y: s * -600, rot: angle },
      handRow: { x: 0, y: s * -580, w: 600, d: 60, rot: angle },
    },
  };
}

/** A game definition for tests: Magic's keymap and seven steps, a 1v1 layout (DESIGN "Specification: geometry, layout and motion"). */
export function fakeGame(): GameDefinition {
  const layout = (): TableLayout => ({ format: '1v1', table: { w: 1400, d: 1100 }, seats: [seat1v1(0), seat1v1(1)], stackLane: { x: 0, y: 0, w: 200, d: 320, rot: 0 } });
  return {
    id: 'mtg',
    zones: ZONES,
    phases: FAKE_PHASES,
    startingLife: () => 20,
    layout,
    cardBack: {
      id: 'fake-back',
      width: 488,
      height: 680,
      draw(ctx, w, h) {
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#8a8a8a';
        ctx.lineWidth = w / 40;
        ctx.strokeRect(w * 0.08, h * 0.06, w * 0.84, h * 0.88);
      },
    },
    defaultDestination: (item, card, instance) => {
      if (item.kind !== 'spell') return null;
      const owner = instance?.owner ?? item.controller;
      return /instant|sorcery/i.test(card?.type_line ?? '') ? `graveyard:${owner}` : `battlefield:${item.controller}`;
    },
    keymap: MTG_KEYMAP,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Card data (invented cards)
// ---------------------------------------------------------------------------------------------------------------

const card = (id: string, name: string, type_line: string, extra: Partial<CardData> = {}): CardData => ({
  id,
  name,
  set: 'tst',
  collector_number: id.replace(/\D/g, '') || '1',
  rarity: 'common',
  layout: 'normal',
  cmc: 2,
  type_line,
  color_identity: [],
  ...extra,
});

/** Invented test cards: a creature, an instant, a land, a double-faced card, a card with a related token, and tokens. */
export const FAKE_CARDS: CardData[] = [
  card('sid-bear', 'Test Bear', 'Creature — Bear', { mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: 'A plain test creature.' }),
  card('sid-bolt', 'Spark Jolt', 'Instant', { mana_cost: '{R}', cmc: 1, oracle_text: 'Spark Jolt deals 3 damage to any target.' }),
  card('sid-land', 'Verdant Field', 'Basic Land — Forest', { cmc: 0, oracle_text: '({T}: Add {G}.)' }),
  card('sid-dfc', 'Moon Sage', 'Creature — Human Wizard', {
    layout: 'transform',
    card_faces: [
      { name: 'Moon Sage', mana_cost: '{1}{U}', type_line: 'Creature — Human Wizard', oracle_text: 'At the beginning of each upkeep, transform Moon Sage.', power: '1', toughness: '3' },
      { name: 'Sun Sage', type_line: 'Creature — Human Wizard', oracle_text: 'Flying.', power: '3', toughness: '3' },
    ],
  }),
  card('sid-caller', 'Sprout Caller', 'Creature — Elf Druid', {
    mana_cost: '{2}{G}',
    power: '1',
    toughness: '1',
    oracle_text: 'When Sprout Caller enters, create a 1/1 green Sprout creature token.',
    all_parts: [{ id: 'sid-tok-sprout', component: 'token', name: 'Sprout', type_line: 'Token Creature — Sprout' }],
  }),
  card('sid-tok-sprout', 'Sprout', 'Token Creature — Sprout', { set: 'ttst', power: '1', toughness: '1' }),
  card('sid-tok-soldier', 'Soldier', 'Token Creature — Soldier', { set: 'ttst', power: '1', toughness: '1' }),
  card('sid-tok-treasure', 'Treasure', 'Token Artifact — Treasure', { set: 'ttst', oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.' }),
];

function distance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/** CardDataSource over an in-memory card list (DESIGN "Card data and images"). */
export class FakeCardData implements CardDataSource {
  readonly byId = new Map<string, CardData>();
  constructor(cards: CardData[] = FAKE_CARDS) {
    for (const c of cards) this.byId.set(c.id, c);
  }
  get(sid: string): Promise<CardData | null> {
    return Promise.resolve(this.byId.get(sid) ?? null);
  }
  async getMany(sids: string[]): Promise<Record<string, CardData>> {
    const out: Record<string, CardData> = {};
    for (const s of sids) {
      const c = this.byId.get(s);
      if (c) out[s] = c;
    }
    return out;
  }
  peek(sid: string): CardData | null {
    return this.byId.get(sid) ?? null;
  }
  async resolveDeck(list: DeckList): Promise<ResolvedDeck> {
    const all = [...this.byId.values()].filter((c) => !c.type_line.startsWith('Token'));
    const out: ResolvedDeck = { main: [], side: [], cards: {}, errors: [] };
    const take = (entries: DeckEntry[], into: CardRef[]) => {
      for (const e of entries) {
        const hit = all.find((c) => c.name.toLowerCase() === e.name.toLowerCase());
        if (!hit) {
          const near = all
            .map((c) => ({ n: c.name, d: distance(c.name.toLowerCase(), e.name.toLowerCase()) }))
            .filter((x) => x.d <= Math.max(3, Math.floor(e.name.length / 3)))
            .sort((a, b) => a.d - b.d)
            .map((x) => x.n);
          const err: ParseError = { line: e.line, text: `${e.count} ${e.name}`, kind: 'unresolved', message: `No card named "${e.name}"`, nearMatches: near.slice(0, 3) };
          out.errors.push(err);
          continue;
        }
        out.cards[hit.id] = hit;
        for (let i = 0; i < e.count; i++) into.push(e.foil ? { sid: hit.id, foil: true } : { sid: hit.id });
      }
    };
    take([...list.main, ...list.commander, ...list.companion], out.main);
    take(list.side, out.side);
    return out;
  }
  async searchTokens(query: string): Promise<CardData[]> {
    const q = query.trim().toLowerCase();
    return [...this.byId.values()].filter((c) => c.type_line.startsWith('Token') && c.name.toLowerCase().includes(q));
  }
  async relatedTokens(c: CardData): Promise<CardData[]> {
    return (c.all_parts ?? []).filter((p) => p.component === 'token').map((p) => this.byId.get(p.id)).filter((x): x is CardData => !!x);
  }
}

/** Faces as placeholders drawn from the card data (PLAN B0.5 `?faces=placeholder`). */
export class FakeFaces implements FaceSource {
  constructor(private readonly data: CardDataSource) {}
  async faceFor(ref: CardRef, faceIndex: 0 | 1): Promise<FaceImage> {
    const c = await this.data.get(ref.sid);
    const f = c?.card_faces?.[faceIndex];
    const name = f?.name ?? c?.name ?? 'Unknown card';
    const cost = f?.mana_cost ?? c?.mana_cost;
    const type = f?.type_line ?? c?.type_line;
    const text = f?.oracle_text ?? c?.oracle_text;
    const p = f?.power ?? c?.power;
    const t = f?.toughness ?? c?.toughness;
    const face: FaceImage = { kind: 'placeholder', face: { name } };
    if (cost) face.face.cost = cost;
    if (type) face.face.type = type;
    if (text) face.face.text = text;
    if (p !== undefined && t !== undefined) face.face.pt = `${p}/${t}`;
    return face;
  }
}

/** SettingsStore in memory, optionally mirrored to a Storage (the harness uses localStorage so remaps survive reloads). */
export class MemorySettings implements SettingsStore {
  readonly writes: { name: keyof Settings; value: unknown }[] = [];
  private values: Settings;
  constructor(
    initial: Partial<Settings> = {},
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = null,
    private readonly key = 'spellplane-ui-harness-settings',
  ) {
    let stored: Partial<Settings>;
    try {
      stored = storage ? (JSON.parse(storage.getItem(key) ?? '{}') as Partial<Settings>) : {};
    } catch {
      stored = {};
    }
    this.values = { ...DEFAULT_SETTINGS, ...initial, ...stored };
  }
  async get<K extends keyof Settings>(name: K): Promise<Settings[K]> {
    return structuredClone(this.values[name]);
  }
  async set<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void> {
    this.values = { ...this.values, [name]: structuredClone(value) };
    this.writes.push({ name, value: structuredClone(value) });
    this.storage?.setItem(this.key, JSON.stringify(this.values));
  }
  async all(): Promise<Settings> {
    return structuredClone(this.values);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Table state
// ---------------------------------------------------------------------------------------------------------------

const SEAT_ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const HIDDEN: Record<string, 'owner' | 'nobody'> = { library: 'nobody', hand: 'owner' };

/** A card placed by `tableWith`. */
export interface FakeCardSpec {
  id: InstanceId;
  zone: ZoneId;
  sid?: string;
  owner?: SeatId;
  controller?: SeatId;
  tapped?: boolean;
  face?: 'up' | 'down';
  faceIndex?: 0 | 1;
  pose?: { x: number; y: number; rot: number };
  counters?: Record<string, number>;
  home?: { x: number; y: number; rot: number };
  combat?: 'attack' | 'block';
}

/** A table with seats `names` and the given cards; hidden-zone identities go to the returned secrets (DESIGN "Table model"). */
export function tableWith(names: string[], cards: FakeCardSpec[], me: SeatId = 's0'): { state: TableState; secrets: SecretStore } {
  const seats: TableState['seats'] = {};
  const zones: Record<ZoneId, Zone> = {};
  names.forEach((name, index) => {
    const id = `s${index}`;
    seats[id] = { id, index, name, colour: index, life: 20, counters: {}, ready: true, autoPass: false };
    for (const kind of SEAT_ZONES) {
      const zid = `${kind}:${id}`;
      const vis = HIDDEN[kind];
      zones[zid] = vis ? { id: zid, kind, owner: id, visibility: vis, count: 0, ids: [] } : { id: zid, kind, owner: id, visibility: 'public', ids: [] };
    }
  });
  zones.stack = { id: 'stack', kind: 'stack', owner: null, visibility: 'public', ids: [] };
  const secrets: SecretStore = { seat: me, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
  const out: Record<InstanceId, CardInstance> = {};
  for (const c of cards) {
    const owner = c.owner ?? (c.zone.split(':')[1] || 's0');
    const z = zones[c.zone];
    if (!z) throw new Error(`no zone ${c.zone}`);
    const angle = seats[owner]?.index === 0 ? 0 : 180;
    const inst: CardInstance = {
      id: c.id,
      owner,
      controller: c.controller ?? owner,
      zone: c.zone,
      face: c.face ?? 'up',
      faceIndex: c.faceIndex ?? 0,
      tapped: !!c.tapped,
      pose: c.pose ?? { x: 0, y: 0, rot: angle },
      counters: c.counters ?? {},
    };
    if (c.home) inst.home = c.home;
    if (c.combat) inst.combat = c.combat;
    const hidden = z.visibility !== 'public' || inst.face === 'down';
    if (c.sid) {
      if (hidden) {
        if (owner === me) secrets.identities[c.id] = { card: { sid: c.sid }, salt: `salt-${c.id}` };
      } else inst.identity = { sid: c.sid };
    }
    if (z.visibility === 'public') z.ids.push(c.id);
    else {
      z.ids.push(c.id);
      z.ids.sort();
      z.count = z.ids.length;
      if (owner === me && z.kind === 'library') secrets.libraryOrder.push(c.id);
      if (owner === me && z.kind === 'hand') secrets.hand.push(c.id);
    }
    out[c.id] = inst;
  }
  const state: TableState = {
    seq: 0,
    game: 'mtg',
    format: '1v1',
    stage: 'match',
    seats,
    teams: {},
    cards: out,
    zones,
    stack: [],
    lines: {},
    turn: { number: 1, active: 's0', phase: 'main1' },
    confirm: null,
    commitments: {},
    rng: {},
    shuffles: {},
    settings: { ...DEFAULT_TABLE_SETTINGS },
  };
  return { state, secrets };
}

// ---------------------------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------------------------

/** A session call that is not a dispatch (draw, shuffle, mulligan, lookAt, importDeck, undo, playFaceDown, roll). */
export interface SessionCall {
  method: 'draw' | 'shuffle' | 'mulligan' | 'lookAt' | 'importDeck' | 'undo' | 'playFaceDown' | 'roll';
  args: unknown[];
}

function removeFrom(z: Zone, id: InstanceId): void {
  z.ids = z.ids.filter((x) => x !== id);
  if (z.visibility !== 'public') z.count = z.ids.length;
}
function addTo(z: Zone, id: InstanceId, index?: number): void {
  if (z.visibility === 'public') {
    if (index === undefined || index >= z.ids.length) z.ids.push(id);
    else z.ids.splice(Math.max(0, index), 0, id);
  } else {
    z.ids = [...z.ids, id].sort();
    z.count = z.ids.length;
  }
}

/**
 * TableSession in memory (PLAN M0-P7 contract). Records every dispatched action and session call, and applies a small
 * subset of actions to its state so the HUD visibly reacts; it is not the reducer.
 */
export class FakeSession implements TableSession {
  readonly dispatched: Action[] = [];
  readonly calls: SessionCall[] = [];
  private listeners = new Set<SessionListener>();
  private entries: LogEntry[] = [];
  private cid = 0;
  undoResult = true;

  constructor(
    private state: TableState,
    private secretStore: SecretStore,
    private readonly data: CardDataSource = new FakeCardData(),
    readonly seat: SeatId = 's0',
    private readonly clock: () => number = () => Date.now(),
  ) {}

  getState(): TableState {
    return this.state;
  }
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  secrets(): SecretStore {
    return this.secretStore;
  }
  cardData(ref: CardRef) {
    return this.data.peek(ref.sid);
  }
  /** Replace state (and secrets) and notify, as an applied remote action would. */
  setState(state: TableState, secrets?: SecretStore): void {
    this.state = state;
    if (secrets) this.secretStore = secrets;
    this.emit();
  }
  /** Append a log entry without applying anything (tests of the log panel). */
  pushLog(action: Action, at = this.clock()): void {
    this.entries = [...this.entries, { kind: 'action', seq: action.seq ?? this.entries.length + 1, at, action }];
    this.emit();
  }
  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
  dispatch(draft: ActionDraft): Action {
    const action = { ...draft, by: this.seat, cid: `${this.seat}-${++this.cid}`, seq: this.state.seq + 1 } as Action;
    this.dispatched.push(action);
    const next = structuredClone(this.state);
    next.seq = action.seq!;
    this.apply(next, action);
    this.state = next;
    this.entries = [...this.entries, { kind: 'action', seq: next.seq, at: this.clock(), action }];
    this.emit();
    return action;
  }

  private moveCard(st: TableState, id: InstanceId, to: ZoneId, index?: number): void {
    const c = st.cards[id];
    const z = st.zones[to];
    if (!c || !z) return;
    const from = st.zones[c.zone];
    if (from) removeFrom(from, id);
    this.secretStore = { ...this.secretStore, hand: this.secretStore.hand.filter((x) => x !== id), libraryOrder: this.secretStore.libraryOrder.filter((x) => x !== id) };
    addTo(z, id, index);
    c.zone = to;
    if (z.visibility === 'public') {
      const ref = this.secretStore.identities[id]?.card;
      if (!c.identity && ref && c.face === 'up') c.identity = ref;
    } else {
      delete c.identity;
      delete c.home;
      delete c.combat;
      c.tapped = false;
      c.counters = {};
      if (z.kind === 'hand' && z.owner === this.seat) this.secretStore.hand = [...this.secretStore.hand, id];
    }
  }

  private apply(st: TableState, a: Action): void {
    const c = 'card' in a && typeof a.card === 'string' ? st.cards[a.card] : undefined;
    switch (a.type) {
      case 'tap':
        if (c) c.tapped = a.tapped;
        break;
      case 'flip':
        if (c) {
          c.face = a.face;
          if (a.face === 'down') delete c.identity;
          else if (this.secretStore.identities[c.id]) c.identity = this.secretStore.identities[c.id]!.card;
        }
        break;
      case 'transform':
        if (c) c.faceIndex = a.faceIndex;
        break;
      case 'rotate':
        if (c) c.pose = { ...c.pose, rot: (((c.pose.rot + a.delta) % 360) + 360) % 360 };
        break;
      case 'counter':
        if (c) {
          const n = (c.counters[a.kind] ?? 0) + a.delta;
          if (n === 0) delete c.counters[a.kind];
          else c.counters[a.kind] = n;
        }
        break;
      case 'note':
        if (c) {
          if (a.text) c.note = a.text;
          else delete c.note;
        }
        break;
      case 'move':
        if (c) {
          this.moveCard(st, c.id, a.to, a.index);
          if (a.pose) c.pose = a.pose;
        }
        break;
      case 'toZone':
        if (c) this.moveCard(st, c.id, a.to);
        break;
      case 'moveTemp':
        if (c) {
          if (!c.home) c.home = c.pose;
          c.pose = a.pose;
          if (a.combat) c.combat = a.combat;
          if (a.tap) c.tapped = true;
        }
        break;
      case 'settle':
        for (const x of Object.values(st.cards)) {
          if (x.home && (!a.cards || a.cards.includes(x.id))) {
            x.pose = x.home;
            delete x.home;
            delete x.combat;
          }
        }
        break;
      case 'tidy':
        for (const [id, pose] of Object.entries(a.poses)) if (st.cards[id]) st.cards[id].pose = pose;
        break;
      case 'createToken':
      case 'copy': {
        const zone = a.type === 'createToken' ? a.zone : (st.cards[a.of]?.zone ?? `battlefield:${a.by}`);
        const ref = a.type === 'createToken' ? a.ref : st.cards[a.of]?.identity;
        const inst: CardInstance = { id: a.card, owner: a.by, controller: a.by, zone, face: 'up', faceIndex: 0, tapped: false, pose: a.pose, counters: {}, isToken: true };
        if (ref) inst.identity = ref;
        st.cards[a.card] = inst;
        const z = st.zones[zone];
        if (z) addTo(z, a.card);
        break;
      }
      case 'stackPush':
        st.stack.push({ id: a.item, kind: a.kind, controller: a.controller ?? a.by, ...(a.card ? { card: a.card } : {}), ...(a.source ? { source: a.source } : {}), ...(a.copyOf ? { copyOf: a.copyOf } : {}) });
        if (a.card) {
          this.moveCard(st, a.card, 'stack');
          const sc = st.cards[a.card];
          if (sc && !sc.identity && this.secretStore.identities[a.card]) sc.identity = this.secretStore.identities[a.card]!.card;
        }
        if (a.round) st.confirm = { id: a.round, askedBy: a.by, about: a.item, durationMs: 5000, startSeq: st.seq, responses: {} };
        break;
      case 'stackResolve':
      case 'stackCounter': {
        const item = st.stack.find((i) => i.id === a.item);
        st.stack = st.stack.filter((i) => i.id !== a.item);
        if (item?.card) {
          const owner = st.cards[item.card]?.owner ?? item.controller;
          const type = this.cardData(st.cards[item.card]?.identity ?? { sid: '' })?.type_line ?? '';
          const dest = a.to ?? (a.type === 'stackCounter' || /instant|sorcery/i.test(type) ? `graveyard:${owner}` : `battlefield:${item.controller}`);
          this.moveCard(st, item.card, dest);
        }
        if (st.confirm?.about === a.item) st.confirm = null;
        break;
      }
      case 'phaseSet':
        st.turn.phase = a.phase;
        break;
      case 'turnPass':
        st.turn = { number: st.turn.number + 1, active: a.to, phase: FAKE_PHASES[0]!.id };
        for (const s of Object.values(st.seats)) s.autoPass = false;
        break;
      case 'autoPass':
        if (st.seats[a.by]) st.seats[a.by]!.autoPass = a.on;
        break;
      case 'ask':
        st.confirm = { id: a.round, askedBy: a.by, durationMs: 5000, startSeq: st.seq, responses: {}, ...(a.label ? { label: a.label } : {}) };
        break;
      case 'respond':
        if (st.confirm && st.confirm.id === a.round) {
          if (a.response === 'release') {
            delete st.confirm.holder;
            st.confirm.responses[a.seat] = 'ok';
          } else {
            st.confirm.responses[a.seat] = a.response;
            if (a.response === 'hold') st.confirm.holder = a.seat;
          }
        }
        break;
      case 'life': {
        const s = st.seats[a.seat];
        if (s) s.life += a.delta;
        break;
      }
      case 'playerCounter': {
        const s = st.seats[a.seat];
        if (s) {
          const n = (s.counters[a.kind] ?? 0) + a.delta;
          if (n === 0) delete s.counters[a.kind];
          else s.counters[a.kind] = n;
        }
        break;
      }
      default:
        break;
    }
  }

  async importDeck(deck: DeckImport): Promise<void> {
    this.calls.push({ method: 'importDeck', args: [deck] });
    const next = structuredClone(this.state);
    const lib = next.zones[`library:${this.seat}`];
    const ids: InstanceId[] = [];
    deck.main.forEach((ref, i) => {
      const id = `lib-${this.seat}-${i}`;
      ids.push(id);
      next.cards[id] = { id, owner: this.seat, controller: this.seat, zone: `library:${this.seat}`, face: 'down', faceIndex: 0, tapped: false, pose: { x: 0, y: 0, rot: 0 }, counters: {} };
      this.secretStore.identities[id] = { card: ref, salt: `salt-${id}` };
    });
    if (lib) {
      lib.ids = [...lib.ids, ...ids].sort();
      if (lib.visibility !== 'public') lib.count = lib.ids.length;
    }
    this.secretStore = { ...this.secretStore, libraryOrder: [...this.secretStore.libraryOrder, ...ids] };
    this.state = next;
    this.emit();
  }
  async shuffle(zone?: ZoneId): Promise<void> {
    this.calls.push({ method: 'shuffle', args: zone === undefined ? [] : [zone] });
  }
  async draw(n = 1): Promise<void> {
    this.calls.push({ method: 'draw', args: [n] });
    const next = structuredClone(this.state);
    for (let i = 0; i < n; i++) {
      const top = this.secretStore.libraryOrder[0];
      if (!top) break;
      this.moveCard(next, top, `hand:${this.seat}`);
    }
    this.state = next;
    this.emit();
  }
  async mulligan(): Promise<void> {
    this.calls.push({ method: 'mulligan', args: [] });
  }
  async lookAt(zone: ZoneId, n: number): Promise<LookedCard[]> {
    this.calls.push({ method: 'lookAt', args: [zone, n] });
    const order = zone === `library:${this.seat}` ? this.secretStore.libraryOrder : (this.state.zones[zone]?.ids ?? []);
    return order.slice(0, n).map((id) => ({ id, ref: this.secretStore.identities[id]?.card ?? { sid: 'unknown' } }));
  }
  undo(): boolean {
    this.calls.push({ method: 'undo', args: [] });
    return this.undoResult;
  }
  canUndo(): boolean {
    return this.undoResult;
  }
  log(): LogEntry[] {
    return this.entries;
  }
  dispose(): void {
    this.listeners.clear();
  }

  // Members added to TableSession by M1-C: recorded, with solo-table answers.
  readonly roomId = 'fake';
  readonly presence: Presence = NULL_PRESENCE;
  playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action {
    this.calls.push({ method: 'playFaceDown', args: pose ? [card, to, pose] : [card, to] });
    return this.dispatch({ type: 'move', card, to, ...(pose ? { pose } : {}) });
  }
  chat(text: string, channel: ChatChannel = 'table'): Action {
    return this.dispatch({ type: 'chat', text, channel });
  }
  takeSeat(seat: SeatId, colour: SeatColourIndex): Action {
    return this.dispatch({ type: 'seatTake', seat, name: this.state.seats[this.seat]?.name ?? '', colour });
  }
  async roll(purpose: RngPurpose, n: number): Promise<number> {
    this.calls.push({ method: 'roll', args: [purpose, n] });
    return 0;
  }
  netStatus(): SessionNetStatus {
    return { mode: 'solo', connection: 'solo', peers: [], sequencer: null, seq: this.state.seq };
  }
  subscribeNet(_listener: NetStatusListener): () => void {
    return () => undefined;
  }
  whenSaved(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scene (no DOM): records camera calls and drags
// ---------------------------------------------------------------------------------------------------------------

/** A scene call the HUD made (camera moves, drag hand-over). */
export type SceneCall = { method: string; args: unknown[] };

/** TableScene without rendering (PLAN M0-P4: code against TableScene only). The harness adds a DOM view on top. */
export class RecordingScene implements TableScene {
  readonly calls: SceneCall[] = [];
  lastState: TableState | null = null;
  lastView: ViewState | null = null;
  private currentRig: CameraRig = 'birdseye';
  private currentQuality: QualityId = 'high';
  private currentFollow: FollowOptions = { stack: false, activePlayer: false };
  readonly camera: TableCameraControls;
  readonly debug: SceneDebugParts;

  constructor() {
    const rec = (method: string) => (...args: unknown[]) => {
      this.calls.push({ method, args });
    };
    this.camera = {
      fit: rec('camera.fit'),
      zoomAt: rec('camera.zoomAt'),
      panBy: rec('camera.panBy'),
      goToSeat: rec('camera.goToSeat'),
      zoomTo: rec('camera.zoomTo'),
      setRig: (rig: CameraRig) => {
        this.currentRig = rig;
        this.calls.push({ method: 'camera.setRig', args: [rig] });
      },
      rig: () => this.currentRig,
      pitchBy: rec('camera.pitchBy'),
      follow: () => ({ ...this.currentFollow }),
      setFollow: (next: Partial<FollowOptions>) => {
        this.currentFollow = { ...this.currentFollow, ...next };
        this.calls.push({ method: 'camera.setFollow', args: [next] });
      },
      blend: () => null,
      pose: () => ({ position: [0, 0, 0], target: [0, 0, 0], fovDeg: 6, pitchDeg: 90 }),
    };
    const cam: DebugCamera = { rig: 'birdseye', fov: 6, position: [0, 0, 0], pitch: 90 };
    this.debug = { cards: () => [], camera: () => ({ ...cam, rig: this.currentRig }), lines: () => Object.values(this.lastState?.lines ?? {}), frameStats: () => ({ drawCalls: 0, textureBytes: 0, frameMs: 0 }) };
  }
  update(state: TableState, view: ViewState): void {
    this.lastState = state;
    this.lastView = view;
  }
  setTheme(_theme: unknown): void {}
  /** Records the back's id and size (M5-P5 card back setting). */
  setCardBack(back: { id: string; width: number; height: number } | null): void {
    this.calls.push({ method: 'setCardBack', args: [back ? { id: back.id, width: back.width, height: back.height } : null] });
  }
  setLayout(_layout: unknown, _viewerSeat: unknown): void {}
  setQuality(id: QualityId): void {
    this.currentQuality = id;
    this.calls.push({ method: 'setQuality', args: [id] });
  }
  quality(): QualityLevel {
    return { id: this.currentQuality, shadows: false, post: false, particles: false, pixelRatio: 1 };
  }
  renderStats(): RenderStats {
    return { drawCalls: 0, textureBytes: 0, frameMs: 0, triangles: 0, textures: 0, geometries: 0, programs: 0, passes: [], shadows: false, quality: this.currentQuality, theme: 'paper' };
  }
  cardAt(_x: number, _y: number): InstanceId | null {
    return null;
  }
  zoneAt(_x: number, _y: number): ZoneId | null {
    return null;
  }
  startDrag(card: InstanceId, x: number, y: number): void {
    this.calls.push({ method: 'startDrag', args: [card, x, y] });
  }
  worldToScreen(_p: { x: number; y: number; z: number }): { x: number; y: number } | null {
    return null;
  }
  screenToTable(x: number, y: number): { x: number; y: number } | null {
    return { x, y };
  }
  dispose(): void {}
}
