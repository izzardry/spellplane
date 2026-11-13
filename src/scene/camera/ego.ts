/**
 * The ego camera rig (DESIGN "Camera and navigation", Ego perspective; "Specification: geometry, layout and motion",
 * Camera rigs): a perspective camera at the viewer's seat, pitched 35° below horizontal, with lean, dolly and pitch
 * within limits; never below the table edge or behind the seat. M4-P1. Pure maths; the stateful rig is
 * scene/camera/rig.ts.
 *
 * The seat stands `behindEdge` behind the viewer's table edge, centred on the viewer's territory (`lateral`, along the
 * viewer's right axis), `height` above the table. Lean moves the camera sideways, dolly along its view ray toward the
 * table (never backward, never below `minHeight`), pitch tilts it in place between the limits.
 */
import { DEG, clamp, forward } from '../math';
import type { CameraPose, EgoRigParams, ScreenPoint, TablePoint, Vec3 } from '../types';
import { add, basis, len, posePxPerMm, projectPoint, sub, unprojectToTable, type Viewport } from './pose';

/** Where the viewer has leaned, dollied and pitched the ego rig (DESIGN "Camera and navigation", Navigation gestures). Added by M4-C. */
export interface EgoNav {
  /** Sideways lean in mm, within ±EgoRigParams.leanMm. */
  lean: number;
  /** Dolly forward in mm, 0..EgoRigParams.maxDollyMm. */
  dolly: number;
  /** Pitch below horizontal in degrees, within the rig's limits. */
  pitchDeg: number;
}

export type TableSize = { w: number; d: number };

/** The ego rig at the seat: no lean, no dolly, the default pitch. */
export function defaultEgoNav(params: EgoRigParams): EgoNav {
  return clampEgoNav(params, { lean: 0, dolly: 0, pitchDeg: params.pitchDeg });
}

/** Half the table's extent along the viewer's forward axis (the distance from the centre to the viewer's edge). */
export function halfDepth(table: TableSize, angleDeg: number): number {
  const f = forward(angleDeg);
  return (Math.abs(f.x) * table.w + Math.abs(f.y) * table.d) / 2;
}

/** Half the table's extent along the viewer's right axis. */
export function halfWidth(table: TableSize, angleDeg: number): number {
  const f = forward(angleDeg);
  return (Math.abs(f.y) * table.w + Math.abs(f.x) * table.d) / 2;
}

/**
 * The rig's parameters for one table and seat, with the lean limit widened to reach the far side edge of the table
 * from the seat (half the table's width along the viewer's right axis plus the seat's own offset), so that a switch
 * from bird's-eye can keep any table point under the cursor (DESIGN "Camera and navigation", Switching; DECISIONS
 * [M4-P1]). A theme's larger lean is kept.
 */
export function egoLimitsFor(params: EgoRigParams, table: TableSize, angleDeg: number, lateral = 0): EgoRigParams {
  const reach = halfWidth(table, angleDeg) + Math.abs(lateral);
  return { ...params, leanMm: Math.max(Math.abs(params.leanMm), reach) };
}

/** The seat's eye point: `behindEdge` behind the viewer's edge, `lateral` mm to the viewer's right, `height` up. */
export function egoSeat(params: EgoRigParams, table: TableSize, angleDeg: number, lateral = 0): Vec3 {
  const f = forward(angleDeg);
  const back = halfDepth(table, angleDeg) + params.behindEdge;
  return [-f.x * back + f.y * lateral, -f.y * back - f.x * lateral, params.height];
}

/** The largest dolly at a pitch: the rig's limit, and never below the minimum height. */
export function maxDollyAt(params: EgoRigParams, pitchDeg: number): number {
  const s = Math.sin(pitchDeg * DEG);
  const byHeight = s > 1e-9 ? (params.height - params.minHeight) / s : Infinity;
  return Math.max(0, Math.min(params.maxDollyMm, byHeight));
}

/**
 * Pitch bounds no ego pose ever leaves, a rig switch's landing pose included: the camera always looks down at the table
 * and never straight down (bird's-eye is the rig for that). The rig's own limits (25°..60°) lie inside.
 */
export const EGO_PITCH_HARD = { min: 5, max: 85 } as const;

/**
 * The rig's limits grown to include navigation `n`, value by value (lean, dolly, pitch), never past EGO_PITCH_HARD or
 * the minimum height. A switch from bird's-eye may land beyond the limits to keep the cursor's table point under the
 * cursor; clamping later gestures to the limits grown to the current navigation lets them keep it there or bring it
 * back toward the limits, never push it further out and never jump (DECISIONS [M4-P1 review]).
 */
export function egoLimitsWith(params: EgoRigParams, n: EgoNav): EgoRigParams {
  const lo = Math.min(params.minPitchDeg, params.maxPitchDeg);
  const hi = Math.max(params.minPitchDeg, params.maxPitchDeg);
  const pitch = Number.isFinite(n.pitchDeg) ? clamp(n.pitchDeg, EGO_PITCH_HARD.min, EGO_PITCH_HARD.max) : params.pitchDeg;
  return {
    ...params,
    minPitchDeg: Math.min(lo, pitch),
    maxPitchDeg: Math.max(hi, pitch),
    leanMm: Math.max(Math.abs(params.leanMm), Number.isFinite(n.lean) ? Math.abs(n.lean) : 0),
    maxDollyMm: Math.max(params.maxDollyMm, Number.isFinite(n.dolly) ? n.dolly : 0),
  };
}

/**
 * How far a switch to ego may reach beyond the rig's limits, tried in order when the limits cannot hold the cursor's
 * table point: first the pitch alone (EGO_PITCH_HARD), then also the lean and the dolly (times the factor). The minimum
 * height and "never behind the seat" (dolly ≥ 0) always hold.
 */
const SWITCH_REACH = [
  { pitch: true, lean: 1, dolly: 1 },
  { pitch: true, lean: 2, dolly: 2 },
] as const;

/** Clamp a navigation to the rig's limits (lean, pitch, dolly never backward and never below the minimum height). */
export function clampEgoNav(params: EgoRigParams, nav: EgoNav): EgoNav {
  const lo = Math.min(params.minPitchDeg, params.maxPitchDeg);
  const hi = Math.max(params.minPitchDeg, params.maxPitchDeg);
  const pitchDeg = clamp(Number.isFinite(nav.pitchDeg) ? nav.pitchDeg : params.pitchDeg, lo, hi);
  const lean = clamp(Number.isFinite(nav.lean) ? nav.lean : 0, -Math.abs(params.leanMm), Math.abs(params.leanMm));
  const dolly = clamp(Number.isFinite(nav.dolly) ? nav.dolly : 0, 0, maxDollyAt(params, pitchDeg));
  return { lean, dolly, pitchDeg };
}

/** The ego camera's pose for a table and viewer seat angle (DESIGN "Specification: geometry", Camera rigs). */
export function egoPose(params: EgoRigParams, table: TableSize, viewerAngleDeg: number, nav: EgoNav, lateral = 0): CameraPose {
  const n = clampEgoNav(params, nav);
  const b = basis(viewerAngleDeg, n.pitchDeg);
  const c = add(add(egoSeat(params, table, viewerAngleDeg, lateral), b.r, n.lean), b.d, n.dolly);
  // The target is where the view ray meets the table (pitch ≥ the lower limit, so it always does).
  const k = c[2] / Math.max(1e-9, -b.d[2]);
  return { position: c, target: [c[0] + b.d[0] * k, c[1] + b.d[1] * k, 0], fovDeg: params.fovDeg, pitchDeg: n.pitchDeg };
}

/**
 * "Fit whole table" in the ego rig (key 0): back at the seat, centred, pitched so the viewer's near and far table
 * edges sit symmetrically about the view centre (clamped to the pitch limits) (DECISIONS [M4-P1]).
 */
export function egoFitNav(params: EgoRigParams, table: TableSize, angleDeg: number): EgoNav {
  const near = Math.atan2(params.height, params.behindEdge) / DEG;
  const far = Math.atan2(params.height, params.behindEdge + 2 * halfDepth(table, angleDeg)) / DEG;
  return clampEgoNav(params, { lean: 0, dolly: 0, pitchDeg: (near + far) / 2 });
}

/**
 * Aim the ego rig at table point `p` from `dist` mm away (go to a seat's territory, zoom to a card, follow): lean
 * toward it, pitch so the view ray from the seat passes through it, dolly along that ray to the distance; all clamped,
 * so a point the limits cannot centre ends as near the centre as they allow.
 */
export function egoAimNav(params: EgoRigParams, table: TableSize, angleDeg: number, lateral: number, p: TablePoint, dist: number): EgoNav {
  const seat = egoSeat(params, table, angleDeg, lateral);
  const f = forward(angleDeg);
  const v: Vec3 = [p.x - seat[0], p.y - seat[1], 0];
  const ahead = v[0] * f.x + v[1] * f.y;
  const lean = v[0] * f.y - v[1] * f.x;
  const pitchDeg = Math.atan2(params.height, Math.max(1e-6, ahead)) / DEG;
  const reach = Math.hypot(Math.max(0, ahead), params.height);
  return clampEgoNav(params, { lean, dolly: reach - dist, pitchDeg });
}

/** Distance at which a box of `w` × `d` mm (viewer's frame) fills the ego view with a 5% margin. */
export function egoFrameDist(params: EgoRigParams, vp: Viewport, w: number, d: number, margin = 0.05): number {
  const tanH = Math.tan((params.fovDeg / 2) * DEG);
  const aspect = vp.w / Math.max(1, vp.h);
  return Math.max(d / 2 / tanH, w / 2 / (tanH * aspect)) * (1 + margin);
}

type Unknowns = 'leanPitch' | 'leanDolly';

/**
 * Solve two of the navigation's three values so table point `a` shows at screen point `s` (Newton's method with a
 * numeric Jacobian; each step is clamped to the limits). Returns the clamped navigation with the smallest error.
 */
function solveNav(params: EgoRigParams, table: TableSize, angleDeg: number, lateral: number, vp: Viewport, a: TablePoint, s: ScreenPoint, start: EgoNav, unknowns: Unknowns): { nav: EgoNav; err: number } {
  const target: Vec3 = [a.x, a.y, 0];
  const residual = (n: EgoNav): [number, number] | null => {
    const q = projectPoint(egoPose(params, table, angleDeg, n, lateral), angleDeg, vp, target);
    return Number.isFinite(q.x) && Number.isFinite(q.y) ? [q.x - s.x, q.y - s.y] : null;
  };
  const make = (n: EgoNav, x: number, y: number): EgoNav => clampEgoNav(params, unknowns === 'leanPitch' ? { lean: x, pitchDeg: y, dolly: n.dolly } : { lean: x, dolly: y, pitchDeg: n.pitchDeg });
  const second = (n: EgoNav) => (unknowns === 'leanPitch' ? n.pitchDeg : n.dolly);
  const h2 = unknowns === 'leanPitch' ? 0.01 : 0.5;
  let nav = clampEgoNav(params, start);
  let r = residual(nav);
  let best = { nav, err: r ? Math.hypot(r[0], r[1]) : Infinity };
  for (let i = 0; i < 24 && r && best.err > 1e-4; i++) {
    const x = nav.lean;
    const y = second(nav);
    // Central differences on the unclamped values (the clamp is applied to the step, not to the derivative).
    const at = (dx: number, dy: number) => residual(unknowns === 'leanPitch' ? { lean: x + dx, pitchDeg: y + dy, dolly: nav.dolly } : { lean: x + dx, dolly: y + dy, pitchDeg: nav.pitchDeg });
    const rxp = at(0.5, 0);
    const rxm = at(-0.5, 0);
    const ryp = at(0, h2);
    const rym = at(0, -h2);
    if (!rxp || !rxm || !ryp || !rym) break;
    const j11 = (rxp[0] - rxm[0]) / 1;
    const j21 = (rxp[1] - rxm[1]) / 1;
    const j12 = (ryp[0] - rym[0]) / (2 * h2);
    const j22 = (ryp[1] - rym[1]) / (2 * h2);
    const det = j11 * j22 - j12 * j21;
    if (!(Math.abs(det) > 1e-12)) break;
    const dx = (-r[0] * j22 + r[1] * j12) / det;
    const dy = (-r[1] * j11 + r[0] * j21) / det;
    const next = make(nav, x + dx, y + dy);
    const rn = residual(next);
    if (!rn) break;
    const err = Math.hypot(rn[0], rn[1]);
    if (err < best.err) best = { nav: next, err };
    // Stuck against a limit: no further progress.
    if (next.lean === nav.lean && second(next) === second(nav)) break;
    nav = next;
    r = rn;
  }
  return best;
}

/** An anchor solve within this many px counts as holding the point (the blend's guarantee is 2 px). */
const ANCHOR_TOL_PX = 0.05;
/** Dolly samples of the anchor solve's search between the seat and the rig's dolly limit. */
const ANCHOR_DOLLY_STEPS = 28;

/**
 * The ego navigation that shows table point `a` at screen point `s` (switching rigs: "the point under the cursor
 * stays under the cursor"). Two equations, three unknowns (lean, dolly, pitch): the solve prefers the seat and moves
 * forward only as far as it must. At each dolly from the seat (`dolly`, normally 0) up to the rig's limit it solves
 * lean and pitch, then lean and dolly at the pitch reached (for solutions with the pitch at a limit), and stops at the
 * first that holds the point. When the limits allow no exact solution the closest is returned; a switch then reaches
 * beyond the limits (egoSwitchNav), and only what that cannot hold either (a cursor over the surround) is carried by
 * the blend (scene/camera/blend.ts; DECISIONS [M4-P1], [M4-P1 review]).
 */
export function egoNavForAnchor(params: EgoRigParams, table: TableSize, angleDeg: number, lateral: number, vp: Viewport, a: TablePoint, s: ScreenPoint, dolly = 0): { nav: EgoNav; err: number } {
  // Starting guess at a dolly: lean straight at `a`, and the pitch that puts `a` on the view row of `s` from there.
  const seat = egoSeat(params, table, angleDeg, lateral);
  const f = forward(angleDeg);
  const ahead = (a.x - seat[0]) * f.x + (a.y - seat[1]) * f.y;
  const side = (a.x - seat[0]) * f.y - (a.y - seat[1]) * f.x;
  const tanH = Math.tan((params.fovDeg / 2) * DEG);
  const rowUp = Math.atan((1 - (2 * s.y) / Math.max(1, vp.h)) * tanH) / DEG;
  const guess = (d: number): EgoNav => {
    // The dolly moves the eye along the view ray (roughly at the default pitch): forward and down.
    const p0 = params.pitchDeg * DEG;
    const h = Math.max(1, params.height - d * Math.sin(p0));
    const fwd = Math.max(1, ahead - d * Math.cos(p0));
    return clampEgoNav(params, { lean: side, dolly: d, pitchDeg: Math.atan2(h, fwd) / DEG + rowUp });
  };
  const solve = (start: EgoNav, unknowns: Unknowns) => solveNav(params, table, angleDeg, lateral, vp, a, s, start, unknowns);
  let best: { nav: EgoNav; err: number } = { nav: guess(dolly), err: Infinity };
  const consider = (r: { nav: EgoNav; err: number }) => {
    if (r.err < best.err) best = r;
  };
  const lo = clamp(dolly, 0, params.maxDollyMm);
  let warm: EgoNav | null = null;
  for (let k = 0; k <= ANCHOR_DOLLY_STEPS; k++) {
    const d = lo + ((params.maxDollyMm - lo) * k) / ANCHOR_DOLLY_STEPS;
    // From the guess, and from the previous dolly's solution (the solutions move smoothly with the dolly).
    const starts = warm ? [guess(d), clampEgoNav(params, { ...warm, dolly: d })] : [guess(d)];
    let here: { nav: EgoNav; err: number } | null = null;
    for (const start of starts) {
      const lp = solve(start, 'leanPitch');
      consider(lp);
      if (lp.err > ANCHOR_TOL_PX) consider(solve(lp.nav, 'leanDolly'));
      if (best.err <= ANCHOR_TOL_PX) return best;
      if (!here || lp.err < here.err) here = lp;
    }
    warm = here ? here.nav : warm;
  }
  return best;
}

/**
 * The ego navigation a switch from bird's-eye lands on, showing table point `a` at screen point `s` (DESIGN "Camera and
 * navigation", Switching: "the point under the cursor stays under the cursor"). Within the rig's limits when they
 * allow it (egoNavForAnchor). From the seat they cannot show every table point everywhere on screen: within 25°..60°
 * the viewer's own near cards never show at the top of the screen, nor the far side at the bottom, and a point near
 * one side edge never at the opposite screen edge. Then the landing pose reaches beyond the limits (SWITCH_REACH):
 * steeper or flatter, further aside, further forward, never below the minimum height or behind the seat; for table
 * points only (a cursor over the surround is outside the guarantee). The rig keeps such a navigation until gestures
 * bring it back (egoLimitsWith; DECISIONS [M4-P1 review]).
 */
export function egoSwitchNav(params: EgoRigParams, table: TableSize, angleDeg: number, lateral: number, vp: Viewport, a: TablePoint, s: ScreenPoint): { nav: EgoNav; err: number } {
  let best = egoNavForAnchor(params, table, angleDeg, lateral, vp, a, s, 0);
  // A point over the surround stays outside the guarantee (DECISIONS [M4-P1]): no landing beyond the limits for it.
  if (Math.abs(a.x) > table.w / 2 || Math.abs(a.y) > table.d / 2) return best;
  for (const reach of SWITCH_REACH) {
    if (best.err <= ANCHOR_TOL_PX) break;
    const wide: EgoRigParams = {
      ...params,
      minPitchDeg: reach.pitch ? EGO_PITCH_HARD.min : params.minPitchDeg,
      maxPitchDeg: reach.pitch ? EGO_PITCH_HARD.max : params.maxPitchDeg,
      leanMm: Math.abs(params.leanMm) * reach.lean,
      maxDollyMm: params.maxDollyMm * reach.dolly,
    };
    const r = egoNavForAnchor(wide, table, angleDeg, lateral, vp, a, s, 0);
    if (r.err < best.err) best = r;
  }
  return best;
}

/**
 * Wheel or pinch zoom in the ego rig, centred on the cursor: dolly toward the table point under it by the zoom
 * factor's share of its distance, then lean and pitch so that point stays under the cursor as far as the limits allow.
 */
export function egoZoomNav(params: EgoRigParams, table: TableSize, angleDeg: number, lateral: number, vp: Viewport, nav: EgoNav, s: ScreenPoint, factor: number): EgoNav {
  const pose = egoPose(params, table, angleDeg, nav, lateral);
  const a = unprojectToTable(pose, angleDeg, vp, s.x, s.y);
  const dist = a ? len(sub([a.x, a.y, 0], pose.position)) : len(sub(pose.target, pose.position));
  const step = dist * (1 - 1 / Math.max(1e-6, factor));
  const moved = clampEgoNav(params, { ...nav, dolly: nav.dolly + step });
  if (!a || moved.dolly === nav.dolly) return moved;
  const solved = solveNav(params, table, angleDeg, lateral, vp, a, s, moved, 'leanPitch');
  return solved.err < 2 ? solved.nav : moved;
}

/**
 * Drag the table in the ego rig (pan): sideways is lean, toward or away from the viewer is dolly (pulling the table
 * toward you moves you forward), both at the scale of the view centre.
 */
export function egoPanNav(params: EgoRigParams, table: TableSize, angleDeg: number, lateral: number, vp: Viewport, nav: EgoNav, dx: number, dy: number): EgoNav {
  const k = posePxPerMm(egoPose(params, table, angleDeg, nav, lateral), vp);
  return clampEgoNav(params, { ...nav, lean: nav.lean - dx / k, dolly: nav.dolly + dy / k });
}

/** Pitch the ego rig by `deg` (positive looks further down), within the limits. */
export function egoPitchNav(params: EgoRigParams, nav: EgoNav, deg: number): EgoNav {
  return clampEgoNav(params, { ...nav, pitchDeg: nav.pitchDeg + deg });
}
