/**
 * Fakes for the draft UI's tests and its module test page (src/ui/draft/harness.ts): a table shared by several local
 * seats whose public actions go through the real reducer (so `lobbySet` and `settings` are checked exactly as at a real
 * table), an EveningControls over it, a SetDataSource over a fixed list, and a simulated draft (pass, Rochester, Grid,
 * Winston and sealed) that drives `TableState.draft` and offers each seat its DraftControls, built against the M2-C contracts
 * (PLAN M2-P4: build against M2-C contracts with fakes). The simulation stands in for the format drivers (M2-P2,
 * M2-P3): it keeps every seat's packs in one place and is not a model of the network.
 */
import type { Action, ActionDraft } from '../../core/actions';
import { createDraftState, passTarget, pickTimerMs } from '../../core/drafting';
import { createTable, explain, reduce } from '../../core/reducer/index';
import { seatsInOrder } from '../../core/selectors';
import type { CardRef, DeckBuild, DraftCard, DraftPack, Format, InstanceId, LobbySettings, PackId, SecretStore, SeatId, TableState } from '../../core/types';
import { DEFAULT_LOBBY_SETTINGS } from '../../core/types';
import type { CardData, SetData, SetDataSource, SetSummary } from '../../data/types';
import type { DraftControls, DraftPrivateView, FrontPack } from '../../draft/types';
import { mtg } from '../../games/index';
import type { PeerPresence, Presence } from '../../net/types';
import type { EveningControls, SessionListener } from '../../session/types';
import { FakeCardData, FakeSession } from '../fakes';

// ---------------------------------------------------------------------------------------------------------------------
// A table shared by local seats
// ---------------------------------------------------------------------------------------------------------------------

/** A table several local seats share; public actions go through the real reducer. */
export class LocalTable {
  state: TableState;
  /** Every applied action, in order. */
  readonly applied: Action[] = [];
  /** Refused proposals with the reducer's reason. */
  readonly refused: { action: Action; reason: string }[] = [];
  private readonly listeners = new Set<SessionListener>();
  private cid = 0;
  /** Cursors between the seats of this table (as the `pres` channel would carry them). */
  readonly presence = new LocalPresence();

  constructor(names: readonly string[], format: Format = names.length === 2 ? '1v1' : names.length === 3 ? 'ffa3' : 'ffa4') {
    this.state = createTable({ game: mtg, format, seats: names.map((name, i) => ({ name, colour: i as 0 })) });
  }

  subscribe(l: SessionListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Stamp and apply as seat `by`; a refused action leaves the table unchanged (as a refused proposal is rolled back). */
  dispatch(by: SeatId, draft: ActionDraft): Action {
    const action = { ...draft, by, cid: `${by}-${++this.cid}`, seq: this.state.seq + 1 } as Action;
    const reason = explain(this.state, action);
    if (reason !== null) {
      this.refused.push({ action, reason });
      return action;
    }
    this.applied.push(action);
    this.set(reduce(this.state, action));
    return action;
  }

  /** Replace the state (the draft simulation's moves) and notify; the seq advances by one. */
  set(next: TableState): void {
    this.state = next.seq === this.state.seq ? { ...next, seq: this.state.seq + 1 } : next;
    for (const l of [...this.listeners]) l(this.state);
  }

  /** A TableSession for one seat of this table. */
  session(seat: SeatId, data: FakeCardData = new FakeCardData()): TableSeatSession {
    return new TableSeatSession(this, seat, data);
  }
}

/** One presence message a seat sent (LocalPresence.sent). */
export interface SentPresence {
  seat: SeatId;
  cursor: { x: number; y: number } | null;
  over: InstanceId | null;
  /** The dragged cards for a drag message, null for a cursor message. */
  drag: { id: InstanceId; pose: { x: number; y: number; rot: number } }[] | null;
}

/**
 * Presence among the seats of one LocalTable: what a seat sends is recorded (`sent`) and reaches every other seat's
 * listeners at once, as the unreliable `pres` channel would without loss. Not throttled.
 */
export class LocalPresence {
  readonly sent: SentPresence[] = [];
  private readonly latest = new Map<SeatId, PeerPresence>();
  private readonly listeners = new Map<SeatId, Set<(peers: PeerPresence[]) => void>>();

  /** Seat `seat`'s Presence. */
  channel(seat: SeatId): Presence {
    const update = (patch: Partial<PeerPresence>): void => {
      const prev = this.latest.get(seat) ?? { peerId: `peer-${seat}`, seat, cursor: null, over: null, drag: [], speaking: false, typing: null, caption: null, at: 0 };
      this.latest.set(seat, { ...prev, ...patch, at: Date.now() });
      for (const [other, set] of this.listeners) {
        if (other === seat) continue;
        const peers = this.peers(other);
        for (const l of [...set]) l(peers);
      }
    };
    return {
      cursor: (at, over = null) => {
        this.sent.push({ seat, cursor: at ? { x: at.x, y: at.y } : null, over, drag: null });
        update({ cursor: at ? { x: at.x, y: at.y } : null, over });
      },
      drag: (cards) => {
        const drag = cards.map((c) => ({ id: c.id, pose: { ...c.pose } }));
        this.sent.push({ seat, cursor: null, over: null, drag });
        update({ drag });
      },
      speaking: () => undefined,
      typing: () => undefined,
      captionInterim: () => undefined,
      peers: () => this.peers(seat),
      subscribe: (listener) => {
        let set = this.listeners.get(seat);
        if (!set) this.listeners.set(seat, (set = new Set()));
        set.add(listener);
        return () => set.delete(listener);
      },
    };
  }

  /** Every seat's latest presence except `seat`'s own. */
  peers(seat: SeatId): PeerPresence[] {
    return [...this.latest.values()].filter((p) => p.seat !== seat).map((p) => ({ ...p, drag: [...p.drag] }));
  }

  /** Seats with at least one listener (a presence layer is attached there). */
  listening(): SeatId[] {
    return [...this.listeners].filter(([, set]) => set.size > 0).map(([seat]) => seat);
  }
}

/** One seat's TableSession over a LocalTable (the HUD fake for everything else). */
export class TableSeatSession extends FakeSession {
  override readonly presence: Presence;
  constructor(
    readonly table: LocalTable,
    seat: SeatId,
    data: FakeCardData,
  ) {
    const secrets: SecretStore = { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
    super(table.state, secrets, data, seat);
    this.presence = table.presence.channel(seat);
  }
  override getState(): TableState {
    return this.table.state;
  }
  override subscribe(listener: SessionListener): () => void {
    return this.table.subscribe(listener);
  }
  override dispatch(draft: ActionDraft): Action {
    const a = this.table.dispatch(this.seat, draft);
    this.dispatched.push(a);
    return a;
  }
}

/** EveningControls over a seat's session: `setLobby` proposes `lobbySet`; `start` hands over to the harness. */
export class FakeEvening implements EveningControls {
  readonly calls: { method: string; args: unknown[] }[] = [];
  /** While set, `setLobby` is refused: the proposal never reaches the table (as a rolled-back proposal). */
  refuse = false;
  constructor(
    private readonly session: TableSeatSession,
    private readonly onStart: () => void = () => {},
  ) {}
  setLobby(lobby: LobbySettings): Action {
    this.calls.push({ method: 'setLobby', args: [lobby] });
    if (this.refuse) return { type: 'lobbySet', lobby, by: this.session.seat, cid: 'refused', seq: this.session.getState().seq + 1 } as Action;
    return this.session.dispatch({ type: 'lobbySet', lobby });
  }
  start(): Action {
    this.calls.push({ method: 'start', args: [] });
    this.onStart();
    return this.session.dispatch({ type: 'chat', channel: 'table', text: 'start' } as ActionDraft);
  }
  propose(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** A SetDataSource over a fixed list (the lobby's picker); `get` has no booster data. */
export class FakeSets implements SetDataSource {
  constructor(
    private readonly list: SetSummary[],
    private readonly delayMs = 0,
  ) {}
  listSets(): Promise<SetSummary[]> {
    return new Promise((resolve) => setTimeout(() => resolve([...this.list]), this.delayMs));
  }
  get(): Promise<SetData | null> {
    return Promise.resolve(null);
  }
  peek(): SetData | null {
    return null;
  }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// ---------------------------------------------------------------------------------------------------------------------
// A simulated draft
// ---------------------------------------------------------------------------------------------------------------------

/** The formats the simulation plays. */
export type SimFormat = 'pass' | 'rochester' | 'grid' | 'sealed' | 'winston';

export interface SimOptions {
  format: SimFormat;
  /** Packs per player (pass, Rochester, sealed); default 3 (6 for sealed). */
  packs?: number;
  /** Picks per pass (pass); default 1. */
  picks?: number;
  /** Rochester burn; default 0. */
  burn?: number;
  /** Grids; default 18. */
  grids?: number;
  pickTimer?: boolean;
  /** Cards per pack; default 15. */
  packSize?: number;
  /** Card pool packs are filled from, in order (wrapping). */
  cards: readonly CardData[];
  /** Every n-th card is foil (0 for none); default 0. */
  foilEvery?: number;
}

/** The whole draft in one place: every seat's packs and pools, and the public state it writes to the table. */
export class DraftSim {
  readonly seats: SeatId[];
  /** Pack contents by pack id. */
  readonly contents = new Map<PackId, DraftCard[]>();
  readonly pools = new Map<SeatId, CardRef[]>();
  readonly marks = new Map<SeatId, InstanceId[]>();
  /** Every accepted pick: seat, pack, cards. */
  readonly picks: { seat: SeatId; packId: PackId; cards: InstanceId[] }[] = [];
  /** Winston: the face-down stack and the three piles. */
  private stack: DraftCard[] = [];
  private piles: DraftCard[][] = [[], [], []];
  private readonly listeners = new Set<() => void>();
  private next = 0;
  private serial = 0;
  readonly opts: Required<Omit<SimOptions, 'cards'>> & { cards: readonly CardData[] };

  constructor(
    readonly table: LocalTable,
    opts: SimOptions,
  ) {
    this.opts = {
      packs: opts.format === 'sealed' || opts.format === 'winston' ? 6 : 3,
      picks: 1,
      burn: 0,
      grids: 18,
      pickTimer: false,
      packSize: 15,
      foilEvery: 0,
      ...opts,
    };
    this.seats = seatsInOrder(table.state).filter((s) => table.state.seats[s]!.name.trim() !== '');
    for (const s of this.seats) {
      this.pools.set(s, []);
      this.marks.set(s, []);
    }
  }

  private get draft() {
    return this.table.state.draft!;
  }

  /** Lobby → draft: write the lobby and draft state, open the first packs (or grid, or sealed pools). */
  start(): void {
    const o = this.opts;
    const settings =
      o.format === 'pass'
        ? { format: 'pass' as const, packs: o.packs, picks: o.picks }
        : o.format === 'rochester'
          ? { format: 'rochester' as const, packs: o.packs, burn: o.burn }
          : o.format === 'grid'
            ? { format: 'grid' as const, grids: o.grids }
            : o.format === 'winston'
              ? { format: 'winston' as const, packs: o.packs }
              : { format: 'sealed' as const, packs: o.packs };
    const lobby: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, draft: settings, pickTimer: o.pickTimer };
    const base: TableState = { ...this.table.state, stage: 'draft', lobby };
    const draft = createDraftState(base, lobby, base.seq + 1)!;
    let st: TableState = { ...base, draft };
    if (o.format === 'pass') st = this.openRound(st, 0);
    else if (o.format === 'rochester') st = this.openRochester(st, this.seats[0]!);
    else if (o.format === 'grid') st = this.layGrid(st, 0, this.seats[0]!);
    else if (o.format === 'sealed') st = this.openSealed(st);
    else if (o.format === 'winston') st = this.dealWinston(st);
    this.commit(st);
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private commit(st: TableState): void {
    this.table.set({ ...st, seq: this.table.state.seq + 1 });
    for (const l of [...this.listeners]) l();
  }

  /** Packs draw through the card list with a stride coprime to its length, so a pack mixes colours and rarities. */
  private card(): DraftCard {
    const n = this.opts.cards.length;
    let stride = Math.min(37, Math.max(1, n - 1));
    while (n > 1 && gcd(stride, n) !== 1) stride++;
    const c = this.opts.cards[(this.next * stride) % n]!;
    this.next++;
    const ref: CardRef = { sid: c.id };
    if (this.opts.foilEvery > 0 && this.next % this.opts.foilEvery === 0) ref.foil = true;
    return { id: `c${++this.serial}`, ref };
  }

  private newPack(st: TableState, opener: SeatId, number: number, holder: SeatId | null, size = this.opts.packSize, pub = false): { st: TableState; id: PackId } {
    const id = `p${opener}-${number}-${++this.serial}`;
    const cards = Array.from({ length: size }, () => this.card());
    this.contents.set(id, cards);
    const pack: DraftPack = {
      id,
      opener,
      number,
      set: 'M19',
      commitment: { seat: opener, commits: cards.map(() => 'commit'), instanceIds: cards.map((c) => c.id), atSeq: st.seq },
      count: cards.length,
      holder,
      picks: 0,
      sinceSeq: st.seq + 1,
    };
    if (pub) pack.cards = cards;
    return { st: { ...st, draft: { ...st.draft!, packs: { ...st.draft!.packs, [id]: pack } } }, id };
  }

  // --- pass draft ---
  private openRound(st: TableState, round: number): TableState {
    let s: TableState = { ...st, draft: { ...st.draft!, round, queues: { ...st.draft!.queues } } };
    for (const seat of this.seats) {
      const r = this.newPack(s, seat, round, seat);
      s = r.st;
      s.draft!.queues[seat] = [...(s.draft!.queues[seat] ?? []), r.id];
    }
    return s;
  }

  // --- Rochester ---
  /** Snake order for one pack: opener, …, last, last, …, opener (DESIGN "Specification: card data, packs and draft formats", Rochester). */
  snake(opener: SeatId): SeatId[] {
    const i = this.seats.indexOf(opener);
    const order = this.seats.map((_, k) => this.seats[(i + k) % this.seats.length]!);
    return [...order, ...[...order].reverse()];
  }

  private openRochester(st: TableState, opener: SeatId): TableState {
    const r = this.newPack(st, opener, st.draft!.rochester?.opened ?? 0, null, this.opts.packSize, true);
    const opened = (st.draft!.rochester?.opened ?? 0) + 1;
    return { ...r.st, draft: { ...r.st.draft!, rochester: { pack: r.id, opener, turn: 0, opened } } };
  }

  rochesterTurn(): SeatId | null {
    const r = this.draft.rochester;
    if (!r || r.pack === null || this.draft.done) return null;
    const order = this.snake(r.opener);
    return order[r.turn % order.length]!;
  }

  // --- Grid ---
  private layGrid(st: TableState, index: number, first: SeatId): TableState {
    const cells = Array.from({ length: 9 }, () => this.card());
    return { ...st, draft: { ...st.draft!, grid: { index, cells, first, taken: [] } } };
  }

  gridTurn(): SeatId | null {
    const g = this.draft.grid;
    if (!g || this.draft.done) return null;
    if (g.taken.length === 0) return g.first;
    if (g.taken.length === 1) return this.seats.find((s) => s !== g.first) ?? null;
    return null;
  }

  // --- Winston ---
  /** Shuffle-free stand-in: the packs' cards in order form the stack, one card starts each pile. */
  private dealWinston(st: TableState): TableState {
    this.stack = Array.from({ length: this.opts.packs * this.opts.packSize }, () => this.card());
    this.piles = [0, 1, 2].map(() => (this.stack.length ? [this.stack.shift()!] : []));
    return this.withWinston(st, st.draft!.winston!.active, 0);
  }

  private withWinston(st: TableState, active: SeatId, pile: number): TableState {
    const w = st.draft!.winston!;
    return { ...st, draft: { ...st.draft!, winston: { ...w, stack: this.stack.length, piles: this.piles.map((p) => p.length), active, pile } } };
  }

  /** Winston: the active seat takes the pile it looks at, or adds a card to it and looks at the next (after the third, it takes the top of the stack). */
  pileLook(seat: SeatId, take: boolean): boolean {
    const d = this.table.state.draft;
    const w = d?.winston;
    if (!d || !w || d.done || w.active !== seat) return false;
    const other = this.seats.find((s) => s !== seat) ?? seat;
    const pool = this.pools.get(seat)!;
    let next: { active: SeatId; pile: number };
    if (take) {
      pool.push(...this.piles[w.pile]!.map((c) => c.ref));
      this.piles[w.pile] = this.stack.length ? [this.stack.shift()!] : [];
      next = { active: other, pile: 0 };
    } else {
      if (this.stack.length) this.piles[w.pile]!.push(this.stack.shift()!);
      if (w.pile < 2) next = { active: seat, pile: w.pile + 1 };
      else {
        if (this.stack.length) pool.push(this.stack.shift()!.ref);
        next = { active: other, pile: 0 };
      }
    }
    const st: TableState = { ...this.table.state, draft: { ...d, pools: { ...d.pools, [seat]: pool.length } } };
    this.commit(this.withWinston(st, next.active, next.pile));
    return true;
  }

  // --- sealed ---
  private openSealed(st: TableState): TableState {
    let s = st;
    const pools = { ...st.draft!.pools };
    for (const seat of this.seats) {
      for (let n = 0; n < this.opts.packs; n++) {
        const r = this.newPack(s, seat, n, null);
        s = r.st;
        this.pools.get(seat)!.push(...this.contents.get(r.id)!.map((c) => c.ref));
      }
      pools[seat] = this.pools.get(seat)!.length;
    }
    return { ...s, draft: { ...s.draft!, pools, done: true } };
  }

  // --- seat actions ---
  /** The front pack of a seat, or the public pack (Rochester). */
  front(seat: SeatId): FrontPack | null {
    const d = this.table.state.draft;
    if (!d) return null;
    if (this.opts.format === 'rochester') {
      const id = d.rochester?.pack;
      if (!id) return null;
      return { packId: id, cards: [...(d.packs[id]?.cards ?? [])], public: true };
    }
    if (this.opts.format !== 'pass') return null;
    const id = d.queues[seat]?.[0];
    if (!id) return null;
    return { packId: id, cards: [...this.contents.get(id)!], public: false };
  }

  waitingOn(): SeatId[] {
    const d = this.table.state.draft;
    if (!d || d.done) return [];
    if (this.opts.format === 'rochester') return [this.rochesterTurn()].filter((s): s is SeatId => !!s);
    if (this.opts.format === 'grid') return [this.gridTurn()].filter((s): s is SeatId => !!s);
    if (this.opts.format === 'winston') return d.winston ? [d.winston.active] : [];
    if (this.opts.format === 'pass') return this.seats.filter((s) => (d.queues[s]?.length ?? 0) > 0);
    return [];
  }

  view(seat: SeatId): DraftPrivateView {
    const d = this.table.state.draft;
    const pack = this.front(seat);
    const packRec = pack && d ? d.packs[pack.packId] : undefined;
    const picks = pack ? (pack.public ? 1 : Math.min(this.opts.picks, pack.cards.length)) : 0;
    const ids = new Set(pack?.cards.map((c) => c.id) ?? []);
    const w = d?.winston;
    const pile = this.opts.format === 'winston' && w && !d.done && w.active === seat ? [...this.piles[w.pile]!] : undefined;
    return {
      ...(pile ? { pile } : {}),
      format: d ? d.settings.format : null,
      pack,
      picks,
      marked: (this.marks.get(seat) ?? []).filter((id) => ids.has(id)),
      queued: Math.max(0, (d?.queues[seat]?.length ?? 0) - 1),
      pool: [...(this.pools.get(seat) ?? [])],
      timer: d?.pickTimer && packRec && !pack?.public ? { fromSeq: packRec.sinceSeq, ms: pickTimerMs(packRec.picks) } : null,
      waitingOn: this.waitingOn(),
    };
  }

  mark(seat: SeatId, cards: readonly InstanceId[]): void {
    this.marks.set(seat, [...cards]);
    for (const l of [...this.listeners]) l();
  }

  /** Confirm a pick for `seat`; false when it is not that seat's pick or the cards are not in its front pack. */
  pick(seat: SeatId, cards: readonly InstanceId[]): boolean {
    const d = this.table.state.draft;
    if (!d || d.done) return false;
    const pack = this.front(seat);
    if (!pack) return false;
    if (pack.public && this.rochesterTurn() !== seat) return false;
    const need = pack.public ? 1 : Math.min(this.opts.picks, pack.cards.length);
    const ids = new Set(pack.cards.map((c) => c.id));
    if (cards.length !== need || new Set(cards).size !== need || !cards.every((c) => ids.has(c))) return false;
    const taken = pack.cards.filter((c) => cards.includes(c.id));
    const left = pack.cards.filter((c) => !cards.includes(c.id));
    this.pools.get(seat)!.push(...taken.map((c) => c.ref));
    this.marks.set(seat, []);
    this.picks.push({ seat, packId: pack.packId, cards: [...cards] });
    this.contents.set(pack.packId, left);
    const rec = d.packs[pack.packId]!;
    const nextSeq = this.table.state.seq + 1;
    const draft = { ...d, packs: { ...d.packs }, queues: { ...d.queues }, pools: { ...d.pools, [seat]: (d.pools[seat] ?? 0) + taken.length } };
    if (pack.public) {
      const r = d.rochester!;
      const burnt = left.length <= this.opts.burn;
      draft.packs[pack.packId] = { ...rec, count: left.length, picks: rec.picks + 1, cards: left };
      draft.rochester = { ...r, turn: r.turn + 1 };
      if (burnt) {
        draft.packs[pack.packId] = { ...draft.packs[pack.packId]!, cards: [], count: 0 };
        const total = this.opts.packs * this.seats.length;
        if (r.opened >= total) {
          draft.rochester = { ...draft.rochester, pack: null };
          draft.done = true;
          this.commit({ ...this.table.state, draft });
        } else {
          const nextOpener = this.seats[(this.seats.indexOf(r.opener) + 1) % this.seats.length]!;
          this.commit(this.openRochester({ ...this.table.state, draft }, nextOpener));
        }
        return true;
      }
      this.commit({ ...this.table.state, draft });
      return true;
    }
    // Pass the rest to the next seat (left in rounds 0, 2, …; right in 1, 3, …).
    draft.queues[seat] = draft.queues[seat]!.slice(1);
    const front = draft.queues[seat]![0];
    if (front) draft.packs[front] = { ...draft.packs[front]!, sinceSeq: nextSeq };
    if (left.length > 0) {
      const to = passTarget(this.seats, seat, d.round) as SeatId;
      const wasEmpty = (draft.queues[to]?.length ?? 0) === 0;
      draft.queues[to] = [...(draft.queues[to] ?? []), pack.packId];
      draft.packs[pack.packId] = { ...rec, count: left.length, picks: rec.picks + 1, holder: to, sinceSeq: wasEmpty ? nextSeq : rec.sinceSeq };
    } else {
      draft.packs[pack.packId] = { ...rec, count: 0, picks: rec.picks + 1, holder: null };
    }
    let st: TableState = { ...this.table.state, draft };
    const roundOver = Object.values(draft.packs).every((p) => p.number !== d.round || p.count === 0);
    if (roundOver) {
      if (d.round + 1 < this.opts.packs) st = this.openRound(st, d.round + 1);
      else st = { ...st, draft: { ...st.draft!, done: true } };
    }
    this.commit(st);
    return true;
  }

  /** Take a grid line for `seat`; false when it is not that seat's turn or the line is empty. */
  gridTake(seat: SeatId, line: 'row' | 'col', index: 0 | 1 | 2): boolean {
    const d = this.table.state.draft;
    const g = d?.grid;
    if (!d || !g || d.done || this.gridTurn() !== seat) return false;
    const cells = line === 'row' ? [index * 3, index * 3 + 1, index * 3 + 2] : [index, index + 3, index + 6];
    const taken = cells.map((i) => g.cells[i]).filter((c): c is DraftCard => !!c);
    if (!taken.length) return false;
    this.pools.get(seat)!.push(...taken.map((c) => c.ref));
    const nextCells = g.cells.map((c, i) => (cells.includes(i) ? null : c));
    const nextTaken = [...g.taken, { line, index }];
    let draft = { ...d, pools: { ...d.pools, [seat]: (d.pools[seat] ?? 0) + taken.length }, grid: { ...g, cells: nextCells, taken: nextTaken } };
    let st: TableState = { ...this.table.state, draft };
    if (nextTaken.length >= 2) {
      if (g.index + 1 < this.opts.grids) {
        const first = this.seats.find((s) => s !== g.first) ?? g.first;
        st = this.layGrid(st, g.index + 1, first);
      } else {
        draft = { ...draft, done: true };
        st = { ...st, draft };
      }
    }
    this.commit(st);
    return true;
  }

  /** The first `n` cards of a seat's front pack (a scripted pick for the other seats). */
  autoPick(seat: SeatId): boolean {
    const pack = this.front(seat);
    if (!pack) return false;
    const need = pack.public ? 1 : Math.min(this.opts.picks, pack.cards.length);
    return this.pick(
      seat,
      pack.cards.slice(0, need).map((c) => c.id),
    );
  }

  /** DraftControls for one seat. */
  controls(seat: SeatId): DraftControls & { readonly calls: { method: string; args: unknown[] }[] } {
    const calls: { method: string; args: unknown[] }[] = [];
    let build: DeckBuild | null = null;
    return {
      calls,
      view: () => this.view(seat),
      subscribe: (l) => this.subscribe(() => l(this.view(seat))),
      mark: (cards) => {
        calls.push({ method: 'mark', args: [[...cards]] });
        this.mark(seat, cards);
      },
      pick: (cards) => {
        calls.push({ method: 'pick', args: [[...cards]] });
        return this.pick(seat, cards);
      },
      pileLook: (take) => {
        calls.push({ method: 'pileLook', args: [take] });
        return this.pileLook(seat, take);
      },
      gridTake: (line, index) => {
        calls.push({ method: 'gridTake', args: [line, index] });
        return this.gridTake(seat, line, index);
      },
      build: () => build,
      setBuild: (b) => {
        build = b;
      },
      ready: () => Promise.resolve(),
    };
  }
}
