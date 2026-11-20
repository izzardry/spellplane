/**
 * The combat cues (computer.md 5.3; contracts.md Part G "Computer opponent" item 1): which cue the human's primary
 * button offers, shared by the route (its `primaryOverride`) and the bot. The cues are ordinary `ask` rounds with the
 * labels `Attack`, `Damage` and `Blocks done`, matched trimmed and case-insensitively. Pure.
 *
 * - The human's turn or not, whenever one of the human's cards is marked attacking: `Attack` until an Attack cue was
 *   asked after the latest attack declaration; then, once Sparring answered it, `Damage`; nothing after Damage.
 * - Sparring's attackers are out and no `Blocks done` was asked since it declared them: `Blocks done` (labelled
 *   `No blocks` or `Done blocking` by whether the human drew a block line).
 */
import type { Action, ActionOf } from '../core/actions';
import type { LogEntry, SeatId, TableState } from '../core/types';
import type { CombatCue, CueKind } from './types';
import { CUE_LABELS } from './types';

/** The cue a round label names, or null. */
export function cueOf(label: string | undefined): CueKind | null {
  const l = (label ?? '').trim().toLowerCase();
  for (const k of Object.keys(CUE_LABELS) as CueKind[]) if (CUE_LABELS[k].toLowerCase() === l) return k;
  return null;
}

/** Sequenced actions of the log. */
export function actionsOf(log: readonly LogEntry[]): Action[] {
  const out: Action[] = [];
  for (const e of log) if (e.kind === 'action') out.push(e.action);
  return out;
}

/** The actions of the current turn: everything after the last `turnPass`. */
export function turnWindow(actions: readonly Action[]): Action[] {
  for (let i = actions.length - 1; i >= 0; i--) if (actions[i]!.type === 'turnPass') return actions.slice(i + 1);
  return [...actions];
}

function attackersOf(state: TableState, seat: SeatId): string[] {
  return Object.values(state.cards)
    .filter((c) => c.controller === seat && c.combat === 'attack' && c.zone.startsWith('battlefield:'))
    .map((c) => c.id)
    .sort();
}

function lastIndex<T>(list: readonly T[], test: (x: T) => boolean, from = 0): number {
  for (let i = list.length - 1; i >= from; i--) if (test(list[i]!)) return i;
  return -1;
}

const isCue = (a: Action, by: SeatId, kind: CueKind): a is ActionOf<'ask'> => a.type === 'ask' && a.by === by && cueOf(a.label) === kind;

/** Which cue the human's primary button offers now (computer.md 5.3). */
export function combatCue(state: TableState, log: readonly LogEntry[], human: SeatId, bot: SeatId): CombatCue {
  if (state.result !== undefined || state.stage !== 'match') return null;
  const window = turnWindow(actionsOf(log));
  const declared = (seat: SeatId): number => lastIndex(window, (a) => a.type === 'moveTemp' && a.by === seat && a.combat === 'attack');
  // Sparring's attack on its own turn comes first: a card of the human's still marked from its last combat is no attack.
  const botAttacks = attackersOf(state, bot).length > 0 && state.turn.active !== human;
  if (attackersOf(state, human).length > 0 && !botAttacks) {
    const from = Math.max(0, declared(human));
    const attack = lastIndex(window, (a) => isCue(a, human, 'attack'), from);
    const damage = lastIndex(window, (a) => isCue(a, human, 'damage'), Math.max(from, attack));
    if (damage >= 0) return null;
    if (attack < 0) return { kind: 'attack', label: CUE_LABELS.attack };
    const round = (window[attack] as ActionOf<'ask'>).round;
    const open = state.confirm;
    const waiting = open !== null && open.id === round && open.responses[bot] === undefined && open.holder !== bot && state.seats[bot]?.name !== '';
    return waiting ? null : { kind: 'damage', label: CUE_LABELS.damage };
  }
  if (attackersOf(state, bot).length > 0) {
    const from = Math.max(0, declared(bot));
    if (lastIndex(window, (a) => isCue(a, human, 'blocksDone'), from) >= 0) return null;
    const blocking = Object.values(state.lines).some((l) => l.kind === 'block' && l.from.kind === 'card' && state.cards[l.from.id]?.controller === human);
    return { kind: 'blocksDone', label: blocking ? 'Done blocking' : 'No blocks' };
  }
  return null;
}

/**
 * Whether the human's combat was counted: its cards are still marked attacking and Sparring answered a `Damage` cue
 * asked after they were declared this turn. The primary button then offers `Main 2` (settle, then main 2; computer.md
 * 5.3).
 */
export function damageCounted(state: TableState, log: readonly LogEntry[], human: SeatId, bot: SeatId): boolean {
  if (state.result !== undefined || state.stage !== 'match' || attackersOf(state, human).length === 0) return false;
  if (attackersOf(state, bot).length > 0 && state.turn.active !== human) return false;
  const window = turnWindow(actionsOf(log));
  const from = Math.max(0, lastIndex(window, (a) => a.type === 'moveTemp' && a.by === human && a.combat === 'attack'));
  const damage = lastIndex(window, (a) => isCue(a, human, 'damage'), from);
  if (damage < 0) return false;
  const round = (window[damage] as ActionOf<'ask'>).round;
  const open = state.confirm;
  return !(open !== null && open.id === round && open.responses[bot] === undefined);
}
