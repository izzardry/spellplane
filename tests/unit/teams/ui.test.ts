/**
 * The Two-Headed Giant HUD and lobby rules (PLAN M3-P2; DESIGN "Players, seats and formats", Two-Headed Giant: the
 * teammate's hand is "a second, smaller fan above the player's own"; team creation in the lobby's chair map; the team
 * reveal target, DESIGN "Multiplayer architecture", Targeted reveal: "Showing a card to one player or to a teammate").
 */
import { describe, expect, it } from 'vitest';
import { SCREEN_LAYER } from '../../../src/core/geometry';
import { createTable } from '../../../src/core/reducer';
import { mtg } from '../../../src/games/index';
import { fanLayout } from '../../../src/ui/hand';
import { teamFanBottom, teamFanLayout, teamRevealChoices, TEAM_FAN_WIDTH_FRACTION } from '../../../src/ui/hand/team';
import { chairChoice, teamGroups } from '../../../src/ui/lobby/seats';
import { TEAM_FAN_HEIGHT } from '../../../src/ui/types';
import { freshNetTable } from '../../../src/session/net';
import { teamTable } from './helpers';

describe('the teammate’s fan', () => {
  it('is smaller than the own fan and sits wholly above it, inside the viewport, at every hand size', () => {
    for (const [vw, vh] of [
      [1440, 900],
      [800, 600],
      [390, 844],
    ] as const) {
      const ownTop = vh * SCREEN_LAYER.handCardViewportFraction;
      expect(teamFanBottom(vh)).toBeGreaterThan(ownTop);
      for (const n of [1, 7, 15, 40]) {
        const boxes = teamFanLayout(n, vw, vh);
        const own = fanLayout(n, vw, vh);
        expect(boxes).toHaveLength(n);
        for (const [i, b] of boxes.entries()) {
          expect(b.height).toBeCloseTo(vh * TEAM_FAN_HEIGHT);
          expect(b.height).toBeLessThan(own[i]!.height);
          expect(b.bottom).toBeGreaterThan(ownTop);
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.left + b.width).toBeLessThanOrEqual(vw + 0.001);
        }
        const span = boxes[n - 1]!.left + boxes[n - 1]!.width - boxes[0]!.left;
        expect(span).toBeLessThanOrEqual(Math.max(vw * TEAM_FAN_WIDTH_FRACTION, boxes[0]!.width) + 0.001);
      }
    }
    expect(teamFanLayout(0, 1440, 900)).toEqual([]);
    // A hovered card grows, on top, still on screen.
    const h = teamFanLayout(7, 1440, 900, 6);
    expect(h[6]!.height).toBeGreaterThan(h[0]!.height);
    expect(h[6]!.z).toBe(8);
    expect(h[6]!.left + h[6]!.width).toBeLessThanOrEqual(1440);
  });
});

describe('team reveal targets', () => {
  it('offer the own team and the opposing team, each expanded to its seats without the revealer', () => {
    const t = teamTable();
    expect(teamRevealChoices(t, 's0')).toEqual([
      { id: 'team:t0', label: 'My team (Ben)', seats: ['s1'] },
      { id: 'team:t1', label: 'Team Cleo & Dan', seats: ['s2', 's3'] },
    ]);
    expect(teamRevealChoices(t, 's3').map((c) => c.seats)).toEqual([['s0', 's1'], ['s2']]);
    // No teams, no team targets.
    const ffa = createTable({ game: mtg, format: 'ffa4', seats: ['A', 'B', 'C', 'D'].map((name, i) => ({ name, colour: i })) });
    expect(teamRevealChoices(ffa, 's0')).toEqual([]);
  });

  it('leave out empty chairs', () => {
    const t = teamTable();
    t.seats.s3!.name = '';
    expect(teamRevealChoices(t, 's0')[1]).toEqual({ id: 'team:t1', label: 'Team Cleo', seats: ['s2'] });
  });
});

describe('team creation in the lobby', () => {
  it('a Two-Headed Giant table starts with every chair in its team: two chairs side by side per team', () => {
    const t = freshNetTable(mtg, '2hg');
    expect(Object.values(t.seats).map((s) => [s.id, s.team])).toEqual([
      ['s0', 't0'],
      ['s1', 't0'],
      ['s2', 't1'],
      ['s3', 't1'],
    ]);
    expect(t.teams).toEqual({ t0: { id: 't0', seats: ['s0', 's1'], life: 30, counters: {} }, t1: { id: 't1', seats: ['s2', 's3'], life: 30, counters: {} } });
    expect(t.turn.active).toBe('t0');
    expect(freshNetTable(mtg, 'ffa4').teams).toEqual({});
  });

  it('groups the chairs by team; sitting down joins a team and a free chair of the other team switches', () => {
    let t = freshNetTable(mtg, '2hg');
    expect(teamGroups(t, 'pa').map((g) => [g.label, g.chairs.map((c) => c.seat), g.full, g.mine])).toEqual([
      ['Team 1', ['s0', 's1'], false, false],
      ['Team 2', ['s2', 's3'], false, false],
    ]);
    t = { ...t, seats: { ...t.seats, s0: { ...t.seats.s0!, name: 'Anna', peer: 'pa' }, s1: { ...t.seats.s1!, name: 'Ben', peer: 'pb' } } };
    const g = teamGroups(t, 'pa');
    expect(g[0]).toMatchObject({ team: 't0', mine: true, full: true });
    expect(g[1]).toMatchObject({ team: 't1', mine: false, full: false });
    // Anna may move to a free chair of team 2.
    expect(chairChoice(t, 's2', 'pa')).toEqual({ ok: true });
    expect(teamGroups(freshNetTable(mtg, '1v1'), 'pa')).toEqual([]);
  });
});
