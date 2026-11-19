// PLAN M7-P3, One continuous tilt: the table camera is one rig whose tilt moves continuously from first person (t = 0,
// "seated at your edge, looking across the table, your hand and battlefield large in front") to bird's-eye (t = 1,
// "straight down, whole table"), with eased spring motion, presets that snap softly, zoom and pan working at every
// tilt, and seat switching keeping the tilt. What M4-P1's two rigs guaranteed carries over to every tilt (DESIGN "Camera
// and navigation": the point under the cursor stays under the cursor while the view changes; the camera never goes below
// the table edge or behind the seat; zoom from the whole table plus 5% to one card at 80% of the viewport height;
// reduced motion cuts; "Specification: geometry, layout and motion", Camera rigs and Texture tiers).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CAMERA, GEOMETRY } from '../../../src/core/geometry';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { safeAreaOf } from '../../../src/scene/camera/birdseye';
import { projectPoint } from '../../../src/scene/camera/pose';
import { halfDepth, type TableRig } from '../../../src/scene/camera/rig';
import { tableCorners } from '../../../src/scene/camera/table';
import { forward } from '../../../src/scene/math';
import type { TiltEvent } from '../../../src/scene/types';
import { BLEND_MS, HUD, SEATS, VP, makeRig, onTable, px, runTilt, screenOf } from './helpers';

const CARD_H = GEOMETRY.card.h;
const MIN_HEIGHT = 120;
const unit = fc.noBias(fc.integer({ min: 0, max: 100_000 })).map((v) => v / 100_000);
const TILTS = [0, 0.25, 0.5, 0.75, 1];

/** How far behind the table centre the camera stands (along the viewer's forward axis). */
const backOf = (rig: TableRig) => {
  const f = forward(rig.angle);
  const p = rig.pose().position;
  return -(p[0] * f.x + p[1] * f.y);
};
/** The frame's corners (the fitted view must show them). */
const frameCorners = (rig: TableRig) => tableCorners({ w: rig.frame.w, d: rig.frame.d, ...(rig.frame.rot ? { rot: rig.frame.rot } : {}) }).map((p) => ({ x: p.x + rig.frame.x, y: p.y + rig.frame.y }));

describe('first person (t = 0): seated at your edge, looking across the table', () => {
  it('stands behind the viewer\'s own table edge, above the table, pitched 35° with a 45° field of view, for every seat of every format', () => {
    for (const s of SEATS) {
      const rig = makeRig({ ...s, tilt: 0 });
      const p = rig.pose();
      expect(p.pitchDeg, `${s.format} ${s.seat}`).toBe(35);
      expect(p.fovDeg).toBe(45);
      expect(p.position[2]).toBeGreaterThan(MIN_HEIGHT);
      // Behind the own edge, no further back than the seat.
      expect(backOf(rig), `${s.format} ${s.seat}`).toBeGreaterThan(halfDepth(s.table, s.angle));
      expect(backOf(rig)).toBeLessThanOrEqual(rig.seatBack() + 1e-6);
      expect(rig.rig()).toBe('ego');
      expect(rig.tilt()).toBe(0);
    }
  });

  it('a seat-0 viewer sees their side at the bottom, the far side at the top, and their own cards larger (perspective)', () => {
    const rig = makeRig({ tilt: 0 });
    const near = rig.tableToScreen({ x: 0, y: -400 });
    const far = rig.tableToScreen({ x: 0, y: 400 });
    expect(near.y).toBeGreaterThan(VP.h / 2);
    expect(far.y).toBeLessThan(VP.h / 2);
    expect(rig.pxPerMmAt({ x: 0, y: -400 })).toBeGreaterThan(1.3 * rig.pxPerMmAt({ x: 0, y: 400 }));
    // Straight down every table point shows at one scale.
    const bird = makeRig({ tilt: 1 });
    expect(bird.pxPerMmAt({ x: 0, y: -400 })).toBeCloseTo(bird.pxPerMmAt({ x: 300, y: 400 }), 9);
  });

  it('the old rig names map onto the ends: setRig(\'ego\') is first person, setRig(\'birdseye\') bird\'s-eye', () => {
    const rig = makeRig();
    expect(rig.rig()).toBe('birdseye');
    rig.setRig('ego', 0, 0, null);
    expect(rig.tilt()).toBe(0);
    expect(rig.rig()).toBe('ego');
    rig.setRig('birdseye', 0, 0, null);
    expect(rig.tilt()).toBe(1);
    expect(rig.pose().fovDeg).toBe(6);
    expect(rig.pose().pitchDeg).toBe(90);
  });
});

describe('the tilt keeps the table point under the cursor (no jump, no pop)', () => {
  it('fitted bird\'s-eye to first person and back: every cursor over the table moves less than 2 px at every frame, on every format and seat (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, unit, fc.constantFrom(0, 0.25, 0.5, 0.75), (s, fx, fy, to) => {
        const rig = makeRig({ ...s, tilt: 1, insets: HUD });
        const c = { x: 20 + fx * (VP.w - 40), y: HUD.top + fy * (VP.h - HUD.top - HUD.bottom) };
        const a = rig.screenToTableOrNull(c.x, c.y);
        if (!a || !onTable(s.table, a)) return;
        checked++;
        for (const target of [to, 1]) {
          const run = runTilt(rig, target, c);
          expect(run.settledAt).toBeLessThan(1000);
          for (const p of run.poses) {
            expect(px(screenOf(p, s.angle, a), c)).toBeLessThan(2);
            expect(p.position[2]).toBeGreaterThan(MIN_HEIGHT - 1e-6);
          }
          expect(rig.tilt()).toBe(target);
        }
      }),
      { numRuns: 300, seed: 7 },
    );
    expect(checked).toBeGreaterThan(150);
  });

  it('from a view the viewer panned, zoomed and tilted anywhere, a tilt to any other holds the cursor\'s point (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, unit, unit, unit, unit, unit, unit, (s, t0, t1, z, panX, panY, fx, fy) => {
        const rig = makeRig({ ...s, tilt: t0 });
        rig.zoomAt(VP.w / 2, VP.h / 2, 1 + 3 * z);
        rig.panBy((panX - 0.5) * 400, (panY - 0.5) * 300);
        const c = { x: 40 + fx * (VP.w - 80), y: 40 + fy * (VP.h - 80) };
        const a = rig.screenToTableOrNull(c.x, c.y);
        if (!a || !onTable(s.table, a)) return;
        // Within the limits a tilt never has to clamp: the guarantee covers views whose look-at stays on the table.
        checked++;
        const run = runTilt(rig, t1, c);
        let worst = 0;
        for (const p of run.poses) worst = Math.max(worst, px(screenOf(p, s.angle, a), c));
        // Held exactly unless the zoom had to shrink to keep the camera in front of the seat; even then no jump.
        expect(worst).toBeLessThan(2);
      }),
      { numRuns: 300, seed: 11 },
    );
    expect(checked).toBeGreaterThan(150);
  });

  it('without a cursor the view centre holds its table point', () => {
    const rig = makeRig({ tilt: 1 });
    rig.zoomAt(500, 300, 1.5);
    const c = { x: VP.w / 2, y: VP.h / 2 };
    const a = rig.screenToTable(c.x, c.y);
    for (const p of runTilt(rig, 0, null).poses) expect(px(screenOf(p, 0, a), c)).toBeLessThan(1e-6);
  });

  it('turning back mid-move carries on from where the camera is, with no jump, toward the new end', () => {
    const rig = makeRig({ tilt: 1 });
    const c = { x: 700, y: 420 };
    rig.setTilt(0, 0, BLEND_MS, c);
    for (let t = 16; t <= 160; t += 16) rig.step(t, 16);
    const mid = rig.tilt();
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    expect(rig.blendState()).toMatchObject({ from: 'birdseye', to: 'ego', durationMs: 400 });
    const before = rig.pose();
    rig.setTilt(1, 160, BLEND_MS, c);
    expect(rig.pose()).toEqual(before);
    expect(rig.blendState()).toMatchObject({ from: 'ego', to: 'birdseye' });
    const a = rig.screenToTable(c.x, c.y);
    let last = rig.pose();
    for (let t = 176; t < 2000 && rig.switching; t += 16) {
      rig.step(t, 16);
      const p = rig.pose();
      expect(px(screenOf(p, 0, a), c)).toBeLessThan(2);
      // Each frame moves the camera less than a tenth of the way between the ends.
      expect(Math.abs(p.pitchDeg - last.pitchDeg)).toBeLessThan(5.5);
      last = p;
    }
    expect(rig.tilt()).toBe(1);
  });

  it('a move arriving mid-tilt (fit, a seat key, zoom to a card) never jumps and lands at the new tilt', () => {
    const layout = mtgLayout('1v1');
    for (const move of ['fit', 'seat', 'focus'] as const) {
      const rig = makeRig({ tilt: 1 });
      rig.setTilt(0, 0, BLEND_MS, { x: 900, y: 300 });
      for (let t = 16; t <= 96; t += 16) rig.step(t, 16);
      const before = rig.pose();
      if (move === 'fit') rig.fit(96, BLEND_MS);
      else if (move === 'seat') rig.goToRect(layout.seats[1]!.territory, 96, BLEND_MS);
      else rig.focus({ x: 100, y: -200 }, 'close', 96, BLEND_MS);
      expect(rig.pose()).toEqual(before);
      let last = before;
      for (let t = 112; t < 3000 && rig.moving; t += 16) {
        rig.step(t, 16);
        const p = rig.pose();
        const step = Math.hypot(...p.target.map((v, i) => v - last.target[i]!));
        expect(step, move).toBeLessThan(200);
        last = p;
      }
      expect(rig.tilt()).toBe(0);
    }
  });

  it('with reduced motion (no time to move) the tilt is a cut, the cursor\'s point still held', () => {
    const rig = makeRig({ tilt: 1 });
    const c = { x: 800, y: 400 };
    const a = rig.screenToTable(c.x, c.y);
    rig.setTilt(0, 0, 0, c);
    expect(rig.switching).toBe(false);
    expect(rig.blendState()).toBeNull();
    expect(rig.tilt()).toBe(0);
    expect(px(rig.tableToScreen(a), c)).toBeLessThan(1e-6);
  });
});

describe('the camera never goes below the table edge or behind the seat, at any tilt, whatever the input', () => {
  type Op =
    | { k: 'pan'; dx: number; dy: number }
    | { k: 'zoom'; x: number; y: number; f: number }
    | { k: 'drag'; dy: number; x: number; y: number }
    | { k: 'wheel'; d: number }
    | { k: 'tilt'; t: number }
    | { k: 'fit' }
    | { k: 'focus'; x: number; y: number }
    | { k: 'fling'; vx: number; vy: number };
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ k: fc.constant('pan' as const), dx: fc.double({ min: -2000, max: 2000, noNaN: true }), dy: fc.double({ min: -2000, max: 2000, noNaN: true }) }),
    fc.record({ k: fc.constant('zoom' as const), x: fc.double({ min: 0, max: VP.w, noNaN: true }), y: fc.double({ min: 0, max: VP.h, noNaN: true }), f: fc.double({ min: 0.01, max: 100, noNaN: true }) }),
    fc.record({ k: fc.constant('drag' as const), dy: fc.double({ min: -1, max: 1, noNaN: true }), x: fc.double({ min: 0, max: VP.w, noNaN: true }), y: fc.double({ min: 0, max: VP.h, noNaN: true }) }),
    fc.record({ k: fc.constant('wheel' as const), d: fc.double({ min: -0.6, max: 0.6, noNaN: true }) }),
    fc.record({ k: fc.constant('tilt' as const), t: fc.double({ min: -0.5, max: 1.5, noNaN: true }) }),
    fc.record({ k: fc.constant('fit' as const) }),
    fc.record({ k: fc.constant('focus' as const), x: fc.double({ min: -1500, max: 1500, noNaN: true }), y: fc.double({ min: -1500, max: 1500, noNaN: true }) }),
    fc.record({ k: fc.constant('fling' as const), vx: fc.double({ min: -5, max: 5, noNaN: true }), vy: fc.double({ min: -5, max: 5, noNaN: true }) }),
  );

  it('any sequence of pans, zooms, tilt drags, wheel tilts, presets, fits and flings, on every seat (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, fc.array(op, { minLength: 1, maxLength: 14 }), fc.boolean(), (s, t0, ops, insets) => {
        const rig = makeRig({ ...s, tilt: t0, ...(insets ? { insets: HUD } : {}) });
        const seat = rig.seatBack();
        let now = 0;
        const check = (what: string) => {
          const p = rig.pose();
          expect(p.position[2], what).toBeGreaterThanOrEqual(MIN_HEIGHT - 1e-3);
          expect(backOf(rig), what).toBeLessThanOrEqual(seat + 1e-3);
          expect(p.pitchDeg).toBeGreaterThanOrEqual(35 - 1e-9);
          expect(p.pitchDeg).toBeLessThanOrEqual(90);
          expect(rig.tilt()).toBeGreaterThanOrEqual(0);
          expect(rig.tilt()).toBeLessThanOrEqual(1);
          // The table stays in sight: some of the screen shows it (the view centre may lie past an edge, e.g. beyond the
          // far edge in first person, or while a tilt holds a table point under a cursor near the screen's edge).
          let seen = false;
          for (let i = 0; i <= 6 && !seen; i++) {
            for (let j = 0; j <= 6 && !seen; j++) {
              const q = rig.screenToTableOrNull((VP.w * i) / 6, (VP.h * j) / 6);
              if (q && onTable(s.table, q)) seen = true;
            }
          }
          expect(seen, what).toBe(true);
          // Never closer than one card at 80% of the viewport height.
          expect(rig.view().half).toBeGreaterThanOrEqual(CARD_H / 0.8 / 2 - 1e-6);
        };
        for (const o of ops) {
          if (o.k === 'pan') rig.panBy(o.dx, o.dy);
          else if (o.k === 'zoom') rig.zoomAt(o.x, o.y, o.f);
          else if (o.k === 'drag') {
            rig.beginTiltDrag({ x: o.x, y: o.y }, 'drag');
            rig.tiltDragBy(o.dy);
            check('dragging');
            rig.endTiltDrag(now, BLEND_MS);
          } else if (o.k === 'wheel') rig.wheelTilt(o.d, now, BLEND_MS, { x: VP.w / 2, y: VP.h / 3 });
          else if (o.k === 'tilt') rig.setTilt(o.t, now, BLEND_MS, null);
          else if (o.k === 'fit') rig.fit(now, BLEND_MS);
          else if (o.k === 'focus') rig.focus(o, 'close', now, BLEND_MS);
          else rig.fling(o.vx, o.vy);
          check(o.k);
          for (let i = 0; i < 8; i++) {
            now += 37;
            rig.step(now, 37);
            check(`${o.k} +${i}`);
          }
        }
        for (let i = 0; i < 200 && rig.moving; i++) {
          now += 16;
          rig.step(now, 16);
        }
        check('settled');
        expect(rig.moving).toBe(false);
      }),
      { numRuns: 400, seed: 3 },
    );
  });

  it('wheeling all the way in stops at one card filling 80% of the viewport height (and above the minimum height in first person)', () => {
    for (const t of TILTS) {
      const rig = makeRig({ tilt: t });
      for (let i = 0; i < 40; i++) rig.zoomAt(720, 450, 2);
      const p = rig.pose();
      const cardPx = CARD_H * rig.pxPerMmAt({ x: p.target[0], y: p.target[1] });
      expect(cardPx, `t=${t}`).toBeLessThanOrEqual(0.8 * VP.h + 1e-6);
      expect(p.position[2]).toBeGreaterThanOrEqual(MIN_HEIGHT - 1e-6);
    }
  });
});

describe('zoom and pan keep working at every tilt', () => {
  it('wheel zoom keeps the table point under the cursor (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, unit, unit, fc.double({ min: 1.05, max: 2.5, noNaN: true }), fc.boolean(), (s, t, fx, fy, f, out) => {
        const rig = makeRig({ ...s, tilt: t });
        const c = { x: 80 + fx * (VP.w - 160), y: 80 + fy * (VP.h - 160) };
        if (out) rig.zoomAt(VP.w / 2, VP.h / 2, 3);
        const a = rig.screenToTableOrNull(c.x, c.y);
        if (!a || !onTable(s.table, a)) return;
        const before = rig.view().half;
        rig.zoomAt(c.x, c.y, f);
        const after = rig.view();
        // Within the limits (nothing clamped) the point holds exactly.
        if (Math.abs(after.half - before / f) > 1e-6 || !onTable(s.table, after)) return;
        checked++;
        expect(px(rig.tableToScreen(a), c)).toBeLessThan(1e-3);
      }),
      { numRuns: 400, seed: 2 },
    );
    expect(checked).toBeGreaterThan(100);
  });

  it('a drag pan moves the table with the pointer: the grabbed point stays under it (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, unit, unit, fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), (s, t, fx, fy, dx, dy) => {
        const rig = makeRig({ ...s, tilt: t });
        rig.zoomAt(VP.w / 2, VP.h / 2, 2.5);
        const from = { x: 200 + fx * (VP.w - 400), y: 200 + fy * (VP.h - 400) };
        const a = rig.screenToTableOrNull(from.x, from.y);
        if (!a) return;
        const half = rig.view().half;
        const to = { x: from.x + dx, y: from.y + dy };
        rig.panBy(dx, dy, to);
        if (rig.view().half !== half || !onTable(s.table, rig.view())) return;
        checked++;
        expect(px(rig.tableToScreen(a), to)).toBeLessThan(1e-3);
      }),
      { numRuns: 400, seed: 4 },
    );
    expect(checked).toBeGreaterThan(150);
  });

  it('pan inertia decays and stops at every tilt', () => {
    for (const t of TILTS) {
      const rig = makeRig({ tilt: t });
      rig.zoomAt(720, 450, 3);
      rig.fling(0.8, -0.4);
      expect(rig.moving).toBe(true);
      let now = 0;
      let n = 0;
      while (rig.moving && n < 500) {
        now += 16;
        rig.step(now, 16);
        n++;
      }
      expect(rig.moving, `t=${t}`).toBe(false);
      expect(n).toBeGreaterThan(5);
    }
  });

  it('table points project and unproject consistently at every tilt (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, unit, unit, (s, t, fx, fy) => {
        const rig = makeRig({ ...s, tilt: t });
        const q = rig.screenToTableOrNull(fx * VP.w, fy * VP.h);
        if (!q) return;
        expect(px(rig.tableToScreen(q), { x: fx * VP.w, y: fy * VP.h })).toBeLessThan(1e-6);
      }),
    );
  });
});

describe('fit (key 0): the whole table at every tilt', () => {
  it('shows the whole frame inside the HUD\'s free area with a 5% margin, centred, on every seat at every tilt', () => {
    for (const s of SEATS) {
      for (const t of [...TILTS, 0.1, 0.9]) {
        const rig = makeRig({ ...s, tilt: t, insets: HUD });
        const safe = safeAreaOf(VP, HUD);
        const pts = frameCorners(rig).map((p) => rig.tableToScreen(p));
        const x0 = Math.min(...pts.map((p) => p.x));
        const x1 = Math.max(...pts.map((p) => p.x));
        const y0 = Math.min(...pts.map((p) => p.y));
        const y1 = Math.max(...pts.map((p) => p.y));
        const label = `${s.format} ${s.seat} t=${t}`;
        expect(x0, label).toBeGreaterThanOrEqual(safe.x - 1e-3);
        expect(x1, label).toBeLessThanOrEqual(safe.x + safe.w + 1e-3);
        expect(y0, label).toBeGreaterThanOrEqual(safe.y - 1e-3);
        expect(y1, label).toBeLessThanOrEqual(safe.y + safe.h + 1e-3);
        // Tight: one direction fills the free area less the 5% margin (or nearly, once the own side slid down).
        const fill = Math.max(((x1 - x0) * 1.05) / safe.w, ((y1 - y0) * 1.05) / safe.h);
        expect(fill, label).toBeLessThanOrEqual(1 + 1e-6);
        expect(fill, label).toBeGreaterThan(0.95);
        expect((x0 + x1) / 2, label).toBeCloseTo(safe.x + safe.w / 2, 0);
        // Straight down it is centred; tilted, the own side may sit lower (never higher).
        if (t === 1) expect((y0 + y1) / 2).toBeCloseTo(safe.y + safe.h / 2, 3);
        else expect((y0 + y1) / 2, label).toBeGreaterThanOrEqual(safe.y + safe.h / 2 - 2);
      }
    }
  });

  it('straight down it is the bird\'s-eye fit of DESIGN: the frame with a 5% margin, centred in the free area', () => {
    const rig = makeRig({ tilt: 1, insets: HUD });
    const safe = safeAreaOf(VP, HUD);
    const k = Math.min(safe.h / (1100 * 1.05), safe.w / (1400 * 1.05));
    expect(rig.pxPerMm()).toBeCloseTo(k, 9);
    const c = rig.tableToScreen({ x: 0, y: 0 });
    expect(c.x).toBeCloseTo(safe.x + safe.w / 2, 6);
    expect(c.y).toBeCloseTo(safe.y + safe.h / 2, 6);
  });

  it('zooming out stops at the fitted view of the tilt the camera is at', () => {
    for (const t of TILTS) {
      const rig = makeRig({ tilt: t });
      const fit = rig.view().half;
      rig.zoomAt(720, 450, 0.01);
      expect(rig.view().half, `t=${t}`).toBeLessThanOrEqual(fit + 1e-6);
    }
  });

  it('a fitted view tilted without an anchor (the HUD handle) stays fitted: the whole table in sight at every frame', () => {
    const rig = makeRig({ tilt: 1, insets: HUD });
    const run = runTilt(rig, 0, null, 16);
    for (let i = 0; i < run.poses.length; i++) {
      for (const p of frameCorners(rig)) {
        const s = screenOf(run.poses[i]!, 0, p);
        expect(s.x).toBeGreaterThan(-1);
        expect(s.x).toBeLessThan(VP.w + 1);
        expect(s.y).toBeGreaterThan(HUD.top - 1);
        expect(s.y).toBeLessThan(VP.h - HUD.bottom + 1);
      }
    }
    expect(rig.isFitted()).toBe(true);
  });

  it('the HUD or the window changing refits a fitted view and leaves a navigated one where it is', () => {
    for (const t of TILTS) {
      const fitted = makeRig({ tilt: t });
      fitted.setInsets(HUD);
      const fresh = makeRig({ tilt: t, insets: HUD });
      expect(fitted.view().half).toBeCloseTo(fresh.view().half, 6);
      const moved = makeRig({ tilt: t });
      moved.zoomAt(500, 400, 1.6);
      moved.panBy(40, -30);
      const before = moved.pose();
      moved.setInsets(HUD);
      moved.resize({ w: 1194, h: 834 });
      moved.resize(VP);
      expect(moved.pose()).toEqual(before);
    }
  });
});

describe('seat switching keeps the tilt', () => {
  it('a new seat or table starts at the fitted view of the same tilt; a tilt move lands on its target', () => {
    for (const t of TILTS) {
      const rig = makeRig({ tilt: t });
      rig.zoomAt(300, 300, 2);
      rig.setTable({ w: 1800, d: 1800 }, 90, { x: 0, y: 0, w: 1800, d: 1800 });
      expect(rig.tilt()).toBe(t);
      expect(rig.isFitted()).toBe(true);
      expect(rig.pose().pitchDeg).toBeCloseTo(35 + 55 * t, 9);
    }
    const rig = makeRig({ tilt: 1 });
    rig.setTilt(0.5, 0, BLEND_MS, null);
    rig.step(50, 50);
    rig.setTable({ w: 1800, d: 1800 }, 180, { x: 0, y: 0, w: 1800, d: 1800 });
    expect(rig.tilt()).toBe(0.5);
    expect(rig.switching).toBe(false);
  });
});

describe('direct tilt (drag, two-finger swipe) and the wheel', () => {
  it('a drag follows the input with no lag, holding the pressed point; released near a preset it eases onto it', () => {
    const rig = makeRig({ tilt: 1 });
    const c = { x: 600, y: 500 };
    const a = rig.screenToTable(c.x, c.y);
    rig.beginTiltDrag(c, 'drag');
    rig.tiltDragBy(-0.3);
    expect(rig.tilt()).toBeCloseTo(0.7, 12);
    expect(px(rig.tableToScreen(a), c)).toBeLessThan(1e-6);
    rig.tiltDragBy(-0.24);
    expect(rig.tilt()).toBeCloseTo(0.46, 12);
    rig.endTiltDrag(0, BLEND_MS);
    // 0.46 is near the middle preset: it eases there.
    expect(rig.switching).toBe(true);
    for (let t = 16; t < 2000 && rig.switching; t += 16) {
      rig.step(t, 16);
      expect(px(rig.tableToScreen(a), c)).toBeLessThan(2);
    }
    expect(rig.tilt()).toBe(0.5);
  });

  it('released away from every preset it stays where the viewer left it', () => {
    const rig = makeRig({ tilt: 0 });
    rig.beginTiltDrag(null, 'touch');
    rig.tiltDragBy(0.27);
    rig.endTiltDrag(0, BLEND_MS);
    expect(rig.switching).toBe(false);
    expect(rig.tilt()).toBeCloseTo(0.27, 12);
  });

  it('a drag past either end stops there (no tilt below first person, none past straight down)', () => {
    const rig = makeRig({ tilt: 0.5 });
    rig.beginTiltDrag(null, 'drag');
    rig.tiltDragBy(5);
    expect(rig.tilt()).toBe(1);
    rig.tiltDragBy(-9);
    expect(rig.tilt()).toBe(0);
    rig.endTiltDrag(0, BLEND_MS);
    expect(rig.tilt()).toBe(0);
  });

  it('wheel steps accumulate on the target; once the wheel rests a target near a preset snaps to it', () => {
    const rig = makeRig({ tilt: 1 });
    rig.wheelTilt(-0.2, 0, BLEND_MS, null);
    rig.wheelTilt(-0.2, 30, BLEND_MS, null);
    rig.wheelTilt(-0.15, 60, BLEND_MS, null);
    expect(rig.tiltTarget()).toBeCloseTo(0.45, 12);
    let now = 60;
    while (now < 3000 && rig.moving) {
      now += 16;
      rig.step(now, 16);
    }
    expect(rig.tilt()).toBe(0.5);
  });

  it('the old pitch control moves the tilt by the matching share of its range, at once', () => {
    const rig = makeRig({ tilt: 0 });
    rig.pitchBy(55 / 4);
    expect(rig.tilt()).toBeCloseTo(0.25, 12);
    expect(rig.pose().pitchDeg).toBeCloseTo(35 + 55 / 4, 9);
    rig.pitchBy(-1000);
    expect(rig.tilt()).toBe(0);
  });
});

describe('tilt events (SceneEvents.tilt): start, change and end, never per frame', () => {
  const record = (rig: TableRig) => {
    const events: TiltEvent[] = [];
    rig.onTilt = (e) => events.push(e);
    return events;
  };
  const settle = (rig: TableRig, from = 0) => {
    let now = from;
    while (now < from + 5000 && rig.moving) {
      now += 16;
      rig.step(now, 16);
    }
    return now;
  };

  it('a preset move: start when it begins, end when it settles, nothing in between', () => {
    const rig = makeRig({ tilt: 1 });
    const events = record(rig);
    rig.setTilt(0, 0, BLEND_MS, null, 'preset');
    settle(rig);
    expect(events.map((e) => e.phase)).toEqual(['start', 'end']);
    expect(events[0]).toMatchObject({ tilt: 1, target: 0, source: 'preset' });
    expect(events[1]).toMatchObject({ tilt: 0, target: 0, source: 'preset' });
  });

  it('a new target mid-move is a change; a cut is a start and an end at once', () => {
    const rig = makeRig({ tilt: 1 });
    const events = record(rig);
    rig.setTilt(0, 0, BLEND_MS, null, 'key');
    rig.step(50, 50);
    rig.setTilt(0.5, 50, BLEND_MS, null, 'key');
    settle(rig, 50);
    expect(events.map((e) => e.phase)).toEqual(['start', 'change', 'end']);
    events.length = 0;
    rig.setTilt(1, 0, 0, null, 'key');
    expect(events.map((e) => e.phase)).toEqual(['start', 'end']);
  });

  it('a drag reports its start and, after the release (and a snap), its end; the wheel ends once it rests', () => {
    const rig = makeRig({ tilt: 1 });
    const events = record(rig);
    rig.beginTiltDrag(null, 'drag');
    for (let i = 0; i < 30; i++) rig.tiltDragBy(-0.018);
    rig.endTiltDrag(0, BLEND_MS);
    settle(rig);
    expect(events.map((e) => e.phase)).toEqual(['start', 'change', 'end']);
    expect(events.at(-1)).toMatchObject({ tilt: 0.5, source: 'drag' });
    events.length = 0;
    rig.wheelTilt(-0.3, 0, BLEND_MS, null);
    rig.wheelTilt(-0.3, 20, BLEND_MS, null);
    settle(rig, 20);
    expect(events.map((e) => e.phase)).toEqual(['start', 'change', 'end']);
    expect(events.at(-1)!.source).toBe('wheel');
  });

  it('asking for the tilt the camera is at reports nothing', () => {
    const rig = makeRig({ tilt: 1 });
    const events = record(rig);
    rig.setTilt(1, 0, BLEND_MS, null);
    rig.setRig('birdseye', 0, BLEND_MS, null);
    expect(events).toEqual([]);
  });
});

describe('a card\'s on-screen height (texture tiers) and picking at a card\'s height', () => {
  it('straight down it is the card\'s height times the scale, whatever its rotation', () => {
    const rig = makeRig({ tilt: 1 });
    rig.zoomAt(720, 450, 3);
    for (const rot of [0, 33, 90, 180, 270]) {
      const p = { x: 120, y: -80, rot };
      expect(rig.cardScreenHeight(p)).toBeCloseTo(CARD_H * rig.pxPerMmAt(p), 1);
      expect(rig.cardScreenHeight(p, 0, 0.5)).toBeCloseTo(0.5 * CARD_H * rig.pxPerMmAt(p), 1);
    }
  });

  it('tilted, a card lying flat facing the viewer shows shorter than its scale times its height (foreshortening), less so the higher the tilt', () => {
    let last = 0;
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const rig = makeRig({ tilt: t });
      const p = { x: 0, y: -100, rot: 0 };
      const ratio = rig.cardScreenHeight(p) / (CARD_H * rig.pxPerMmAt(p));
      expect(ratio, `t=${t}`).toBeLessThan(0.99);
      expect(ratio).toBeGreaterThan(last);
      last = ratio;
      const near = rig.tableToScreen({ x: 0, y: -100 - CARD_H / 2 });
      const far = rig.tableToScreen({ x: 0, y: -100 + CARD_H / 2 });
      expect(rig.cardScreenHeight(p)).toBeCloseTo(px(near, far), 6);
    }
  });

  it('is 0 for a card behind the camera', () => {
    const rig = makeRig({ tilt: 0 });
    expect(rig.cardScreenHeight({ x: 0, y: -4000, rot: 0 })).toBe(0);
  });

  it('the ray through a screen point crosses a raised plane where that plane\'s point shows, at every tilt (property)', () => {
    fc.assert(
      fc.property(unit, fc.double({ min: 50, max: VP.w - 50, noNaN: true }), fc.double({ min: 50, max: VP.h - 50, noNaN: true }), fc.double({ min: 0, max: 40, noNaN: true }), (t, x, y, z) => {
        const rig = makeRig({ tilt: t });
        const q = rig.screenToPlane(x, y, z);
        if (!q) return;
        expect(px(rig.tableToScreen(q, z), { x, y })).toBeLessThan(1e-6);
      }),
      { numRuns: 200 },
    );
  });

  it('in first person the top of a 20 mm pile shows well beyond its footprint', () => {
    const rig = makeRig({ tilt: 0 });
    const s = rig.tableToScreen({ x: 0, y: 0 }, 20);
    const onTableHit = rig.screenToTableOrNull(s.x, s.y)!;
    const onTop = rig.screenToPlane(s.x, s.y, 20)!;
    expect(Math.hypot(onTop.x, onTop.y)).toBeLessThan(1e-6);
    expect(onTableHit.y).toBeGreaterThan(15);
  });
});

describe('clip planes: no clipping into the table at any tilt', () => {
  it('keep every table point the view shows, at every height a card is drawn at, between near and far (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEATS), unit, unit, unit, unit, unit, fc.double({ min: 0, max: 4 * GEOMETRY.dragLift, noNaN: true }), (s, t, zoom, fx, fy, pan, z) => {
        const rig = makeRig({ ...s, tilt: t });
        rig.zoomAt(VP.w / 2, VP.h / 2, 1 + 10 * zoom);
        rig.panBy(0, (pan - 0.5) * 600);
        const pose = rig.pose();
        const q = rig.screenToPlane(fx * VP.w, fy * VP.h, z);
        if (!q || !onTable(s.table, q)) return;
        const { near, far } = rig.clipPlanes();
        const d = projectPoint(pose, s.angle, VP, [q.x, q.y, z]).depth;
        expect(d).toBeGreaterThan(near);
        expect(d).toBeLessThan(far);
      }),
      { numRuns: 500 },
    );
  });

  it('zoomed close in first person, near stays tens of millimetres away (not 1 mm), for depth precision', () => {
    for (const s of SEATS) {
      const rig = makeRig({ ...s, tilt: 0 });
      for (let i = 0; i < 20; i++) rig.zoomAt(VP.w / 2, VP.h / 2, 2);
      const { near, far } = rig.clipPlanes();
      expect(near, `${s.format} seat ${s.seat}`).toBeGreaterThan(20);
      expect(far / near, `${s.format} seat ${s.seat}`).toBeLessThan(2000);
    }
  });

  it('bird\'s-eye: near and far bracket the table closely', () => {
    const rig = makeRig({ tilt: 1 });
    const { near, far } = rig.clipPlanes();
    const dist = rig.centre().dist;
    expect(near).toBeGreaterThan(dist / 3);
    expect(far).toBeGreaterThan(dist);
    expect(far).toBeLessThan(dist + 1000);
  });

  it('the theme\'s first-person lens and seat apply, and a tilted bird\'s-eye (Dusk) ends 10° from straight down', () => {
    const rig = makeRig({ tilt: 0 });
    rig.setTheme({ fovDeg: 50, pitchDeg: 30 }, 10);
    expect(rig.pose().fovDeg).toBe(50);
    expect(rig.pose().pitchDeg).toBe(30);
    rig.setTilt(1, 0, 0, null);
    expect(rig.pose().pitchDeg).toBe(80);
    expect(rig.pose().fovDeg).toBe(CAMERA.birdseye.fovDeg);
  });
});
