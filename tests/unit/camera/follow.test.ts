// DESIGN "Camera and navigation", Follow options: follow the stack (the camera eases to include a new stack item if it
// is off screen) and follow the active player (ease to their territory on turn change); both off by default. Also the
// bird's-eye behaviour kept under the new rig controller (fit, pan, zoom at the cursor, seats) and the P key's anchor.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { followRequests } from '../../../src/scene/camera/follow';
import type { TableState } from '../../../src/core/types';
import { fakeGame, tableWith, type RecordingScene } from '../../../src/ui/fakes';
import { rig as hudRig } from '../ui/setup';
import { Commands, type UiHooks } from '../../../src/ui/commands';
import { VP, makeRig, px } from './helpers';

const base = (): TableState => tableWith(['Anna', 'Ben'], []).state;
const both = { stack: true, activePlayer: true };

describe('follow requests', () => {
  it('ask for nothing with the toggles off (the default) or on the first state', () => {
    const a = base();
    const b = { ...a, turn: { ...a.turn, active: 's1', number: 2 }, stack: [{ id: 'si1', kind: 'ability' as const, controller: 's1', source: 'x' }] };
    expect(followRequests(a, b, { stack: false, activePlayer: false })).toEqual([]);
    expect(followRequests(null, b, both)).toEqual([]);
  });

  it('a turn passing to another player asks to go to their territory', () => {
    const a = base();
    const b = { ...a, turn: { ...a.turn, active: 's1', number: 2 } };
    expect(followRequests(a, b, { stack: false, activePlayer: true })).toEqual([{ kind: 'active', who: 's1' }]);
    // A phase change within the turn is not a turn change.
    const c = { ...b, turn: { ...b.turn, phase: 'combat' } };
    expect(followRequests(b, c, both)).toEqual([]);
  });

  it('a new stack item asks to include the newest; resolving one asks for nothing', () => {
    const a = base();
    const one = { ...a, stack: [{ id: 'si1', kind: 'spell' as const, controller: 's0', card: 'c1' }] };
    const two = { ...one, stack: [...one.stack, { id: 'si2', kind: 'trigger' as const, controller: 's1', source: 'c9' }] };
    expect(followRequests(a, one, { stack: true, activePlayer: false })).toEqual([{ kind: 'stackItem', item: 'si1' }]);
    expect(followRequests(one, two, both)).toEqual([{ kind: 'stackItem', item: 'si2' }]);
    expect(followRequests(two, one, both)).toEqual([]);
  });
});

describe('bird\'s-eye behaviour under the rig controller', () => {
  it('fit, pan and zoom at the cursor work as before (straight down)', () => {
    const rig = makeRig();
    expect(rig.pose().fovDeg).toBe(6);
    expect(rig.pose().pitchDeg).toBe(90);
    expect(rig.bird.atFit()).toBe(true);
    const s = { x: 300, y: 200 };
    const a = rig.screenToTable(s.x, s.y);
    rig.zoomAt(s.x, s.y, 2);
    expect(px(rig.tableToScreen(a), s)).toBeLessThan(1e-6);
    rig.panBy(50, -30);
    expect(px(rig.tableToScreen(a), { x: s.x + 50, y: s.y - 30 })).toBeLessThan(1e-6);
    rig.fit(0, 0);
    expect(rig.bird.atFit()).toBe(true);
  });

  it('a tilted bird\'s-eye keeps the table point under the cursor when zooming and follows the pan (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 100, max: VP.w - 100, noNaN: true }), fc.double({ min: 100, max: VP.h - 100, noNaN: true }), fc.double({ min: 1.01, max: 3, noNaN: true }), fc.constantFrom(0, 90, 180), (x, y, f, angle) => {
        const rig = makeRig({ tiltDeg: 10, angle });
        rig.bird.view = { cx: 0, cy: 0, dist: (rig.bird.minDist() + rig.bird.maxDist()) / 2, angle };
        const a = rig.screenToTable(x, y);
        rig.zoomAt(x, y, f);
        expect(px(rig.tableToScreen(a), { x, y })).toBeLessThan(0.5);
        const c = rig.screenToTable(VP.w / 2 - 20, VP.h / 2 - 10);
        rig.panBy(20, 10);
        expect(px(rig.tableToScreen(c), { x: VP.w / 2, y: VP.h / 2 })).toBeLessThan(0.5);
      }),
      { numRuns: 100 },
    );
  });

  it('a new table resets both rigs and cuts a blend', () => {
    const rig = makeRig();
    rig.setRig('ego', 0, 400, null);
    rig.setTable({ w: 1800, d: 1800 }, 90, { x: 0, y: 0, w: 1800, d: 1800 });
    expect(rig.blendState()).toBeNull();
    expect(rig.rig()).toBe('ego');
    expect(rig.pose().position[0]).toBeCloseTo(-1160, 6);
  });
});

describe('the P key', () => {
  it('switches rig keeping the point under the pointer (the HUD hands the pointer to the command)', () => {
    const r = hudRig();
    const calls: unknown[][] = [];
    const scene = r.scene;
    const camera = { ...scene.camera, setRig: (...args: unknown[]) => calls.push(args), rig: () => 'birdseye' as const };
    const withCamera = Object.assign(Object.create(scene) as RecordingScene, { camera });
    const commands = new Commands({ session: r.session, game: fakeGame(), scene: () => withCamera, view: () => r.view, ui: {} as UiHooks, newId: (p) => p, now: () => 0, pointer: () => ({ x: 640, y: 380 }) });
    commands.run('perspective');
    expect(calls).toEqual([['ego', { anchor: { x: 640, y: 380 } }]]);
  });

  it('without a known pointer the view centre is the anchor', () => {
    const r = hudRig();
    r.press({ key: 'p' });
    expect(r.scene.calls).toEqual([{ method: 'camera.setRig', args: ['ego'] }]);
  });
});
