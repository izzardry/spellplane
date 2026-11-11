/**
 * Validation, quantisation and pile/attachment geometry for the reducer (DESIGN "Specification: geometry, layout
 * and motion"; "Specification: code interfaces", Reducer contract: pure and total).
 */
import { GEOMETRY } from '../geometry';
import type { Anchor, CardRef, PileRef, Pose } from '../types';

/** A reason an action does not apply; thrown inside the reducer and turned into `explain`'s result. */
export class Rejection extends Error {}

/** Refuse the action with `reason`. */
export function reject(reason: string): never {
  throw new Rejection(reason);
}

/** Own-property lookup, so ids such as 'constructor' never resolve to Object.prototype members. */
export function own<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** Largest table coordinate accepted, in mm (tables are at most 2200 wide; generous headroom). */
export const MAX_COORD = 100_000;
const MAX_ID = 128;

/**
 * Quantise to 0.01 (mm or degrees). Every stored pose goes through this, so a translation and its inverse land on
 * the very same double and undo restores the exact state hash.
 */
export function q(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Normalise an angle to [0, 360), quantised. */
export function normRot(r: number): number {
  let x = q(r) % 360;
  if (x < 0) x += 360;
  x = q(x);
  return x >= 360 ? 0 : x;
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A client-chosen id: non-empty string, at most 128 chars, never '__proto__'. */
export function checkId(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID || v === '__proto__') reject(`invalid ${what} id`);
  return v;
}

export function checkString(v: unknown, what: string, max = 2000): string {
  if (typeof v !== 'string' || v.length > max) reject(`invalid ${what}`);
  return v;
}

export function checkInt(v: unknown, what: string, min = -1e9, max = 1e9): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) reject(`${what} must be an integer between ${min} and ${max}`);
  return v;
}

export function checkFinite(v: unknown, what: string, limit: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) reject(`${what} must be a finite number within ±${limit}`);
  return v;
}

/** Validate and normalise a pose: quantised coordinates and rot in [0, 360). */
export function checkPose(v: unknown): Pose {
  if (!isObj(v)) reject('invalid pose');
  const x = checkFinite(v.x, 'pose.x', MAX_COORD);
  const y = checkFinite(v.y, 'pose.y', MAX_COORD);
  const rot = checkFinite(v.rot, 'pose.rot', 1e6);
  return { x: q(x), y: q(y), rot: normRot(rot) };
}

export function checkRef(v: unknown): CardRef {
  if (!isObj(v)) reject('invalid card ref');
  const sid = checkId(v.sid, 'scryfall');
  if (v.foil !== undefined && v.foil !== true) reject('invalid card ref foil flag');
  return v.foil === true ? { sid, foil: true } : { sid };
}

export function checkPileRef(v: unknown): PileRef {
  if (!isObj(v)) reject('invalid pile');
  const id = checkId(v.id, 'pile');
  const index = checkInt(v.index, 'pile index', 0, 1e6);
  if (v.kind !== 'cascade' && v.kind !== 'squared') reject('pile kind must be cascade or squared');
  return { id, index, kind: v.kind };
}

export function checkAnchor(v: unknown): Anchor {
  if (!isObj(v)) reject('invalid anchor');
  const id = checkId(v.id, 'anchor');
  if (v.kind !== 'card' && v.kind !== 'stackItem' && v.kind !== 'seat') reject('invalid anchor kind');
  return { kind: v.kind, id };
}

export function samePose(a: Pose, b: Pose): boolean {
  return a.x === b.x && a.y === b.y && a.rot === b.rot;
}

/** Radians per hundredth of a degree. */
const RAD_PER_CENTIDEGREE = Math.PI / 18000;

/**
 * Sine and cosine of a quantised angle, computed with plain IEEE arithmetic only (DESIGN "Data model and protocol":
 * shared state is identical in every browser). `Math.sin`/`Math.cos` are implementation-approximated and differ in
 * the last bit between engines, so the reducer never calls them. The angle (a multiple of 0.01°) is reduced exactly
 * in integer hundredths of a degree to [0°, 45°], where fixed Taylor polynomials are accurate to about 1e-16;
 * multiples of 90° are exact.
 */
function sinCos(deg: number): [number, number] {
  const k = Math.round(normRot(deg) * 100) % 36000; // integer hundredths of a degree, 0..35999
  const quadrant = Math.floor(k / 9000);
  let r = k - quadrant * 9000; // 0..8999
  const swap = r > 4500;
  if (swap) r = 9000 - r; // 0..4500, i.e. at most 45°
  const x = r * RAD_PER_CENTIDEGREE;
  const x2 = x * x;
  const sx =
    x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
  const cx =
    1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))));
  const s = r === 0 ? 0 : swap ? cx : sx;
  const c = r === 0 ? 1 : swap ? sx : cx;
  switch (quadrant) {
    case 0:
      return [s, c];
    case 1:
      return [c, s === 0 ? 0 : -s];
    case 2:
      return [s === 0 ? 0 : -s, -c];
    default:
      return [-c, s];
  }
}

/**
 * Card-local axes in the canonical frame for a card at `rot` degrees clockwise (DESIGN "Specification: geometry,
 * layout and motion": x right, y away from seat 0). `down` points toward the card's owner, `right` to its right.
 */
export function cardAxes(rot: number): { right: { x: number; y: number }; up: { x: number; y: number } } {
  const [s, c] = sinCos(rot);
  return { right: { x: c, y: -s }, up: { x: s, y: c } };
}

/** Pose of the member at `index` of a pile whose base sits at `anchor`: cascades step 14 mm toward the owner, squared piles stack in place. */
export function pileMemberPose(anchor: Pose, index: number, kind: PileRef['kind']): Pose {
  if (kind === 'squared' || index === 0) return { ...anchor };
  const { up } = cardAxes(anchor.rot);
  const d = index * GEOMETRY.cascadeOffset;
  return { x: q(anchor.x - up.x * d), y: q(anchor.y - up.y * d), rot: anchor.rot };
}

/** Pose of the `k`-th attachment (1-based) tucked behind a host: 10 sideways and 10 up per step, in the host's frame. */
export function tuckPose(host: Pose, k: number): Pose {
  const { right, up } = cardAxes(host.rot);
  const sx = GEOMETRY.attachTuck.x * k;
  const sy = GEOMETRY.attachTuck.y * k;
  return { x: q(host.x + right.x * sx + up.x * sy), y: q(host.y + right.y * sx + up.y * sy), rot: host.rot };
}

/** Lexicographic (UTF-16 code unit) order, as hidden zones and every deterministic iteration use. */
export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
