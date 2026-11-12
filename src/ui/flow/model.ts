/**
 * What the evening bar says and offers (DESIGN "Specification: card data, packs and draft formats", Evening stages:
 * the host advances from the lobby, the draft advances automatically, build advances when all seated players are
 * Ready, from a match any player proposes "next game" or "new draft" and the others confirm). Pure; read by
 * ui/flow/*.svelte and unit-tested. Implementer: M2-P7.
 */
import { roundPassed, waitingOn } from '../../core/reducer/confirm';
import { actingHost, formatSeatProblem, lobbyOf, notReady, stageProposalOf } from '../../core/stage';
import type { DraftFormat, SeatId, TableState } from '../../core/types';

/** What the start button of the lobby's draft panel does, by format (DESIGN "Pre-game", mode table). */
const START_LABEL: Record<DraftFormat, string> = {
  pass: 'Start the draft',
  sealed: 'Open the sealed pools',
  rochester: 'Start the Rochester draft',
  winston: 'Start the Winston draft',
  grid: 'Start the Grid draft',
  teamDraft: 'Start the draft',
  teamSealed: 'Open the sealed pools',
};

/** The lobby's draft start: the button's label and why it cannot be pressed (null: it can), or null without a draft. */
export function draftStart(state: TableState, me: SeatId | null): { label: string; problem: string | null } | null {
  const lobby = lobbyOf(state);
  if (state.stage !== 'lobby' || lobby.draft === null) return null;
  const label = START_LABEL[lobby.draft.format];
  const host = actingHost(state);
  const seatProblem = formatSeatProblem(state, lobby.draft);
  if (seatProblem !== null) return { label, problem: seatProblem.charAt(0).toUpperCase() + seatProblem.slice(1) + '.' };
  if (me === null || me !== host) return { label, problem: `Waiting for ${(host && state.seats[host]?.name) || 'the host'} to start.` };
  return { label, problem: null };
}

/** A proposal to leave the stage that the table is answering now, if any. */
export interface OpenProposal {
  event: 'nextGame' | 'newDraft';
  round: string;
  by: SeatId;
  byName: string;
  /** Seats still to answer (silent or holding). */
  waiting: SeatId[];
  /** Someone holds: the proposal will not go through until they release. */
  held: boolean;
  passed: boolean;
}

/** The open stage proposal of `state` (a confirmation round labelled for one, core/stage.ts STAGE_ROUND_LABELS). */
export function openProposal(state: TableState): OpenProposal | null {
  const r = state.confirm;
  if (r === null) return null;
  const event = stageProposalOf(r.label);
  if (event === null) return null;
  return {
    event,
    round: r.id,
    by: r.askedBy,
    byName: state.seats[r.askedBy]?.name || r.askedBy,
    waiting: waitingOn(state),
    held: r.holder !== undefined,
    passed: roundPassed(state),
  };
}

/** One line of the evening bar (what the table waits for), or '' when there is nothing to say. */
export function stageStatus(state: TableState, me: SeatId | null): string {
  const name = (id: SeatId): string => (id === me ? 'you' : state.seats[id]?.name || id);
  const p = openProposal(state);
  if (p !== null) {
    const what = p.event === 'nextGame' ? 'the next game' : 'a new draft';
    if (p.passed) return `Everyone agreed to ${what}.`;
    if (p.held) return `${p.by === me ? 'You' : p.byName} proposed ${what}; someone is holding.`;
    return `${p.by === me ? 'You' : p.byName} proposed ${what}; waiting for ${p.waiting.map(name).join(', ')}.`;
  }
  switch (state.stage) {
    case 'draft':
      return state.draft?.done === true ? 'The draft is over: on to deck building.' : '';
    case 'build': {
      const waiting = notReady(state);
      if (waiting.length === 0) return 'Everyone is Ready: the game starts.';
      return waiting.includes(me ?? '') ? `Build your deck and press Ready${waiting.length > 1 ? ` (also waiting for ${waiting.filter((s) => s !== me).map(name).join(', ')})` : ''}.` : `Waiting for ${waiting.map(name).join(', ')} to press Ready.`;
    }
    case 'match':
      return state.games !== undefined && state.games > 1 ? `Game ${state.games}.` : '';
    default:
      return '';
  }
}

/** The proposals this seat may make now (DESIGN Evening stages; core/stage.ts STAGE_EDGES): next game from a match, a new draft from a match or the builder. */
export function proposals(state: TableState, me: SeatId | null): ('nextGame' | 'newDraft')[] {
  if (me === null || state.seats[me]?.name.trim() === '' || !state.seats[me]) return [];
  if (openProposal(state) !== null) return [];
  if (state.stage === 'match') return ['nextGame', 'newDraft'];
  if (state.stage === 'build') return ['newDraft'];
  return [];
}

/** Button labels of the proposals. */
export const PROPOSAL_LABELS = { nextGame: 'Next game', newDraft: 'New draft' } as const;
