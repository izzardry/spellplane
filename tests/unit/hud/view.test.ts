/** PLAN Milestone 8, M7-P2: the View control's preset cycle (ui/hud/view.ts) and the opening-hand rule (ui/hud/opening.ts). */
import { describe, expect, it } from 'vitest';
import { TILT_PRESETS } from '../../../src/scene/types';
import { nextPreset } from '../../../src/ui/hud/view';
import { shellGroups } from '../../../src/ui/hud/menu-model';

describe('View control', () => {
  it('cycles first person → leaning in → bird\'s-eye → first person from the nearest preset', () => {
    expect(nextPreset(TILT_PRESETS, 0).id).toBe('midTilt');
    expect(nextPreset(TILT_PRESETS, 0.5).id).toBe('birdseye');
    expect(nextPreset(TILT_PRESETS, 1).id).toBe('firstPerson');
    expect(nextPreset(TILT_PRESETS, 0.2).id).toBe('midTilt');
    expect(nextPreset(TILT_PRESETS, 0.8).id).toBe('firstPerson');
  });
});

describe('shell menu groups', () => {
  it('reads both kit group shapes and runs the shell item', () => {
    const ran: string[] = [];
    const g = shellGroups([
      { title: 'This game', items: [{ id: 'leave', label: 'Leave to home', run: () => ran.push('leave') }] },
      { id: 'x', label: 'Seed shape', items: [{ id: 'c', label: 'Concede', danger: true, run: () => ran.push('c') }] },
      { title: 'Empty', items: [] },
    ]);
    expect(g.map((x) => x.label)).toEqual(['This game', 'Seed shape']);
    expect(g[0]!.items[0]!.testid).toBe('menu-top-leave');
    g[0]!.items[0]!.run!();
    g[1]!.items[0]!.run!();
    expect(ran).toEqual(['leave', 'c']);
    expect(g[1]!.items[0]!.danger).toBe(true);
  });
});
