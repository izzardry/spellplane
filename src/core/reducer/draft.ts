/**
 * Copy-on-write view of a TableState for one reducer step. Handlers read through it and write only through the
 * `w`/`set`/`delete` methods, which copy a record before its first change; the input state is never touched, and
 * untouched records keep their identity in the result (cheap change detection for the scene and HUD).
 */
import type { CardInstance, Commitment, ConfirmRound, DraftState, Line, LobbySettings, RngRound, Seat, ShuffleRound, Stage, StackItem, TableSettings, TableState, Team, TurnState, Zone } from '../types';
import { byId, own, reject } from './util';

/** One keyed record of the state (cards, zones, lines, seats, teams, commitments). */
export class RecordDraft<T> {
  private copy: Record<string, T> | null = null;
  private readonly written = new Set<string>();

  constructor(
    private readonly base: Readonly<Record<string, T>>,
    private readonly what: string,
  ) {}

  private cur(): Readonly<Record<string, T>> {
    return this.copy ?? this.base;
  }

  private mutable(): Record<string, T> {
    if (!this.copy) this.copy = { ...this.base };
    return this.copy;
  }

  /** The current value (read-only: never mutate it; use `w`). */
  get(id: string): T | undefined {
    return own(this.cur(), id);
  }

  has(id: string): boolean {
    return Object.hasOwn(this.cur(), id);
  }

  /** The current value or a rejection naming the unknown id. */
  need(id: string): T {
    const v = this.get(id);
    if (v === undefined) reject(`unknown ${this.what} ${id}`);
    return v;
  }

  /** A writable copy of an existing record, made on first write. */
  w(id: string): T {
    const v = this.need(id);
    if (this.written.has(id)) return v;
    const c = structuredClone(v);
    this.mutable()[id] = c;
    this.written.add(id);
    return c;
  }

  set(id: string, value: T): void {
    this.mutable()[id] = value;
    this.written.add(id);
  }

  delete(id: string): void {
    if (!this.has(id)) return;
    delete this.mutable()[id];
    this.written.delete(id);
  }

  /** Keys in lexicographic order, so iteration never depends on insertion history (live state vs. restored snapshot). */
  keys(): string[] {
    return Object.keys(this.cur()).sort(byId);
  }

  /** Values in key order (read-only). */
  values(): T[] {
    const cur = this.cur();
    return this.keys().map((k) => cur[k] as T);
  }

  get changed(): boolean {
    return this.copy !== null;
  }

  result(): Record<string, T> {
    return (this.copy ?? this.base) as Record<string, T>;
  }
}

/** The draft of a whole table state. */
export class Draft {
  readonly cards: RecordDraft<CardInstance>;
  readonly zones: RecordDraft<Zone>;
  readonly lines: RecordDraft<Line>;
  readonly seats: RecordDraft<Seat>;
  readonly teams: RecordDraft<Team>;
  readonly commitments: RecordDraft<Commitment>;
  /** Public-randomness rounds (M1-P2). */
  readonly rng: RecordDraft<RngRound>;
  /** Secret-shuffle rounds (M1-P2). */
  readonly shuffles: RecordDraft<ShuffleRound>;
  private stackCopy: StackItem[] | null = null;
  private turnCopy: TurnState | null = null;
  private settingsCopy: TableSettings | null = null;
  private stageValue: Stage | null = null;
  /** Added by M1-P3: the confirmation round once a handler set it (`undefined`: unchanged). */
  private confirmValue: ConfirmRound | null | undefined = undefined;
  /** Added by M2-C: the draft state once a handler set it (`undefined`: unchanged; `null`: removed). */
  private draftValue: DraftState | null | undefined = undefined;
  /** Added by M2-C: the lobby settings once a handler set them (`undefined`: unchanged). */
  private lobbyValue: LobbySettings | undefined = undefined;
  /** Added by M2-C: the games counter once a handler set it (`undefined`: unchanged). */
  private gamesValue: number | undefined = undefined;

  constructor(readonly base: TableState) {
    this.cards = new RecordDraft(base.cards, 'card');
    this.zones = new RecordDraft(base.zones, 'zone');
    this.lines = new RecordDraft(base.lines, 'line');
    this.seats = new RecordDraft(base.seats, 'seat');
    this.teams = new RecordDraft(base.teams, 'team');
    this.commitments = new RecordDraft(base.commitments, 'commitment');
    this.rng = new RecordDraft(base.rng, 'randomness round');
    this.shuffles = new RecordDraft(base.shuffles, 'shuffle');
  }

  /** The stack, bottom to top (read-only). */
  get stack(): readonly StackItem[] {
    return this.stackCopy ?? this.base.stack;
  }

  /** A writable stack (items deep-copied once). */
  stackW(): StackItem[] {
    if (!this.stackCopy) this.stackCopy = structuredClone(this.base.stack);
    return this.stackCopy;
  }

  setStack(items: StackItem[]): void {
    this.stackCopy = items;
  }

  get turn(): Readonly<TurnState> {
    return this.turnCopy ?? this.base.turn;
  }

  turnW(): TurnState {
    if (!this.turnCopy) this.turnCopy = { ...this.base.turn };
    return this.turnCopy;
  }

  get settings(): Readonly<TableSettings> {
    return this.settingsCopy ?? this.base.settings;
  }

  settingsW(): TableSettings {
    if (!this.settingsCopy) this.settingsCopy = { ...this.base.settings };
    return this.settingsCopy;
  }

  setStage(stage: Stage): void {
    this.stageValue = stage;
  }

  /** The current confirmation round (read-only: never mutate it; use `setConfirm`). Added by M1-P3. */
  get confirm(): Readonly<ConfirmRound> | null {
    return this.confirmValue !== undefined ? this.confirmValue : this.base.confirm;
  }

  /** Replace the confirmation round (a fresh object, or null to close it). Added by M1-P3. */
  setConfirm(round: ConfirmRound | null): void {
    this.confirmValue = round;
  }

  /** The draft state (read-only: never mutate it; use `draftW` or `setDraftState`), null outside a draft. Added by M2-C. */
  get draft(): Readonly<DraftState> | null {
    return this.draftValue !== undefined ? this.draftValue : (this.base.draft ?? null);
  }

  /** A writable deep copy of the draft state, made on first write; rejects when no draft is in progress. Added by M2-C. */
  draftW(): DraftState {
    if (this.draftValue === undefined) {
      if (this.base.draft === undefined) reject('no draft is in progress');
      this.draftValue = structuredClone(this.base.draft);
    }
    if (this.draftValue === null) reject('no draft is in progress');
    return this.draftValue;
  }

  /** Replace the draft state (a fresh object, or null to remove it). Added by M2-C. */
  setDraftState(draft: DraftState | null): void {
    this.draftValue = draft;
  }

  /** The lobby settings as stored (absent: defaults apply, core/stage.ts lobbyOf). Added by M2-C. */
  get lobby(): Readonly<LobbySettings> | undefined {
    return this.lobbyValue ?? this.base.lobby;
  }

  /** Replace the lobby settings. Added by M2-C. */
  setLobby(lobby: LobbySettings): void {
    this.lobbyValue = lobby;
  }

  /** Games started this evening (absent: 0). Added by M2-C. */
  get games(): number {
    return this.gamesValue ?? this.base.games ?? 0;
  }

  setGames(n: number): void {
    this.gamesValue = n;
  }

  get changed(): boolean {
    return (
      this.cards.changed ||
      this.zones.changed ||
      this.lines.changed ||
      this.seats.changed ||
      this.teams.changed ||
      this.commitments.changed ||
      this.rng.changed ||
      this.shuffles.changed ||
      this.stackCopy !== null ||
      this.turnCopy !== null ||
      this.settingsCopy !== null ||
      this.stageValue !== null ||
      this.confirmValue !== undefined ||
      this.draftValue !== undefined ||
      this.lobbyValue !== undefined ||
      this.gamesValue !== undefined
    );
  }

  /** The resulting state; `seq` is stamped when given. Returns the base object when nothing changed. */
  finish(seq: number | undefined): TableState {
    if (!this.changed && (seq === undefined || seq === this.base.seq)) return this.base;
    const stack = this.stackCopy ?? this.base.stack;
    // A round about a stack item ends when that item leaves the stack, however it left (resolve, counter, a drag
    // out, undo): M1-P3, DESIGN "Turn flow and confirmation".
    let confirm = this.confirm;
    if (confirm?.about !== undefined && !stack.some((i) => i.id === confirm!.about)) confirm = null;
    const next: TableState = {
      ...this.base,
      seq: seq ?? this.base.seq,
      cards: this.cards.result(),
      zones: this.zones.result(),
      lines: this.lines.result(),
      seats: this.seats.result(),
      teams: this.teams.result(),
      commitments: this.commitments.result(),
      rng: this.rng.result(),
      shuffles: this.shuffles.result(),
      stack,
      confirm,
      turn: this.turnCopy ?? this.base.turn,
      settings: this.settingsCopy ?? this.base.settings,
      stage: this.stageValue ?? this.base.stage,
    };
    // Optional M2 slots are omitted when absent (plain JSON rule, core/types.ts).
    if (this.draftValue === null) delete next.draft;
    else if (this.draftValue !== undefined) next.draft = this.draftValue;
    if (this.lobbyValue !== undefined) next.lobby = this.lobbyValue;
    if (this.gamesValue !== undefined) next.games = this.gamesValue;
    return next;
  }
}
