// TableRig helpers the table scene draws and picks with (M4-P1): a card's on-screen height for its texture tier
// (DESIGN "Specification: geometry, layout and motion", Texture tiers: by on-screen height), picking at a card's own
// height (DESIGN "Camera and navigation": every gesture works the same in both rigs), and the camera's clip planes.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GEOMETRY } from '../../../src/core/geometry';
import { clampEgoNav } from '../../../src/scene/camera/ego';
import { projectPoint } from '../../../src/scene/camera/pose';
import { SEATS, VP, makeRig, px } from './helpers';

const CARD_H = GEOMETRY.card.h;

describe('a card\'s on-screen height', () => {
  it('straight down it is the card\'s height times the scale, whatever its rotation', () => {
    const rig = makeRig();
    rig.zoomAt(720, 450, 3);
    for (const rot of [0, 33, 90, 180, 270]) {
      const p = { x: 120, y: -80, rot };
      expect(rig.cardScreenHeight(p)).toBeCloseTo(CARD_H * rig.pxPerMmAt(p), 1);
      expect(rig.cardScreenHeight(p, 0, 0.5)).toBeCloseTo(0.5 * CARD_H * rig.pxPerMmAt(p), 1);
    }
  });

  it('in the ego rig a card lying flat facing the viewer shows shorter than its scale times its height (foreshortening)', () => {
    const rig = makeRig({ rig: 'ego' });
    const p = { x: 0, y: -100, rot: 0 };
    const flat = rig.cardScreenHeight(p);
    const faceOn = CARD_H * rig.pxPerMmAt(p);
    expect(flat).toBeLessThan(faceOn * 0.85);
    // It is the projected distance between the card's near and far edge midpoints.
    const near = rig.tableToScreen({ x: 0, y: -100 - CARD_H / 2 });
    const far = rig.tableToScreen({ x: 0, y: -100 + CARD_H / 2 });
    expect(flat).toBeCloseTo(px(near, far), 6);
    // A tapped card lies across the view: its long axis is not foreshortened.
    expect(rig.cardScreenHeight({ ...p, rot: 90 })).toBeGreaterThan(flat * 1.2);
  });

  it('is 0 for a card behind the camera', () => {
    const rig = makeRig({ rig: 'ego' });
    // Behind the camera's plane even from the raised ego seat (M5-P7).
    expect(rig.cardScreenHeight({ x: 0, y: -4000, rot: 0 })).toBe(0);
  });
});

describe('picking at a card\'s height', () => {
  it('the ray through a screen point crosses a raised plane where that plane\'s point shows (both rigs)', () => {
    fc.assert(
      fc.property(fc.constantFrom('birdseye' as const, 'ego' as const), fc.double({ min: 50, max: VP.w - 50, noNaN: true }), fc.double({ min: 50, max: VP.h - 50, noNaN: true }), fc.double({ min: 0, max: 40, noNaN: true }), (r, x, y, z) => {
        const rig = makeRig({ rig: r });
        const q = rig.screenToPlane(x, y, z);
        if (!q) return;
        expect(px(rig.tableToScreen(q, z), { x, y })).toBeLessThan(1e-6);
      }),
      { numRuns: 200 },
    );
  });

  it('in the ego rig the top of a 20 mm pile shows well beyond its footprint', () => {
    const rig = makeRig({ rig: 'ego' });
    const s = rig.tableToScreen({ x: 0, y: 0 }, 20);
    const onTable = rig.screenToTableOrNull(s.x, s.y)!;
    const onTop = rig.screenToPlane(s.x, s.y, 20)!;
    expect(Math.hypot(onTop.x, onTop.y)).toBeLessThan(1e-6);
    expect(onTable.y).toBeGreaterThan(15);
  });
});

describe('clip planes', () => {
  it('keep every table point the view shows, at every height a card is drawn at, between near and far', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEATS),
        fc.record({ lean: fc.double({ min: -1, max: 1, noNaN: true }), dolly: fc.double({ min: 0, max: 1, noNaN: true }), pitch: fc.double({ min: 0, max: 1, noNaN: true }) }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 4 * GEOMETRY.dragLift, noNaN: true }),
        (seat, u, fx, fy, z) => {
          const rig = makeRig({ ...seat, rig: 'ego' });
          const P = rig.ego;
          rig.nav = clampEgoNav(P, { lean: u.lean * P.leanMm, dolly: u.dolly * P.maxDollyMm, pitchDeg: P.minPitchDeg + u.pitch * (P.maxPitchDeg - P.minPitchDeg) });
          const pose = rig.pose();
          const q = rig.screenToPlane(fx * VP.w, fy * VP.h, z);
          if (!q || Math.abs(q.x) > seat.table.w / 2 || Math.abs(q.y) > seat.table.d / 2) return;
          const { near, far } = rig.clipPlanes();
          const d = projectPoint(pose, seat.angle, VP, [q.x, q.y, z]).depth;
          expect(d).toBeGreaterThan(near);
          expect(d).toBeLessThan(far);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('dollied over the table in the ego rig, near stays tens of millimetres away (not 1 mm), for depth precision', () => {
    for (const seat of SEATS) {
      const rig = makeRig({ ...seat, rig: 'ego' });
      const P = rig.ego;
      rig.nav = clampEgoNav(P, { lean: 0, dolly: P.maxDollyMm, pitchDeg: P.minPitchDeg });
      expect(rig.depthRange().min, `${seat.format} seat ${seat.seat}`).toBeLessThan(0);
      const { near, far } = rig.clipPlanes();
      expect(near, `${seat.format} seat ${seat.seat}`).toBeGreaterThan(20);
      expect(far / near, `${seat.format} seat ${seat.seat}`).toBeLessThan(500);
    }
  });

  it('bird\'s-eye: near and far bracket the table closely', () => {
    const rig = makeRig();
    const { near, far } = rig.clipPlanes();
    const dist = rig.bird.view.dist;
    expect(near).toBeGreaterThan(dist / 3);
    expect(far).toBeGreaterThan(dist);
    expect(far).toBeLessThan(dist + 1000);
  });
});
