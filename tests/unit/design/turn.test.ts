/**
 * PLAN M7-P2: the turn tracker and the context-aware primary button (docs/design/m7-hud-proposal.md, Always visible:
 * "five grouped steps: Beginning · Main · Combat · Main 2 · End"; Primary button: "'Draw' in Beginning, 'To combat ▸'
 * in Main, 'Main 2 ▸' after combat, 'End turn ▸' in Main 2 or End. Not my turn: replaced by 'Waiting for Ben'"; DESIGN
 * "Turn flow and confirmation": untap-and-draw is offered, never done for them).
 */
import { describe, expect, it } from 'vitest';
import type { PhaseSpec } from '../../../src/core/types';
import { MTG_PHASES } from '../../../src/games/mtg/zones';
import { primaryAction, stepOf, turnSteps } from '../../../src/ui/hud/turn';

const base = { mine: true, phases: MTG_PHASES, activeName: 'Ben', offer: false };

describe('turn tracker steps', () => {
  it("groups Magic's seven phases into five steps, untap, upkeep and draw under Beginning", () => {
    const steps = turnSteps(MTG_PHASES);
    expect(steps.map((s) => s.label)).toEqual(['Beginning', 'Main', 'Combat', 'Main 2', 'End']);
    expect(steps[0]!.phases).toEqual(['untap', 'upkeep', 'draw']);
    // Every phase is reachable from exactly one step (any player can move the marker to any phase).
    expect(steps.flatMap((s) => s.phases).sort()).toEqual(MTG_PHASES.map((p) => p.id).sort());
  });

  it('finds the step of each phase', () => {
    const steps = turnSteps(MTG_PHASES);
    expect(stepOf(steps, 'upkeep')!.id).toBe('beginning');
    expect(stepOf(steps, 'main1')!.id).toBe('main');
    expect(stepOf(steps, 'main2')!.id).toBe('main2');
    expect(stepOf(steps, 'end')!.id).toBe('end');
  });

  it('keeps every phase as its own step for a game with other phases', () => {
    const phases: PhaseSpec[] = [
      { id: 'a', label: 'Ready' },
      { id: 'b', label: 'Act' },
    ];
    expect(turnSteps(phases).map((s) => s.label)).toEqual(['Ready', 'Act']);
    expect(primaryAction({ ...base, phases, phase: 'a' })).toMatchObject({ kind: 'nextPhase', label: 'Act ▸', phase: 'b' });
    expect(primaryAction({ ...base, phases, phase: 'b' })).toMatchObject({ kind: 'endTurn' });
  });
});

describe('primary button', () => {
  it('walks the turn: beginning → main → combat → main 2 → end turn', () => {
    expect(primaryAction({ ...base, phase: 'untap', offer: true })).toMatchObject({ kind: 'untapDraw', phase: 'main1', disabled: false });
    expect(primaryAction({ ...base, phase: 'draw' })).toMatchObject({ kind: 'toMain', phase: 'main1' });
    expect(primaryAction({ ...base, phase: 'main1' })).toMatchObject({ kind: 'toCombat', label: 'To combat ▸', phase: 'combat' });
    expect(primaryAction({ ...base, phase: 'combat' })).toMatchObject({ kind: 'toMain2', label: 'Main 2 ▸', phase: 'main2' });
    expect(primaryAction({ ...base, phase: 'main2' })).toMatchObject({ kind: 'endTurn', label: 'End turn ▸', phase: null });
    expect(primaryAction({ ...base, phase: 'end' })).toMatchObject({ kind: 'endTurn', label: 'End turn ▸' });
  });

  it('draws only on a deliberate press while the new turn offer is open, never a second card after it was taken', () => {
    expect(primaryAction({ ...base, phase: 'untap', offer: true }).label).toBe('Untap & draw ▸');
    // The offer was taken (or dismissed): the button moves on to main without drawing.
    expect(primaryAction({ ...base, phase: 'untap', offer: false })).toMatchObject({ kind: 'toMain', label: 'To main ▸' });
  });

  it("waits on another player's turn, and a spectator acts on nothing", () => {
    expect(primaryAction({ ...base, mine: false, phase: 'main1' })).toEqual({ kind: 'wait', label: 'Waiting for Ben', phase: null, disabled: true });
    expect(primaryAction({ ...base, mine: false, spectator: true, phase: 'main1' })).toMatchObject({ kind: 'wait', disabled: true, label: "Ben's turn" });
  });

  it('never names a key on the button (keys live in tooltips)', () => {
    for (const phase of MTG_PHASES.map((p) => p.id)) for (const offer of [false, true]) expect(primaryAction({ ...base, phase, offer }).label).not.toMatch(/ctrl|enter|tab|\bU\b/i);
  });
});
