// The pure settled pose at a tilt (docs/design/m8/m7-adjustments.md, M7-P3: "an exported pure function
// `poseAt(tilt, layout, seat)` … returning position, look-at and field of view, which the landing's still uses";
// PLAN Milestone 8, M7-P1 Camera: "`poseAt` against the settled rig at five tilts for seats 0 to 3").
import { describe, expect, it } from 'vitest';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { POSE_VIEWPORT, poseAtTilt, seatAngle } from '../../../src/scene/camera/pose-at';
import { TableRig } from '../../../src/scene/camera/rig';
import { cameraTable } from '../../../src/scene/layout';
import type { CameraPose } from '../../../src/scene/types';

const TILTS = [0, 0.25, 0.5, 0.75, 1] as const;
const VP = { w: 1440, h: 900 };

/** A live rig as the table scene builds it, started bird's-eye and tilted to `t` by an eased move, stepped until it settles. */
function settledRig(layout: ReturnType<typeof mtgLayout>, seat: number, t: number): CameraPose {
  const angle = layout.seats[seat]!.angle;
  const rig = new TableRig({ table: cameraTable(layout, angle), viewport: VP, angle, inertiaMs: 260, tilt: 1 });
  rig.setTilt(t, 0, 400, null);
  let now = 0;
  for (let i = 0; i < 400 && (rig.tilt() !== rig.tiltTarget() || i < 2); i++) {
    now += 16;
    rig.step(now, 16);
  }
  // Settled: the spring stops within a thousandth of the target; let it finish.
  for (let i = 0; i < 200; i++) {
    now += 16;
    rig.step(now, 16);
  }
  return rig.pose();
}

describe('poseAtTilt(tilt, layout, seat)', () => {
  const layout = mtgLayout('ffa4');
  for (const seat of [0, 1, 2, 3])
    for (const t of TILTS)
      it(`equals the live rig's settled pose for seat ${seat} at tilt ${t}`, () => {
        const want = settledRig(layout, seat, t);
        // To the millimetre and a hundredth of a degree.
        const got = poseAtTilt(t, layout, `s${seat}`, VP);
        for (let i = 0; i < 3; i++) {
          expect(Math.abs(got.position[i]! - want.position[i]!), `position ${i}`).toBeLessThan(1);
          expect(Math.abs(got.target[i]! - want.target[i]!), `target ${i}`).toBeLessThan(1);
        }
        expect(Math.abs(got.fovDeg - want.fovDeg)).toBeLessThan(0.01);
        expect(Math.abs(got.pitchDeg - want.pitchDeg)).toBeLessThan(0.01);
      });

  it('is pure: the same inputs give the same pose', () => {
    expect(poseAtTilt(0.35, layout, 's2')).toEqual(poseAtTilt(0.35, layout, 's2'));
  });

  it('moves continuously and monotonically with the tilt: the camera rises, pitches down, and the field narrows', () => {
    const l = mtgLayout('1v1');
    let prev = poseAtTilt(0, l, 's0');
    for (let i = 1; i <= 50; i++) {
      const p = poseAtTilt(i / 50, l, 's0');
      expect(p.pitchDeg).toBeGreaterThanOrEqual(prev.pitchDeg);
      expect(p.fovDeg).toBeLessThanOrEqual(prev.fovDeg + 1e-9);
      expect(p.position[2]).toBeGreaterThanOrEqual(prev.position[2] - 1e-6);
      // No jump: a fiftieth of the tilt changes the camera height by under a fifth (the lens narrows fastest near bird's-eye).
      expect(Math.abs(p.position[2] - prev.position[2])).toBeLessThan(0.2 * Math.max(p.position[2], prev.position[2]));
      prev = p;
    }
    // The ends are first person (looking across, low) and bird's-eye (straight down).
    expect(poseAtTilt(0, l, 's0').pitchDeg).toBeLessThan(60);
    expect(poseAtTilt(1, l, 's0').pitchDeg).toBeCloseTo(90, 6);
  });

  it('looks at the table from the seat’s side; an unknown or absent seat is seat 0’s view; out-of-range tilts clamp', () => {
    const l = mtgLayout('1v1');
    expect(seatAngle(l, 's1')).toBe(l.seats[1]!.angle);
    expect(seatAngle(l, null)).toBe(l.seats[0]!.angle);
    expect(seatAngle(l, 's9')).toBe(l.seats[0]!.angle);
    // Seat 0 sits at the near edge (negative y): at first person the camera is on that side of its look-at.
    const p0 = poseAtTilt(0, l, 's0');
    expect(p0.position[1]).toBeLessThan(p0.target[1]);
    const p1 = poseAtTilt(0, l, 's1');
    expect(p1.position[1]).toBeGreaterThan(p1.target[1]);
    expect(poseAtTilt(-3, l, 's0')).toEqual(poseAtTilt(0, l, 's0'));
    expect(poseAtTilt(7, l, 's0')).toEqual(poseAtTilt(1, l, 's0'));
    expect(POSE_VIEWPORT.w / POSE_VIEWPORT.h).toBeCloseTo(16 / 9, 6);
  });
});
