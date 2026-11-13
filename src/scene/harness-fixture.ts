/**
 * Synthetic data for the scene test page (`?harness=scene`): a 1v1 table layout following DESIGN "Specification:
 * geometry, layout and motion" (Tables and seats), a minimal game definition, placeholder faces, a TableState
 * (scenarios `demo`, `bench` with 300 rendered cards, `empty`) and a local reducer stub for the card actions the
 * scene emits. The real engine (M0-P1) and Magic definition (M0-P6) replace these in the app; the harness keeps its
 * own so scene tests do not depend on other packages. No DOM at module level (unit tests import it in Node).
 */
import type { Action } from '../core/actions';
import type { CardInstance, CardRef, HiddenZone, PileRef, Pose, PublicZone, SeatId, TableState, Zone, ZoneId, ZoneSpec } from '../core/types';
import { DEFAULT_TABLE_SETTINGS } from '../core/types';
import type { FaceSource, PlaceholderFace } from '../data/types';
import type { GameDefinition, Rect, SeatLayout, TableLayout } from '../games/types';
import { MTG_KEYMAP } from '../games/mtg/keymap';
import type { TextureSource } from '../util/texture';
import { rot2 } from './math';

export type HarnessScenario = 'demo' | 'bench' | 'empty';

const ZONES: ZoneSpec[] = [
  { id: 'library', scope: 'seat', visibility: 'nobody', ordered: true, presentation: 'squared', label: 'Library' },
  { id: 'hand', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Hand' },
  { id: 'battlefield', scope: 'seat', visibility: 'public', ordered: false, presentation: 'free', label: 'Battlefield' },
  { id: 'graveyard', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Graveyard' },
  { id: 'exile', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Exile' },
  { id: 'command', scope: 'seat', visibility: 'public', ordered: false, presentation: 'area', label: 'Command' },
  { id: 'sideboard', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'hidden', label: 'Sideboard' },
  { id: 'stack', scope: 'table', visibility: 'public', ordered: true, presentation: 'cascade-lane', label: 'Stack' },
];

/** A seat's layout from its territory: piles in a column at the right edge (library nearest the owner, 12 apart). */
function seatLayout(index: number, angle: number, territory: Rect): SeatLayout {
  const at = (lx: number, ly: number, rot = angle): Pose => {
    const [x, y] = rot2(lx, ly, territory.rot);
    return { x: territory.x + x, y: territory.y + y, rot };
  };
  const hw = territory.w / 2;
  const hd = territory.d / 2;
  const colX = hw - 12 - 31.5;
  const lib = -hd + 12 + 44;
  const cmd = at(-hw + 12 + 75, -hd + 12 + 100);
  const hand = at(0, -hd - 56);
  return {
    index,
    angle,
    territory,
    zones: {
      library: at(colX, lib),
      graveyard: at(colX, lib + 88 + 12),
      exile: at(colX, lib + 2 * (88 + 12)),
      command: { x: cmd.x, y: cmd.y, w: 150, d: 200, rot: angle },
      avatar: at(0, -hd - 30),
      handRow: { x: hand.x, y: hand.y, w: 520, d: 88, rot: angle },
    },
  };
}

/** The 1v1 table: 1400 x 1100, seats at 0 and 180 degrees, 1400 x 440 territories, 220-deep centre band. */
export function harnessLayout(): TableLayout {
  return {
    format: '1v1',
    table: { w: 1400, d: 1100 },
    seats: [seatLayout(0, 0, { x: 0, y: -330, w: 1400, d: 440, rot: 0 }), seatLayout(1, 180, { x: 0, y: 330, w: 1400, d: 440, rot: 180 })],
    stackLane: { x: 0, y: 0, w: 200, d: 320, rot: 0 },
  };
}

/** A neutral card back (no official back): ink frame and a geometric lozenge, Paper style. */
export const HARNESS_BACK: TextureSource = {
  id: 'harness-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    ctx.fillStyle = '#16161a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2d36';
    ctx.fillRect(w * 0.06, h * 0.045, w * 0.88, h * 0.91);
    ctx.strokeStyle = '#8b8fa3';
    ctx.lineWidth = w * 0.012;
    ctx.strokeRect(w * 0.1, h * 0.075, w * 0.8, h * 0.85);
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.2);
    ctx.lineTo(w * 0.78, h / 2);
    ctx.lineTo(w / 2, h * 0.8);
    ctx.lineTo(w * 0.22, h / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.09, 0, Math.PI * 2);
    ctx.stroke();
  },
};

export const harnessGame: GameDefinition = {
  id: 'mtg',
  zones: ZONES,
  phases: [
    { id: 'untap', label: 'Untap' },
    { id: 'main1', label: 'Main 1' },
    { id: 'end', label: 'End' },
  ],
  startingLife: () => 20,
  layout: () => harnessLayout(),
  cardBack: HARNESS_BACK,
  defaultDestination: () => null,
  keymap: MTG_KEYMAP,
};

const STEMS = ['Bear', 'Elf', 'Drake', 'Knight', 'Golem', 'Sprite', 'Wurm', 'Cleric', 'Rogue', 'Shaman', 'Angel', 'Zombie', 'Giant', 'Mage', 'Hound', 'Serpent'];
const KINDS: { cost: string; type: string; pt?: string; text?: string }[] = [
  { cost: '{1}{G}', type: 'Creature — Bear', pt: '2/2', text: 'A sturdy beast of the woods.' },
  { cost: '{2}{U}', type: 'Creature — Drake', pt: '2/3', text: 'Flying' },
  { cost: '{R}', type: 'Instant', text: 'Deal 3 damage to any target.' },
  { cost: '{3}{W}{W}', type: 'Creature — Angel', pt: '4/4', text: 'Flying, vigilance' },
  { cost: '{B}{B}', type: 'Sorcery', text: 'Target player discards two cards.' },
  { cost: '', type: 'Basic Land — Forest', text: '(T: Add G.)' },
  { cost: '{2}', type: 'Artifact', text: 'T: Add one mana of any colour.' },
];

/** Placeholder face of a harness card id: `fx-<n>` or any string. Deterministic. */
export function harnessFace(sid: string): PlaceholderFace {
  const n = Number.parseInt(sid.replace(/\D+/g, ''), 10);
  const i = Number.isFinite(n) ? n : [...sid].reduce((a, c) => a + c.charCodeAt(0), 0);
  const k = KINDS[i % KINDS.length]!;
  const land = k.type.includes('Land');
  const name = land ? `Forest ${i}` : `${STEMS[i % STEMS.length]} ${i}`;
  return { name, cost: k.cost || undefined, type: k.type, text: k.text, pt: k.pt };
}

/** Faces drawn as placeholders (PLAN B0.5: tests never load images). */
export const harnessFaces: FaceSource = {
  faceFor(ref: CardRef, faceIndex: 0 | 1) {
    const face = harnessFace(ref.sid);
    return Promise.resolve({ kind: 'placeholder', face: faceIndex === 1 ? { ...face, name: `${face.name} (back face)` } : face });
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const zid = (kind: string, seat: SeatId | null) => (seat ? `${kind}:${seat}` : kind);

function emptyState(): TableState {
  const s: TableState = {
    seq: 0,
    game: 'mtg',
    format: '1v1',
    stage: 'match',
    seats: {},
    teams: {},
    cards: {},
    zones: {},
    stack: [],
    lines: {},
    turn: { number: 1, active: 's0', phase: 'main1' },
    confirm: null,
    commitments: {},
    rng: {},
    shuffles: {},
    settings: { ...DEFAULT_TABLE_SETTINGS },
  };
  ['Ada', 'Bo'].forEach((name, index) => {
    const id = `s${index}`;
    s.seats[id] = { id, index, name, colour: index, life: 20, counters: {}, ready: true, autoPass: false };
    for (const z of ZONES) {
      if (z.scope !== 'seat') continue;
      const id2 = zid(z.id, id);
      s.zones[id2] =
        z.visibility === 'public'
          ? ({ id: id2, kind: z.id, owner: id, visibility: 'public', ids: [] } satisfies PublicZone)
          : ({ id: id2, kind: z.id, owner: id, visibility: z.visibility, count: 0, ids: [] } satisfies HiddenZone);
    }
  });
  s.zones.stack = { id: 'stack', kind: 'stack', owner: null, visibility: 'public', ids: [] };
  return s;
}

function addCard(s: TableState, c: Omit<CardInstance, 'counters' | 'faceIndex' | 'tapped' | 'face'> & Partial<CardInstance>): CardInstance {
  const card: CardInstance = { face: 'up', faceIndex: 0, tapped: false, counters: {}, ...c };
  s.cards[card.id] = card;
  const z = s.zones[card.zone]!;
  z.ids.push(card.id);
  if (z.visibility !== 'public') {
    z.ids.sort();
    z.count = z.ids.length;
  }
  return card;
}

/** A fresh harness table. `bench` renders 300 cards; `demo` is a small mid-game board; `empty` has no cards. */
export function buildHarnessState(opts: { scenario: HarnessScenario }): TableState {
  const s = emptyState();
  if (opts.scenario === 'empty') return s;
  const layout = harnessLayout();
  let n = 0;
  const ref = (): CardRef => ({ sid: `fx-${++n}` });
  const bench = opts.scenario === 'bench';
  for (const seat of ['s0', 's1']) {
    const sl = layout.seats[s.seats[seat]!.index]!;
    const angle = sl.angle;
    const local = (lx: number, ly: number): Pose => {
      const [x, y] = rot2(lx, ly, sl.territory.rot);
      return { x: sl.territory.x + x, y: sl.territory.y + y, rot: angle };
    };
    const libN = bench ? 40 : 33;
    for (let i = 0; i < libN; i++) addCard(s, { id: `${seat}-l${String(i).padStart(2, '0')}`, owner: seat, controller: seat, zone: zid('library', seat), face: 'down', pose: sl.zones.library });
    const gyN = bench ? 10 : 3;
    for (let i = 0; i < gyN; i++) addCard(s, { id: `${seat}-g${i}`, owner: seat, controller: seat, zone: zid('graveyard', seat), identity: ref(), pose: sl.zones.graveyard });
    addCard(s, { id: `${seat}-x0`, owner: seat, controller: seat, zone: zid('exile', seat), identity: ref(), pose: sl.zones.exile });
    addCard(s, { id: `${seat}-x1`, owner: seat, controller: seat, zone: zid('exile', seat), face: 'down', pose: sl.zones.exile });
    if (seat === 's1') for (let i = 0; i < 7; i++) addCard(s, { id: `s1-h${i}`, owner: seat, controller: seat, zone: zid('hand', seat), face: 'down', pose: sl.zones.library });
    // Battlefield: a squared token pile, a cascade of lands, one own face-down card, then a grid.
    const bf = zid('battlefield', seat);
    const tokenRef = ref();
    for (let i = 0; i < 5; i++)
      addCard(s, { id: `${seat}-t${i}`, owner: seat, controller: seat, zone: bf, identity: tokenRef, isToken: true, pose: local(-480, 120), pile: { id: `${seat}-tokens`, index: i, kind: 'squared' } });
    for (let i = 0; i < 4; i++) {
      const p = local(-400, 120);
      const [ox, oy] = rot2(0, -14 * i, angle);
      addCard(s, { id: `${seat}-f${i}`, owner: seat, controller: seat, zone: bf, identity: { sid: `fx-${5 + 7 * i}` }, pose: { x: p.x + ox, y: p.y + oy, rot: angle }, pile: { id: `${seat}-lands`, index: i, kind: 'cascade' } });
    }
    addCard(s, { id: `${seat}-d0`, owner: seat, controller: seat, zone: bf, face: 'down', pose: local(-320, 120) });
    const gridN = bench ? (seat === 's0' ? 90 : 81) : 6;
    for (let i = 0; i < gridN; i++) {
      const col = i % 15;
      const row = Math.floor(i / 15);
      const p = local(-240 + col * 58, 150 - row * 64);
      addCard(s, { id: `${seat}-b${String(i).padStart(2, '0')}`, owner: seat, controller: seat, zone: bf, identity: ref(), pose: p, tapped: !bench && i === 1 ? true : false });
    }
    if (!bench) s.cards[`${seat}-b00`]!.counters = { '+1/+1': 2 };
  }
  return s;
}

/** Identities only the harness viewer (seat s0) may see: its own face-down cards (drawn dimmed). */
export function harnessPrivateFaces(): Record<string, CardRef> {
  return { 's0-d0': { sid: 'fx-900' }, 's0-x1': { sid: 'fx-901' } };
}

// ---------------------------------------------------------------------------
// Reducer stub (harness only; the real reducer is core/reducer, M0-P1)
// ---------------------------------------------------------------------------

function removeFromZone(s: TableState, c: CardInstance): void {
  const z = s.zones[c.zone];
  if (!z) return;
  z.ids = z.ids.filter((id) => id !== c.id);
  if (z.visibility !== 'public') z.count = z.ids.length;
}

function addToZone(s: TableState, c: CardInstance, to: ZoneId, index?: number): void {
  const z: Zone | undefined = s.zones[to];
  if (!z) return;
  c.zone = to;
  if (z.visibility === 'public') {
    if (index === undefined || index >= z.ids.length) z.ids.push(c.id);
    else z.ids.splice(Math.max(0, index), 0, c.id);
  } else {
    z.ids.push(c.id);
    z.ids.sort();
    z.count = z.ids.length;
  }
}

/** Renumber a pile 0..n-1 by index; a pile left with one card dissolves. `last` sorts after equal indices. */
function renumber(s: TableState, pile: string, last?: string, dissolve = false): void {
  const members = Object.values(s.cards).filter((c) => c.pile?.id === pile);
  members.sort((a, b) => a.pile!.index - b.pile!.index || (a.id === last ? 1 : b.id === last ? -1 : 0));
  if (dissolve && members.length < 2) {
    for (const m of members) delete m.pile;
    return;
  }
  members.forEach((m, i) => (m.pile = { ...m.pile!, index: i }));
}

function setPile(s: TableState, c: CardInstance, pile: PileRef | null): void {
  const old = c.pile?.id;
  if (pile) c.pile = { ...pile };
  else delete c.pile;
  if (old && old !== pile?.id) renumber(s, old, undefined, true);
  if (pile) renumber(s, pile.id, c.id);
}

/** Apply a card action to a copy of the state. Unknown or inapplicable actions return the state unchanged. */
export function harnessReduce(state: TableState, a: Action): TableState {
  const s = structuredClone(state);
  const card = 'card' in a && typeof a.card === 'string' ? s.cards[a.card] : undefined;
  switch (a.type) {
    case 'move': {
      if (!card || !s.zones[a.to]) return state;
      removeFromZone(s, card);
      addToZone(s, card, a.to, a.index);
      if (a.pose) card.pose = { ...a.pose };
      if (a.controller) card.controller = a.controller;
      if (a.pile !== undefined) setPile(s, card, a.pile);
      if (!s.zones[a.to]!.kind.startsWith('battlefield')) {
        if (card.pile) setPile(s, card, null);
      }
      break;
    }
    case 'moveTemp':
      if (!card) return state;
      if (!card.home) card.home = { ...card.pose };
      card.pose = { ...a.pose };
      if (a.combat) card.combat = a.combat;
      break;
    case 'pile':
      if (!card) return state;
      if (a.pose) card.pose = { ...a.pose };
      setPile(s, card, a.pile);
      break;
    case 'tap':
      if (!card || card.tapped === a.tapped) return state;
      // Flag only, as the reducer (M0-P1) does: the scene draws the tap turn from the flag.
      card.tapped = a.tapped;
      break;
    case 'flip':
      if (!card) return state;
      card.face = a.face;
      if (a.ref) card.identity = a.ref;
      break;
    case 'transform':
      if (!card) return state;
      card.faceIndex = a.faceIndex;
      break;
    case 'rotate':
      if (!card) return state;
      card.pose = { ...card.pose, rot: (((card.pose.rot + a.delta) % 360) + 360) % 360 };
      break;
    case 'counter': {
      if (!card) return state;
      const v = (card.counters[a.kind] ?? 0) + a.delta;
      if (v === 0) delete card.counters[a.kind];
      else card.counters[a.kind] = v;
      break;
    }
    case 'note':
      if (!card) return state;
      if (a.text) card.note = a.text;
      else delete card.note;
      break;
    case 'createToken': {
      if (s.cards[a.card] || !s.zones[a.zone]) return state;
      const owner = s.zones[a.zone]!.owner ?? a.by;
      const c: CardInstance = { id: a.card, owner: a.by, controller: a.controller ?? owner, zone: a.zone, face: 'up', faceIndex: 0, tapped: false, pose: { ...a.pose }, counters: {}, isToken: true };
      if (a.ref) c.identity = a.ref;
      if (a.label) c.tokenLabel = a.label;
      s.cards[c.id] = c;
      addToZone(s, c, a.zone);
      break;
    }
    case 'toZone':
      if (!card || !s.zones[a.to]) return state;
      if (card.pile) setPile(s, card, null);
      removeFromZone(s, card);
      addToZone(s, card, a.to);
      card.tapped = false;
      // Into a hidden zone: shared state drops the identity (DESIGN "Table model", Hidden cards).
      delete card.identity;
      card.face = 'down';
      break;
    case 'remove':
      if (!card) return state;
      if (card.pile) setPile(s, card, null);
      removeFromZone(s, card);
      delete s.cards[card.id];
      break;
    case 'stackPush':
      if (a.card) {
        const c = s.cards[a.card];
        if (!c) return state;
        if (c.pile) setPile(s, c, null);
        removeFromZone(s, c);
        addToZone(s, c, 'stack');
      }
      s.stack.push({ id: a.item, kind: a.kind, controller: a.controller ?? a.by, ...(a.card ? { card: a.card } : {}) });
      break;
    case 'turnPass':
      // The next turn (M4-P1's follow-the-active-player tests): the turn number counts up, the phase is kept.
      s.turn = { ...s.turn, number: s.turn.number + 1, active: a.to };
      break;
    case 'lineAdd':
      s.lines[a.line] = { id: a.line, kind: a.kind, from: a.from, to: a.to, by: a.by, ...(a.label ? { label: a.label } : {}) };
      break;
    case 'lineRemove':
      delete s.lines[a.line];
      break;
    default:
      return state;
  }
  s.seq = state.seq + 1;
  return s;
}

// ---------------------------------------------------------------------------
// Multi-seat tables (M3-P1): `?harness=scene&format=ffa3|ffa4|2hg&viewer=s0..s3`
// ---------------------------------------------------------------------------

const MULTI_NAMES = ['Ada', 'Bo', 'Cy', 'Di'];

/**
 * A table of `format` laid out by `layout` (the Magic layout of that format): every chair taken, Two-Headed Giant teams
 * t0 (s0, s1) and t1 (s2, s3) with one shared life total, and per seat a small library, one graveyard card and two
 * creatures in its battlefield's front row (`<seat>-c0`, `<seat>-c1`), upright for their owner.
 */
export function buildFormatState(format: TableState['format'], layout: TableLayout, seats: number): TableState {
  const s = emptyState();
  s.format = format;
  s.seats = {};
  s.zones = { stack: s.zones.stack! };
  const team = (i: number) => (format === '2hg' ? `t${i < 2 ? 0 : 1}` : undefined);
  for (let index = 0; index < seats; index++) {
    const id = `s${index}`;
    const t = team(index);
    s.seats[id] = { id, index, name: MULTI_NAMES[index]!, colour: index, life: format === '2hg' ? 30 : 20, counters: {}, ready: true, autoPass: false, ...(t ? { team: t } : {}) };
    if (t) {
      const tm = (s.teams[t] ??= { id: t, seats: [], life: 30, counters: {} });
      tm.seats.push(id);
    }
    for (const z of ZONES) {
      if (z.scope !== 'seat') continue;
      const zid2 = zid(z.id, id);
      s.zones[zid2] =
        z.visibility === 'public'
          ? ({ id: zid2, kind: z.id, owner: id, visibility: 'public', ids: [] } satisfies PublicZone)
          : ({ id: zid2, kind: z.id, owner: id, visibility: z.visibility, count: 0, ids: [] } satisfies HiddenZone);
    }
  }
  s.turn = { number: 1, active: format === '2hg' ? 't0' : 's0', phase: 'main1' };
  let n = 0;
  for (const seat of Object.values(s.seats)) {
    const sl = layout.seats[seat.index]!;
    const local = (lx: number, ly: number): Pose => {
      const [x, y] = rot2(lx, ly, sl.territory.rot);
      return { x: sl.territory.x + x, y: sl.territory.y + y, rot: sl.angle };
    };
    for (let i = 0; i < 5; i++) addCard(s, { id: `${seat.id}-l${i}`, owner: seat.id, controller: seat.id, zone: zid('library', seat.id), face: 'down', pose: sl.zones.library });
    addCard(s, { id: `${seat.id}-g0`, owner: seat.id, controller: seat.id, zone: zid('graveyard', seat.id), identity: { sid: `fx-${++n}` }, pose: sl.zones.graveyard });
    // Front row (toward the table centre), a little left of centre: clear of the pile column and the command area.
    for (let i = 0; i < 2; i++) {
      addCard(s, { id: `${seat.id}-c${i}`, owner: seat.id, controller: seat.id, zone: zid('battlefield', seat.id), identity: { sid: `fx-${100 + seat.index * 2 + i}` }, pose: local(-120 + i * 90, sl.territory.d / 2 - 70) });
    }
  }
  return s;
}
