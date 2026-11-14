// PLAN M4-P1 acceptance, blend maths: "During a blend the world point under the cursor moves less than 2 px" and "with
// reduced motion the switch is a cut". DESIGN "Camera and navigation", Switching: one key (P) blends between the rigs in
// about 400 ms by interpolating position, tilt and field of view; the bird's-eye rig is a perspective camera with a
// very narrow field of view from far away, so the blend is continuous; the point under the cursor stays under the
// cursor. "Specification: geometry, layout and motion", Camera rigs: bird's-eye 6°, ego 45° pitched 35°; the blend
// interpolates field of view, position and pitch together over 400 ms while solving distance so the cursor's table
// point stays fixed.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blendPose, easeBlend } from '../../../src/scene/camera/blend';
import { poseAt, poseDist, targetFor, unprojectToTable } from '../../../src/scene/camera/pose';
import { clampEgoNav, egoPose, defaultEgoNav } from '../../../src/scene/camera/ego';
import { mtgLayout } from '../../../src/games/mtg/layout';
import type { TableRig } from '../../../src/scene/camera/rig';
import { DEFAULT_EGO_RIG, type CameraRig } from '../../../src/scene/types';
import { BLEND_MS, SEATS, TABLES, VP, makeRig, onTable, px, runSwitch, screenOf } from './helpers';

describe('blendPose', () => {
  const bird = poseAt({ x: 0, y: 0 }, 13000, 90, 6, 0);
  const ego = egoPose(DEFAULT_EGO_RIG, TABLES['1v1'], 0, defaultEgoNav(DEFAULT_EGO_RIG));

  it('starts at the first pose and ends at the second', () => {
    expect(blendPose(bird, ego, 0, VP, null)).toEqual(bird);
    expect(blendPose(bird, ego, 1, VP, null)).toEqual(ego);
  });

  it('interpolates field of view and pitch between the rigs, continuously', () => {
    let prev = blendPose(bird, ego, 0, VP, null);
    for (let i = 1; i <= 100; i++) {
      const p = blendPose(bird, ego, i / 100, VP, null);
      // Field of view grows monotonically from 6° to 45°, pitch falls from 90° to 35°.
      expect(p.fovDeg).toBeGreaterThanOrEqual(prev.fovDeg);
      expect(p.pitchDeg).toBeLessThanOrEqual(prev.pitchDeg);
      expect(p.fovDeg).toBeGreaterThanOrEqual(6);
      expect(p.fovDeg).toBeLessThanOrEqual(45);
      // No jumps: the camera never moves more than a small share of its distance per 1% of the blend.
      const step = Math.hypot(p.position[0] - prev.position[0], p.position[1] - prev.position[1], p.position[2] - prev.position[2]);
      expect(step).toBeLessThan(0.08 * Math.max(poseDist(p), poseDist(prev)));
      prev = p;
    }
  });

  it('when the two ends show the anchor at different places, it moves on a straight line between them, never jumping (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 20, max: VP.w - 20, noNaN: true }), fc.double({ min: 20, max: VP.h - 20, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (x, y, t) => {
        // Anchor taken from the bird's-eye view; the ego end is then solved through the rig (below); here both ends
        // hold it by construction: put the ego pose's view of the anchor on the same screen point.
        const a = unprojectToTable(bird, 0, VP, x, y)!;
        const s = { x, y };
        const egoAt = screenOf(ego, 0, a);
        // Only anchors the ego end shows at the same place are exact; elsewhere the error moves on a straight line.
        const p = blendPose(bird, ego, t, VP, { table: a, screen: s });
        const expected = { x: s.x + (egoAt.x - s.x) * t, y: s.y + (egoAt.y - s.y) * t };
        expect(px(screenOf(p, 0, a), expected)).toBeLessThan(0.01);
      }),
      { numRuns: 300 },
    );
  });

  it('eases in and out', () => {
    expect(easeBlend(0)).toBe(0);
    expect(easeBlend(1)).toBe(1);
    expect(easeBlend(0.5)).toBeCloseTo(0.5, 9);
    expect(easeBlend(0.1)).toBeLessThan(0.1);
    expect(easeBlend(0.9)).toBeGreaterThan(0.9);
  });
});

describe('rig switch (P)', () => {
  const anchors = fc.record({ x: fc.double({ min: 10, max: VP.w - 10, noNaN: true }), y: fc.double({ min: 10, max: VP.h - 10, noNaN: true }) });

  // Every cursor over the table, on every table format and every viewer seat (the ego seat sits in front of the
  // viewer's own territory, beside the centre line on three-player and Two-Headed Giant tables). Cursors over the
  // surround are left out on purpose: no ego pose within the limits need show a point beyond the table's edge at the
  // cursor, and the bird's-eye view clamps its centre to the table for them; there the point moves on a straight line between
  // where the two rigs show it (the blendPose property above).
  const seats = fc.constantFrom(...SEATS);

  it('bird\'s-eye to ego: the table point under the cursor moves less than 2 px during the whole blend (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(anchors, seats, fc.double({ min: 1, max: 4, noNaN: true }), (s, seat, zoom) => {
        const rig = makeRig(seat);
        rig.zoomAt(s.x, s.y, zoom);
        const a = rig.screenToTable(s.x, s.y);
        expect(px(rig.tableToScreen(a), s)).toBeLessThan(1e-6);
        if (!onTable(seat.table, a)) return;
        checked++;
        const { poses, blending } = runSwitch(rig, 'ego', s);
        for (const p of poses) expect(px(screenOf(p, seat.angle, a), s), `${seat.format} seat ${seat.seat}`).toBeLessThan(2);
        expect(blending.some(Boolean)).toBe(true);
        expect(rig.rig()).toBe('ego');
        expect(rig.blendState()).toBeNull();
        expect(poses.at(-1)!.fovDeg).toBe(45);
      }),
      { numRuns: 300 },
    );
    // fast-check favours the screen's edges, often over the surround; the grids below cover the table evenly.
    expect(checked).toBeGreaterThan(30);
  });

  it('bird\'s-eye to ego holds the cursor point for every cursor over a fitted table, on every format and seat', () => {
    for (const seat of SEATS) {
      let checked = 0;
      for (let fx = 0.025; fx < 1; fx += 0.05) {
        for (let fy = 0.025; fy < 1; fy += 0.05) {
          const rig = makeRig(seat);
          const s = { x: VP.w * fx, y: VP.h * fy };
          const a = rig.screenToTable(s.x, s.y);
          if (!onTable(seat.table, a)) continue;
          const { poses } = runSwitch(rig, 'ego', s, 20);
          const worst = Math.max(...poses.map((p) => px(screenOf(p, seat.angle, a), s)));
          expect(worst, `${seat.format} seat ${seat.seat}, cursor at ${s.x}, ${s.y}`).toBeLessThan(2);
          checked++;
        }
      }
      expect(checked, `${seat.format} seat ${seat.seat}`).toBeGreaterThan(200);
    }
  });

  it('the reviewer\'s cases: four players and Two-Headed Giant, cursor near the table\'s side edge', () => {
    const cases = [
      { seat: SEATS.find((x) => x.format === 'ffa4' && x.seat === 0)!, s: { x: 360, y: 675 } },
      { seat: { ...SEATS.find((x) => x.format === '2hg')!, lateral: -550 }, s: { x: 1224, y: 585 } },
    ];
    for (const { seat, s } of cases) {
      const rig = makeRig(seat);
      const a = rig.screenToTable(s.x, s.y);
      expect(onTable(seat.table, a)).toBe(true);
      const { poses } = runSwitch(rig, 'ego', s);
      for (const p of poses) expect(px(screenOf(p, seat.angle, a), s), seat.format).toBeLessThan(2);
    }
  });

  // A bird's-eye view panned or zoomed anywhere (not only at the cursor): whenever some ego navigation within the
  // limits shows the cursor's table point at the cursor, the switch must find one (lean, dolly and pitch together) and
  // hold the point. The cases are built from such a navigation, so a solution exists by construction.
  it('bird\'s-eye panned and zoomed anywhere to ego: whenever an ego pose within the limits holds the point, the switch holds it (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(
        anchors,
        seats,
        // Leaning far out and dollied forward is where a solve from the seat alone falls short.
        fc.record({ lean: fc.oneof(fc.constantFrom(-1, 1), fc.double({ min: -1, max: 1, noNaN: true })), dolly: fc.double({ min: 0, max: 1, noNaN: true }), pitch: fc.double({ min: 0, max: 1, noNaN: true }) }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, seat, u, z) => {
          const rig = makeRig(seat);
          const P = rig.ego;
          const nav = clampEgoNav(P, { lean: u.lean * P.leanMm, dolly: u.dolly * P.maxDollyMm, pitchDeg: P.minPitchDeg + u.pitch * (P.maxPitchDeg - P.minPitchDeg) });
          const a = unprojectToTable(rig.egoPoseOf(nav), seat.angle, VP, s.x, s.y);
          if (!a || !onTable(seat.table, a)) return;
          // A bird's-eye view at any zoom that shows `a` under the cursor, if the view's limits allow one.
          const b = rig.bird;
          const dist = b.minDist() * Math.pow(b.maxDist() / b.minDist(), z);
          const t = targetFor(rig.birdPitch(), dist, b.fovDeg, seat.angle, VP, a, s);
          if (!t) return;
          b.view = b.clampView({ cx: t.x, cy: t.y, dist, angle: b.view.angle });
          if (px(rig.tableToScreen(a), s) > 1e-6) return;
          checked++;
          const { poses } = runSwitch(rig, 'ego', s);
          for (const p of poses) expect(px(screenOf(p, seat.angle, a), s), `${seat.format} seat ${seat.seat}`).toBeLessThan(2);
        },
      ),
      // The raised ego seat (M5-P7) shows the table smaller in the ego poses drawn here: more runs.
      { numRuns: 1800 },
    );
    // About a twelfth of the draws give a cursor over the table that a bird's-eye view can show there.
    expect(checked).toBeGreaterThan(100);
  });

  it('the reviewer\'s cases: a bird\'s-eye view zoomed away from the cursor needs the ego rig to dolly forward', () => {
    for (const c of [
      { div: 3, s: { x: 300, y: 200 } },
      { div: 3, s: { x: 100, y: 450 } },
      { div: 5, s: { x: 100, y: 450 } },
    ]) {
      const rig = makeRig();
      const fitted = rig.bird.view.dist;
      rig.bird.view = rig.bird.clampView({ cx: 400, cy: 300, dist: fitted / c.div, angle: 0 });
      const a = rig.screenToTable(c.s.x, c.s.y);
      expect(onTable(TABLES['1v1'], a)).toBe(true);
      const { poses } = runSwitch(rig, 'ego', c.s);
      for (const p of poses) expect(px(screenOf(p, 0, a), c.s), JSON.stringify(c)).toBeLessThan(2);
      expect(rig.nav.dolly).toBeGreaterThan(0);
    }
  });

  it('ego to bird\'s-eye: the table point under the cursor moves less than 2 px (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(anchors, seats, fc.double({ min: 1, max: 3, noNaN: true }), (s, seat, zoom) => {
        const rig = makeRig({ ...seat, rig: 'ego' });
        rig.zoomAt(s.x, s.y, zoom);
        const a = rig.screenToTableOrNull(s.x, s.y);
        if (!a || !onTable(seat.table, a)) return;
        checked++;
        const { poses } = runSwitch(rig, 'birdseye', s);
        for (const p of poses) expect(px(screenOf(p, seat.angle, a), s), `${seat.format} seat ${seat.seat}`).toBeLessThan(2);
        expect(poses.at(-1)!.fovDeg).toBe(6);
        expect(poses.at(-1)!.pitchDeg).toBeCloseTo(90, 9);
      }),
      // The raised ego seat (M5-P7) shows the whole table smaller, so fewer draws land on it: more runs.
      { numRuns: 600 },
    );
    expect(checked).toBeGreaterThan(50);
  });

  it('ego to bird\'s-eye holds the point for every cursor over the table seen in ego, on every format and seat', () => {
    for (const seat of SEATS) {
      let checked = 0;
      for (let fx = 0.025; fx < 1; fx += 0.05) {
        for (let fy = 0.025; fy < 1; fy += 0.05) {
          const r = makeRig({ ...seat, rig: 'ego' });
          const s = { x: VP.w * fx, y: VP.h * fy };
          const a = r.screenToTableOrNull(s.x, s.y);
          if (!a || !onTable(seat.table, a)) continue;
          const { poses } = runSwitch(r, 'birdseye', s, 20);
          const worst = Math.max(...poses.map((p) => px(screenOf(p, seat.angle, a), s)));
          expect(worst, `${seat.format} seat ${seat.seat}, cursor at ${s.x}, ${s.y}`).toBeLessThan(2);
          checked++;
        }
      }
      // The raised ego seat (M5-P7) shows the whole table, smaller: about a quarter of the grid lies on it.
      expect(checked, `${seat.format} seat ${seat.seat}`).toBeGreaterThan(90);
    }
  });

  it('ego to bird\'s-eye zooms in only when the zoom the viewer left cannot hold the point', () => {
    // One versus one, seat 0, the ego rig pitched steeply down (60°): a table point near the own edge shows at the
    // screen's top-left corner, where the fitted bird's-eye would need its centre beyond the table to keep it. (Until
    // M5 this case was the three-player seat 1 at its default ego view; since M5-P7 the three-player seats sit on the
    // centre line at 120° and the raised ego seat frames the whole table, so the default view needs no zoom anywhere.)
    const seat = SEATS.find((x) => x.format === '1v1' && x.seat === 0)!;
    const steep = () => {
      const r = makeRig({ ...seat, rig: 'ego' });
      r.nav = clampEgoNav(r.ego, { lean: 0, dolly: 0, pitchDeg: 60 });
      return r;
    };
    const rig = steep();
    const fitted = rig.bird.view.dist;
    const s = { x: 124, y: 76 };
    const a = rig.screenToTableOrNull(s.x, s.y)!;
    expect(onTable(seat.table, a)).toBe(true);
    const { poses } = runSwitch(rig, 'birdseye', s);
    for (const p of poses) expect(px(screenOf(p, seat.angle, a), s)).toBeLessThan(2);
    expect(rig.bird.view.dist).toBeLessThan(fitted);
    // A point near the view centre needs no zoom.
    const r2 = steep();
    runSwitch(r2, 'birdseye', { x: VP.w / 2, y: VP.h / 2 });
    expect(r2.bird.view.dist).toBeCloseTo(fitted, 6);
  });

  // The ego rig may lean beyond the table's side edge (its lean reaches the far side edge from a seat beside the centre
  // line), and then shows table points near that edge on the opposite side of the screen. No bird's-eye centre on the
  // table can put such a point under the cursor; the switch leaves the centre beyond the edge instead.
  const leanedEgo = (seat: (typeof SEATS)[number], u: { lean: number; dolly: number; pitch: number }) => {
    const rig = makeRig({ ...seat, rig: 'ego' });
    const P = rig.ego;
    rig.nav = clampEgoNav(P, { lean: u.lean * P.leanMm, dolly: u.dolly * P.maxDollyMm, pitchDeg: P.minPitchDeg + u.pitch * (P.maxPitchDeg - P.minPitchDeg) });
    return rig;
  };

  it('ego leaned, dollied and pitched anywhere within the limits to bird\'s-eye: every cursor over the table holds its point (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(
        anchors,
        seats,
        fc.record({ lean: fc.oneof(fc.constantFrom(-1, 1), fc.double({ min: -1, max: 1, noNaN: true })), dolly: fc.double({ min: 0, max: 1, noNaN: true }), pitch: fc.double({ min: 0, max: 1, noNaN: true }) }),
        fc.constantFrom(0, 10),
        (s, seat, u, tiltDeg) => {
          const rig = leanedEgo(seat, u);
          if (tiltDeg) rig.setTheme(undefined, tiltDeg);
          const a = rig.screenToTableOrNull(s.x, s.y);
          if (!a || !onTable(seat.table, a)) return;
          checked++;
          const { poses } = runSwitch(rig, 'birdseye', s, 10);
          for (const p of poses) expect(px(screenOf(p, seat.angle, a), s), `${seat.format} seat ${seat.seat} ${JSON.stringify(u)}`).toBeLessThan(2);
          expect(rig.rig()).toBe('birdseye');
          expect(poses.at(-1)!.fovDeg).toBe(6);
        },
      ),
      { numRuns: 2000 },
    );
    // Leaned far out, much of the screen shows the surround: about a tenth of the draws put the cursor over the table.
    expect(checked).toBeGreaterThan(150);
  });

  it('ego leaned to either limit to bird\'s-eye holds every cursor over the table, on every format and seat', () => {
    let checked = 0;
    for (const seat of SEATS) {
      for (const lean of [-1, 1]) {
        for (let fx = 0.025; fx < 1; fx += 0.05) {
          for (let fy = 0.025; fy < 1; fy += 0.05) {
            const r = leanedEgo(seat, { lean, dolly: 0, pitch: (DEFAULT_EGO_RIG.pitchDeg - DEFAULT_EGO_RIG.minPitchDeg) / (DEFAULT_EGO_RIG.maxPitchDeg - DEFAULT_EGO_RIG.minPitchDeg) });
            const s = { x: VP.w * fx, y: VP.h * fy };
            const a = r.screenToTableOrNull(s.x, s.y);
            if (!a || !onTable(seat.table, a)) continue;
            const { poses } = runSwitch(r, 'birdseye', s, 20);
            const worst = Math.max(...poses.map((p) => px(screenOf(p, seat.angle, a), s)));
            expect(worst, `${seat.format} seat ${seat.seat} lean ${lean}, cursor at ${s.x}, ${s.y}`).toBeLessThan(2);
            checked++;
          }
        }
      }
    }
    // Leaned all the way out beside the centre line (Two-Headed Giant) little or none of the table shows; from the raised
    // seat (M5-P7) the table is smaller on screen.
    expect(checked).toBeGreaterThan(2000);
  });

  it('the reviewer\'s cases: ego leaned beyond the side edge on three-player, four-player and Two-Headed Giant tables', () => {
    const seatOf = (format: string, seat: number) => SEATS.find((x) => x.format === format && x.seat === seat)!;
    const cases = [
      { seat: seatOf('ffa3', 1), pan: -1500, s: { x: 36, y: 202 } },
      // (M5-P7's raised ego seat: the point moved from 396, 833 to one this leaned view shows over the table.)
      { seat: seatOf('ffa4', 0), pan: -1500, s: { x: 12, y: 276 } },
      { seat: seatOf('2hg', 0), pan: -800, s: { x: 12, y: 276 } },
      { seat: seatOf('2hg', 1), pan: 800, s: { x: 1044, y: 276 } },
    ];
    for (const c of cases) {
      const rig = makeRig({ ...c.seat, rig: 'ego' });
      for (let i = 0; i < 20; i++) rig.panBy(c.pan / 20, 0);
      const a = rig.screenToTableOrNull(c.s.x, c.s.y)!;
      expect(onTable(c.seat.table, a), c.seat.format).toBe(true);
      const { poses } = runSwitch(rig, 'birdseye', c.s, 10);
      for (const p of poses) expect(px(screenOf(p, c.seat.angle, a), c.s), `${c.seat.format} seat ${c.seat.seat}`).toBeLessThan(2);
      // The bird's-eye centre stays beyond the table edge to hold the point; the next pan never jumps and only brings
      // the view back toward the table.
      const v = rig.bird.view;
      expect(onTable(c.seat.table, { x: v.cx, y: v.cy }), c.seat.format).toBe(false);
      // A pan moves the table by at most the drag, never more (no jump); outward it stops, inward it follows the drag.
      const moved = (dx: number) => {
        const before = rig.tableToScreen(a);
        rig.panBy(dx, 0);
        const after = rig.tableToScreen(a);
        expect(Math.abs(after.y - before.y), c.seat.format).toBeLessThan(1e-6);
        return after.x - before.x;
      };
      const out = moved(c.pan > 0 ? 1 : -1);
      expect(Math.abs(out), c.seat.format).toBeLessThan(1e-6);
      expect(moved(c.pan > 0 ? -1 : 1), c.seat.format).toBeCloseTo(c.pan > 0 ? -1 : 1, 6);
      for (let i = 0; i < 400; i++) rig.panBy(c.pan > 0 ? -5 : 5, 0);
      for (let i = 0; i < 400; i++) rig.panBy(c.pan > 0 ? 5 : -5, 0);
      const w = rig.bird.view;
      expect(onTable(c.seat.table, { x: w.cx, y: w.cy }), c.seat.format).toBe(true);
    }
  });

  it('without a cursor the viewport centre is the anchor', () => {
    const rig = makeRig();
    const c = { x: VP.w / 2, y: VP.h / 2 };
    const a = rig.screenToTable(c.x, c.y);
    const { poses } = runSwitch(rig, 'ego', null);
    for (const p of poses) expect(px(screenOf(p, 0, a), c)).toBeLessThan(2);
  });

  it('the blend lasts the theme\'s camera blend time (400 ms) and reports its progress', () => {
    const rig = makeRig();
    rig.setRig('ego', 0, BLEND_MS, { x: 700, y: 400 });
    rig.step(0, 0);
    expect(rig.blendState()).toMatchObject({ from: 'birdseye', to: 'ego', t: 0, durationMs: 400 });
    rig.step(200, 200);
    expect(rig.blendState()!.t).toBeCloseTo(0.5, 9);
    rig.step(399, 199);
    expect(rig.blendState()).not.toBeNull();
    rig.step(400, 1);
    expect(rig.blendState()).toBeNull();
    expect(rig.moving).toBe(false);
  });

  it('switching back mid-blend is continuous: it blends back from where the camera is', () => {
    const rig = makeRig();
    const s = { x: 800, y: 500 };
    const a = rig.screenToTable(s.x, s.y);
    rig.setRig('ego', 0, BLEND_MS, s);
    rig.step(150, 150);
    const mid = rig.pose();
    rig.setRig('birdseye', 150, BLEND_MS, s);
    expect(rig.pose()).toEqual(mid);
    expect(rig.blendState()).toMatchObject({ from: 'ego', to: 'birdseye' });
    for (let t = 150; t <= 600; t += 10) {
      rig.step(t, 10);
      expect(px(rig.tableToScreen(a), s)).toBeLessThan(2);
    }
    expect(rig.rig()).toBe('birdseye');
  });

  it('a move that arrives mid-blend (seat key, fit, zoom to a card, follow) restarts the blend from where the camera is, without a jump', () => {
    const opponent = mtgLayout('1v1').seats[1]!.territory;
    const moves: { name: string; to: CameraRig; run: (rig: TableRig, now: number) => void }[] = [
      { name: 'seat key in ego', to: 'ego', run: (rig, now) => rig.goToRect(opponent, now, BLEND_MS) },
      { name: 'fit in ego', to: 'ego', run: (rig, now) => rig.fit(now, BLEND_MS) },
      { name: 'zoom to a card in ego', to: 'ego', run: (rig, now) => rig.focus({ x: -400, y: 300 }, 'close', now, BLEND_MS) },
      { name: 'seat key in bird\'s-eye', to: 'birdseye', run: (rig, now) => rig.goToRect(opponent, now, BLEND_MS) },
      { name: 'follow in bird\'s-eye', to: 'birdseye', run: (rig, now) => rig.focus({ x: 500, y: 400 }, 'keep', now, BLEND_MS) },
    ];
    for (const m of moves) {
      const rig = makeRig({ rig: m.to === 'ego' ? 'birdseye' : 'ego' });
      rig.setRig(m.to, 0, BLEND_MS, { x: 1200, y: 200 });
      rig.step(200, 200);
      const mid = rig.pose();
      m.run(rig, 200);
      // No jump at the moment the move arrives, nor on any frame after it.
      expect(rig.pose(), m.name).toEqual(mid);
      expect(rig.blendState(), m.name).toMatchObject({ to: m.to, t: 0 });
      let prev = mid;
      for (let t = 205; t <= 200 + BLEND_MS + 5; t += 5) {
        rig.step(t, 5);
        const p = rig.pose();
        const step = Math.hypot(p.position[0] - prev.position[0], p.position[1] - prev.position[1], p.position[2] - prev.position[2]);
        expect(step, `${m.name} at ${t} ms`).toBeLessThan(0.08 * Math.max(poseDist(p), poseDist(prev)));
        expect(Math.abs(p.pitchDeg - prev.pitchDeg), `${m.name} at ${t} ms`).toBeLessThan(2);
        prev = p;
      }
      // It ends at the move's destination.
      expect(rig.blendState(), m.name).toBeNull();
      expect(rig.pose(), m.name).toEqual(rig.restPose(m.to));
    }
  });

  it('with reduced motion a move mid-blend cuts to its destination', () => {
    const rig = makeRig();
    rig.setRig('ego', 0, BLEND_MS, { x: 1200, y: 200 });
    rig.step(200, 200);
    rig.fit(200, 0);
    expect(rig.blendState()).toBeNull();
    expect(rig.pose()).toEqual(rig.restPose('ego'));
  });

  it('with reduced motion (duration 0) the switch is a cut', () => {
    const rig = makeRig();
    const s = { x: 600, y: 420 };
    const a = rig.screenToTable(s.x, s.y);
    rig.setRig('ego', 0, 0, s);
    // Immediately, before any frame: no blend, the ego pose.
    expect(rig.blendState()).toBeNull();
    expect(rig.moving).toBe(false);
    expect(rig.rig()).toBe('ego');
    expect(rig.pose().fovDeg).toBe(45);
    expect(rig.pose()).toEqual(rig.restPose('ego'));
    // A cut still lands with the point under the cursor.
    expect(px(rig.tableToScreen(a), s)).toBeLessThan(2);
    rig.setRig('birdseye', 0, 0, s);
    expect(rig.blendState()).toBeNull();
    expect(rig.pose().fovDeg).toBe(6);
  });

  it('gestures wait while the rigs blend (the blend owns the camera)', () => {
    const rig = makeRig();
    rig.setRig('ego', 0, BLEND_MS, null);
    rig.step(100, 100);
    const p = rig.pose();
    rig.panBy(200, 100);
    rig.zoomAt(100, 100, 3);
    rig.pitchBy(10);
    rig.fling(5, 5);
    expect(rig.pose()).toEqual(p);
  });

  it('a tilted bird\'s-eye (Dusk) blends with the cursor point fixed as well', () => {
    const rig = makeRig({ tiltDeg: 10 });
    expect(rig.pose().pitchDeg).toBe(80);
    const s = { x: 720, y: 450 };
    const a = rig.screenToTable(s.x, s.y);
    const { poses } = runSwitch(rig, 'ego', s);
    for (const p of poses) expect(px(screenOf(p, 0, a), s)).toBeLessThan(2);
    const back = runSwitch(rig, 'birdseye', s);
    for (const p of back.poses) expect(px(screenOf(p, 0, a), s)).toBeLessThan(2);
    expect(rig.pose().pitchDeg).toBe(80);
  });

  it('returns to the bird\'s-eye zoom the viewer left', () => {
    const rig = makeRig();
    rig.zoomAt(720, 450, 2.5);
    const dist = rig.bird.view.dist;
    runSwitch(rig, 'ego', { x: 720, y: 450 });
    runSwitch(rig, 'birdseye', { x: 720, y: 450 });
    expect(rig.bird.view.dist).toBeCloseTo(dist, 6);
  });

  it('the camera stays above the table throughout a blend', () => {
    fc.assert(
      fc.property(anchors, fc.constantFrom(0, 90, 180, 270), (s, angle) => {
        const rig = makeRig({ angle });
        const there = runSwitch(rig, 'ego', s);
        const back = runSwitch(rig, 'birdseye', s);
        for (const p of [...there.poses, ...back.poses]) expect(p.position[2]).toBeGreaterThan(DEFAULT_EGO_RIG.minHeight - 1e-6);
      }),
      { numRuns: 100 },
    );
  });
});
