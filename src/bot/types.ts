/**
 * Sparring, the computer opponent (computer.md; contracts.md Part G "Computer opponent"): the types of the pure bot.
 * `bot/` is pure (no DOM, clock, randomness, network, Three.js or Svelte) and does not import `session/`: it declares
 * the slice of TableSession it needs as `BotSeatPort`, which TableSession satisfies structurally.
 */
import type { Action, ActionDraft } from '../core/actions';
import type { BotConfig, BotLevel, BotPace, CardRef, InstanceId, LogEntry, PhaseId, Pose, RoundId, SecretStore, SeatId, StackItemId, TableState } from '../core/types';
import type { CardData } from '../data/types';

export type { BotConfig, BotLevel, BotPace };

/** A colour symbol. */
export type Colour = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLOURS: readonly Colour[] = ['W', 'U', 'B', 'R', 'G'];

/** A parsed mana cost Sparring can pay: generic plus coloured symbols ({C} counts as generic paid by any land). */
export interface ManaCost {
  generic: number;
  colours: Partial<Record<Colour, number>>;
}

/** The keywords Sparring reads (computer.md 5.4). */
export type Keyword = 'flying' | 'reach' | 'first strike' | 'double strike' | 'deathtouch' | 'trample' | 'vigilance' | 'haste' | 'lifelink' | 'menace' | 'defender' | 'indestructible';
export const KEYWORDS: readonly Keyword[] = ['flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'trample', 'vigilance', 'haste', 'lifelink', 'menace', 'defender', 'indestructible'];

/** A card as the bot reads it (computer.md 4.1). */
export interface BotCard {
  id: InstanceId;
  name: string;
  kind: 'land' | 'creature' | 'other';
  /** Null: a cost Sparring cannot pay (X, hybrid, Phyrexian, snow) or no data. */
  cost: ManaCost | null;
  mv: number;
  colours: Colour[];
  /** Colours a land produces (empty for a non-land or a colourless land). */
  produces: Colour[];
  power: number;
  toughness: number;
  keywords: Keyword[];
}

/** A permanent on a battlefield (computer.md 4.1). */
export interface BotPermanent extends BotCard {
  tapped: boolean;
  combat?: 'attack' | 'block';
  /** A face-down card of the opponent: read as a 2/2 with nothing known. */
  unknown?: true;
  pose: Pose;
  /** Displaced (temporary move) and not settled yet. */
  displaced: boolean;
  /** Sparring owns the card (it never moves, taps or removes a card it does not own). */
  owned: boolean;
}

/** Which combat cue the human's primary button shows (computer.md 5.3; contracts.md Part G item 1). */
export type CombatCue = { kind: 'attack' | 'damage' | 'blocksDone'; label: string } | null;

/** The labels of the three cues; matched trimmed and case-insensitively. */
export const CUE_LABELS = { attack: 'Attack', damage: 'Damage', blocksDone: 'Blocks done' } as const;
export type CueKind = keyof typeof CUE_LABELS;

/** The open confirmation round as the bot sees it. */
export interface BotRound {
  id: RoundId;
  askedBy: SeatId;
  label: string;
  /** A cue round (Attack, Damage, Blocks done), else null. */
  cue: CueKind | null;
  about?: StackItemId;
  /** The bot answered (or does not answer) this round. */
  answered: boolean;
  /** Everyone has passed it. */
  passed: boolean;
  holder?: SeatId;
}

/** Everything the bot decides from: public state, its own hand and cached card data (computer.md 4.1). */
export interface BotView {
  me: SeatId;
  opp: SeatId;
  turn: { number: number; active: SeatId; phase: PhaseId; mine: boolean };
  life: { me: number; opp: number };
  hand: BotCard[];
  /** Own library: the count only. */
  library: number;
  oppHand: number;
  oppLibrary: number;
  mine: BotPermanent[];
  theirs: BotPermanent[];
  stack: { id: StackItemId; controller: SeatId; mine: boolean; card?: InstanceId }[];
  round: BotRound | null;
  /** Block lines: blocker → attacker. */
  blocks: { blocker: InstanceId; attacker: InstanceId }[];
  /** This turn (since the last turnPass in the log). */
  thisTurn: {
    /** No own action yet this turn (a fresh turn of the bot). */
    fresh: boolean;
    drew: boolean;
    /** The starting player's first turn of the game: no draw (computer.md 5.2 row 3; view.ts firstTurnOfGame). */
    firstOfGame: boolean;
    landPlayed: boolean;
    /** Own permanents that came onto the battlefield this turn. */
    arrived: InstanceId[];
    /** Own actions this turn (watchdog and keyed choices). */
    steps: number;
    /** The bot attacked this turn (moveTemp attack). */
    attacked: boolean;
    /** The combat of this turn was booked ("Blocks done" answered by the bot). */
    combatDone: boolean;
  };
  /** Opening hand: the bot has not acted in the game yet; mulligans taken; cards put on the bottom since. */
  opening: { pending: boolean; mulligans: number; bottomed: number };
  /** The game has a result. */
  over: boolean;
  /** The human's combat cue state (shared with the HUD). */
  cue: CombatCue;
}

/** A step Sparring takes: one user-visible gesture (computer.md 5.1). */
export type BotStep =
  | { kind: 'keep' }
  | { kind: 'mulligan' }
  | { kind: 'bottom'; cards: InstanceId[] }
  | { kind: 'untap'; cards: InstanceId[] }
  | { kind: 'phase'; phase: PhaseId }
  | { kind: 'draw' }
  | { kind: 'playLand'; card: InstanceId; pose: Pose }
  | { kind: 'cast'; card: InstanceId; pay: InstanceId[] }
  | { kind: 'resolve'; item: StackItemId; pose: Pose }
  | { kind: 'attack'; attackers: { card: InstanceId; pose: Pose; tap: boolean }[]; line: string }
  | { kind: 'block'; pairs: { blocker: InstanceId; attacker: InstanceId; pose: Pose }[]; round: RoundId; line: string }
  | { kind: 'answer'; round: RoundId }
  | { kind: 'book'; round: RoundId; life: { seat: SeatId; delta: number }[]; bury: InstanceId[]; pings: InstanceId[]; settle: InstanceId[]; line: string }
  | { kind: 'settle'; cards: InstanceId[] }
  | { kind: 'discard'; cards: InstanceId[] }
  | { kind: 'passTurn' }
  | { kind: 'concede' }
  | { kind: 'say'; line: string };

export type BotStepKind = BotStep['kind'];

/** What differs per level (computer.md 5.5). Tonight only Steady is built. */
export interface BotProfile {
  level: BotLevel;
  casting: 'cheapest' | 'mostExpensive';
  mulligan: boolean;
  trades: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotLevel, BotProfile>> = {
  gentle: { level: 'gentle', casting: 'cheapest', mulligan: false, trades: false },
  steady: { level: 'steady', casting: 'mostExpensive', mulligan: true, trades: true },
  keen: { level: 'keen', casting: 'mostExpensive', mulligan: true, trades: true },
};

/** Delay before each step and before answering a round, in ms (computer.md section 6). */
export const BOT_PACE_MS: Readonly<Record<BotPace, { step: number; answer: number }>> = {
  calm: { step: 1200, answer: 600 },
  normal: { step: 700, answer: 600 },
  brisk: { step: 300, answer: 300 },
};

/** The slice of TableSession the bot acts through (computer.md section 3). */
export interface BotSeatPort {
  readonly seat: SeatId;
  getState(): TableState;
  subscribe(listener: (state: TableState) => void): () => void;
  secrets(): SecretStore;
  cardData(ref: CardRef): CardData | null;
  log(): LogEntry[];
  dispatch(action: ActionDraft): Action;
  draw(n?: number): Promise<void>;
  mulligan(): Promise<void>;
  chat(text: string): Action;
  /** Whether every own action has been sequenced (the log has caught up); the runner waits while it is false. */
  settled?(): boolean;
}

/** The timers the runner uses (injected: the page's, Vitest's fake ones, or a manual clock in e2e). */
export interface BotClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the runner is doing (session/types.ts ComputerStatus has the same shape). */
export interface BotStatus {
  phase: 'starting' | 'thinking' | 'waiting' | 'paused' | 'conceded' | 'failed';
  text: string;
}
