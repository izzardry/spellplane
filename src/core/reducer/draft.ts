/**
 * Copy-on-write view of a TableState for one reducer step. Handlers read through it and write only through the
 * `w`/`set`/`delete` methods, which copy a record before its first change; the input state is never touched, and
 * untouched records keep their identity in the result (cheap change detection for the scene and HUD).
 */
import type { CardInstance, Commitment, ConfirmRound, Line, Seat, Stage, StackItem, TableSettings, TableState, Team, TurnState, Zone } from '../types';
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
  private stackCopy: StackItem[] | null = null;
  private turnCopy: TurnState | null = null;
  private settingsCopy: TableSettings | null = null;
  private stageValue: Stage | null = null;
  /** Added by M1-P3: the confirmation round once a handler set it (`undefined`: unchanged). */
  private confirmValue: ConfirmRound | null | undefined = undefined;

  constructor(readonly base: TableState) {
    this.cards = new RecordDraft(base.cards, 'card');
    this.zones = new RecordDraft(base.zones, 'zone');
    this.lines = new RecordDraft(base.lines, 'line');
    this.seats = new RecordDraft(base.seats, 'seat');
    this.teams = new RecordDraft(base.teams, 'team');
    this.commitments = new RecordDraft(base.commitments, 'commitment');
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

  get changed(): boolean {
    return (
      this.cards.changed ||
      this.zones.changed ||
      this.lines.changed ||
      this.seats.changed ||
      this.teams.changed ||
      this.commitments.changed ||
      this.stackCopy !== null ||
      this.turnCopy !== null ||
      this.settingsCopy !== null ||
      this.stageValue !== null ||
      this.confirmValue !== undefined
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
    return {
      ...this.base,
      seq: seq ?? this.base.seq,
      cards: this.cards.result(),
      zones: this.zones.result(),
      lines: this.lines.result(),
      seats: this.seats.result(),
      teams: this.teams.result(),
      commitments: this.commitments.result(),
      stack,
      confirm,
      turn: this.turnCopy ?? this.base.turn,
      settings: this.settingsCopy ?? this.base.settings,
      stage: this.stageValue ?? this.base.stage,
    };
  }
}
