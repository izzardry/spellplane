/**
 * The turn tracker and the primary button (docs/design/m7-hud-proposal.md, Always visible: "Turn tracker … five
 * grouped steps: Beginning · Main · Combat · Main 2 · End. The current step is filled"; "Primary button … Context label:
 * 'Draw' in Beginning, 'To combat ▸' in Main, 'Main 2 ▸' after combat, 'End turn ▸' in Main 2 or End. Not my turn:
 * replaced by 'Waiting for Ben'"). DESIGN "Turn flow and confirmation": the seven steps stay the table's phases; the
 * tracker only groups untap, upkeep and draw as Beginning. Nothing is enforced: the button only moves the marker,
 * passes the turn, or (on a deliberate press) untaps and draws as the offer does.
 */
import type { PhaseSpec, SeatId, TableState } from '../../core/types';

export type TurnStepId = 'beginning' | 'main' | 'combat' | 'main2' | 'end';

/** One step of the tracker: the phases it stands for, the first being where a click on it moves the marker. */
export interface TurnStep {
  id: string;
  label: string;
  phases: string[];
}

/** The Magic grouping (games/mtg/zones.ts MTG_PHASES). */
const GROUPS: readonly { id: TurnStepId; label: string; phases: readonly string[] }[] = [
  { id: 'beginning', label: 'Beginning', phases: ['untap', 'upkeep', 'draw'] },
  { id: 'main', label: 'Main', phases: ['main1'] },
  { id: 'combat', label: 'Combat', phases: ['combat'] },
  { id: 'main2', label: 'Main 2', phases: ['main2'] },
  { id: 'end', label: 'End', phases: ['end', 'cleanup'] },
];

/**
 * The tracker's steps for a game's phases: the five grouped steps when the game has Magic's phases, else one step per
 * phase (a game definition with other phases keeps them all).
 */
export function turnSteps(phases: readonly PhaseSpec[]): TurnStep[] {
  const ids = new Set(phases.map((p) => p.id));
  const grouped = GROUPS.every((g) => ids.has(g.phases[0]!));
  if (!grouped) return phases.map((p) => ({ id: p.id, label: p.label, phases: [p.id] }));
  const covered = new Set(GROUPS.flatMap((g) => g.phases));
  if (phases.some((p) => !covered.has(p.id))) return phases.map((p) => ({ id: p.id, label: p.label, phases: [p.id] }));
  return GROUPS.map((g) => ({ id: g.id, label: g.label, phases: g.phases.filter((p) => ids.has(p)) }));
}

/** The step a phase belongs to (the first step for an unknown phase). */
export function stepOf(steps: readonly TurnStep[], phase: string): TurnStep | null {
  return steps.find((s) => s.phases.includes(phase)) ?? steps[0] ?? null;
}

/** What the primary button does now. */
export type PrimaryKind = 'untapDraw' | 'toMain' | 'toCombat' | 'toMain2' | 'endTurn' | 'nextPhase' | 'wait';

export interface PrimaryAction {
  kind: PrimaryKind;
  label: string;
  /** The phase the marker moves to (phase moves only). */
  phase: string | null;
  disabled: boolean;
}

export interface PrimaryContext {
  /** The viewer's seat (or team) is active. */
  mine: boolean;
  phase: string;
  phases: readonly PhaseSpec[];
  /** The active player's (or team's) name, for "Waiting for …". */
  activeName: string;
  /** The untap-and-draw offer of a new turn is open (DESIGN "Turn flow and confirmation": offered, never done for them). */
  offer: boolean;
  /** A spectator acts on nothing. */
  spectator?: boolean;
  /**
   * The active seat is an empty chair (the sandbox's second seat, a seat nobody took): nobody will hand the turn back,
   * so the button passes it on instead of waiting (ui/commands.ts isEmptyChair).
   */
  emptyChair?: boolean;
}

/** The one primary button's label and action for the moment (docs/design/m7-hud-proposal.md, Primary button). */
export function primaryAction(ctx: PrimaryContext): PrimaryAction {
  if (ctx.spectator) return { kind: 'wait', label: `${ctx.activeName}'s turn`, phase: null, disabled: true };
  if (!ctx.mine && ctx.emptyChair) return { kind: 'endTurn', label: 'Next turn ▸', phase: null, disabled: false };
  if (!ctx.mine) return { kind: 'wait', label: `Waiting for ${ctx.activeName}`, phase: null, disabled: true };
  const has = (id: string): boolean => ctx.phases.some((p) => p.id === id);
  const magic = turnSteps(ctx.phases).length === GROUPS.length && has('main1');
  if (!magic) {
    const i = ctx.phases.findIndex((p) => p.id === ctx.phase);
    const next = ctx.phases[i + 1];
    return next ? { kind: 'nextPhase', label: `${next.label} ▸`, phase: next.id, disabled: false } : { kind: 'endTurn', label: 'End turn ▸', phase: null, disabled: false };
  }
  // A new turn whose offer is open begins with untap and draw, wherever the marker was left by the last turn.
  if (ctx.offer) return { kind: 'untapDraw', label: 'Untap & draw ▸', phase: 'main1', disabled: false };
  switch (ctx.phase) {
    case 'untap':
    case 'upkeep':
    case 'draw':
      return { kind: 'toMain', label: 'To main ▸', phase: 'main1', disabled: false };
    case 'main1':
      return { kind: 'toCombat', label: 'To combat ▸', phase: 'combat', disabled: false };
    case 'combat':
      return { kind: 'toMain2', label: 'Main 2 ▸', phase: 'main2', disabled: false };
    default:
      return { kind: 'endTurn', label: 'End turn ▸', phase: null, disabled: false };
  }
}

/**
 * Who the primary button's End turn hands the turn to: the next seat (or team) in turn order, passing over empty chairs
 * (nobody sits there to hand it back), so the sandbox's End turn comes straight back to the player. `next` is the
 * table's turn order (ui/commands.ts nextActive); when every seat is an empty chair the turn goes where `next` says.
 */
export function passTarget(state: TableState, next: (state: TableState) => SeatId, emptyChair: (state: TableState, seat: SeatId) => boolean): SeatId {
  const count = Math.max(1, Object.keys(state.seats).length + Object.keys(state.teams).length);
  let at = state;
  let to = next(at);
  for (let i = 0; i < count && emptyChair(state, to); i++) {
    at = { ...at, turn: { ...at.turn, active: to } };
    to = next(at);
  }
  return to;
}
