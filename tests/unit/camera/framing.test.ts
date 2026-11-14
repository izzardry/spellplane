/**
 * PLAN Milestone 5, owner decisions, Ego framing: "Wyrm and Stonetable keep ego as their default. The ego seat is
 * reframed (pulled back, raised or widened, within DESIGN's limits) so your own pile column (library, graveyard,
 * exile, command) and your whole battlefield row are on screen at the default ego view, at 1440x900 and on an iPad
 * landscape viewport" (scene/types.ts EGO_FRAMING_VIEWPORTS). DESIGN "Camera and navigation", Ego perspective: "tilted
 * roughly 35° below horizontal, so the player's own cards are large and near and the opponents' recede … the camera
 * never goes below the table edge or behind the seat"; "Specification", Camera rigs: field of view 45°, pitch 25°..60°.
 *
 * The real rig (scene/camera/rig.ts) at its default ego view, for every format and every seat, as the table scene
 * builds it (the camera's table, the seat angle and the seat's offset).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CAMERA, GEOMETRY, SCREEN_LAYER } from '../../../src/core/geometry';
import type { Format } from '../../../src/core/types';
import { mtgLayout, soloLayout } from '../../../src/games/mtg/layout';
import type { Rect, SeatLayout, TableLayout } from '../../../src/games/types';
import { egoSeat } from '../../../src/scene/camera/ego';
import { projectPoint } from '../../../src/scene/camera/pose';
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { cameraTable } from '../../../src/scene/layout';
import { forward } from '../../../src/scene/math';
import type { CameraRig, ScreenPoint, TablePoint } from '../../../src/scene/types';
import { DEFAULT_EGO_RIG, EGO_FRAMING_VIEWPORTS } from '../../../src/scene/types';
import { FIT_INSET, fitInsets } from '../../../src/ui/hand';

const LAYOUTS: { name: string; layout: TableLayout }[] = [
  ...(['1v1', 'ffa3', 'ffa4', '2hg'] as Format[]).map((f) => ({ name: f, layout: mtgLayout(f) })),
  { name: 'solo', layout: soloLayout() },
];

function corners(r: Rect): { x: number; y: number }[] {
  const t = (r.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const u = (a! * r.w) / 2;
    const v = (b! * r.d) / 2;
    return { x: r.x + u * c + v * s, y: r.y - u * s + v * c };
  });
}

const card = (p: { x: number; y: number; rot: number }): Rect => ({ ...p, w: GEOMETRY.card.w, d: GEOMETRY.card.h });

function egoRig(layout: TableLayout, seat: SeatLayout, vp: { width: number; height: number }): TableRig {
  return new TableRig({
    table: cameraTable(layout, seat.angle),
    viewport: { w: vp.width, h: vp.height },
    angle: seat.angle,
    inertiaMs: 325,
    rig: 'ego',
    lateral: lateralOf(seat.territory, seat.angle),
  });
}

/** What the default ego view must show of the own seat: the pile column, the command area and the battlefield row. */
function ownPieces(seat: SeatLayout): { name: string; rect: Rect }[] {
  return [
    { name: 'battlefield row (territory)', rect: seat.territory },
    { name: 'library', rect: card(seat.zones.library) },
    { name: 'graveyard', rect: card(seat.zones.graveyard) },
    { name: 'exile', rect: card(seat.zones.exile) },
    { name: 'command', rect: seat.zones.command },
  ];
}

describe('the default ego view frames the own piles and battlefield row', () => {
  for (const { name, layout } of LAYOUTS) {
    for (const seat of layout.seats) {
      for (const vp of EGO_FRAMING_VIEWPORTS) {
        it(`${name}, seat ${seat.index}, ${vp.width}x${vp.height}`, () => {
          const rig = egoRig(layout, seat, vp);
          expect(rig.rig()).toBe('ego');
          // Inside the viewport, clear of the toolbar row at the top and of the hand fan at the bottom (the HUD's
          // screen-anchored layer; ui/hand.ts FIT_INSET, DESIGN "Specification", Screen layer: the fan at 22%).
          const top = FIT_INSET.top;
          const bottom = vp.height - (vp.height * SCREEN_LAYER.handCardViewportFraction + FIT_INSET.handGap);
          for (const piece of ownPieces(seat)) {
            for (const p of corners(piece.rect)) {
              const s = rig.tableToScreen(p);
              expect(rig.depthOf(p), piece.name).toBeGreaterThan(0);
              expect(s.x, `${piece.name} x`).toBeGreaterThanOrEqual(4);
              expect(s.x, `${piece.name} x`).toBeLessThanOrEqual(vp.width - 4);
              expect(s.y, `${piece.name} y`).toBeGreaterThanOrEqual(top);
              expect(s.y, `${piece.name} y`).toBeLessThanOrEqual(bottom);
            }
          }
          // Still an ego view: the own near edge sits in the lower part of the screen, the own cards larger than the
          // far side's (perspective), and the opponents' side further up.
          const t = seat.territory;
          const near = rig.tableToScreen({ x: t.x - forward(seat.angle).x * (t.d / 2), y: t.y - forward(seat.angle).y * (t.d / 2) });
          expect(near.y).toBeGreaterThan(vp.height * 0.6);
          const ownScale = rig.pxPerMmAt({ x: t.x, y: t.y });
          const farScale = rig.pxPerMmAt({ x: -t.x, y: -t.y });
          expect(ownScale).toBeGreaterThan(farScale);
        });
      }
    }
  }
});

describe("within DESIGN's limits", () => {
  it('keeps the spec field of view, pitch and pitch limits; pulls the seat back and raises it', () => {
    expect(CAMERA.ego).toMatchObject({ fovDeg: 45, pitchDeg: 35, minPitchDeg: 25, maxPitchDeg: 60 });
    expect(CAMERA.ego.behindEdge).toBeGreaterThan(260);
    expect(CAMERA.ego.height).toBeGreaterThan(620);
    expect(DEFAULT_EGO_RIG).toMatchObject({ fovDeg: CAMERA.ego.fovDeg, behindEdge: CAMERA.ego.behindEdge, height: CAMERA.ego.height, pitchDeg: CAMERA.ego.pitchDeg });
  });

  it('at the default view the camera stands at the seat: behind the viewer\'s table edge, above the table, pitched 35°', () => {
    for (const { layout } of LAYOUTS) {
      for (const seat of layout.seats) {
        const rig = egoRig(layout, seat, EGO_FRAMING_VIEWPORTS[0]!);
        const pose = rig.pose();
        expect(pose.pitchDeg).toBe(35);
        expect(pose.fovDeg).toBe(45);
        expect(pose.position[2]).toBeCloseTo(CAMERA.ego.height, 6);
        const at = egoSeat(rig.ego, rig.table, rig.angle, rig.lateral);
        expect(pose.position[0]).toBeCloseTo(at[0], 6);
        expect(pose.position[1]).toBeCloseTo(at[1], 6);
        // Behind the own territory's near edge, along the viewer's forward axis.
        const f = forward(seat.angle);
        const camAhead = pose.position[0] * f.x + pose.position[1] * f.y;
        const edgeAhead = seat.territory.x * f.x + seat.territory.y * f.y - seat.territory.d / 2;
        expect(camAhead).toBeLessThan(edgeAhead - CAMERA.ego.behindEdge + 1e-6);
      }
    }
  });

  it('a lean, dolly or pitch from the default view still lands within the limits (never below the minimum height)', () => {
    const layout = mtgLayout('1v1');
    const rig = egoRig(layout, layout.seats[0]!, EGO_FRAMING_VIEWPORTS[1]!);
    rig.pitchBy(90);
    expect(rig.pose().pitchDeg).toBe(60);
    rig.pitchBy(-90);
    expect(rig.pose().pitchDeg).toBe(25);
    for (let i = 0; i < 40; i++) rig.zoomAt(597, 417, 1.5);
    expect(rig.pose().position[2]).toBeGreaterThanOrEqual(DEFAULT_EGO_RIG.minHeight - 1e-6);
    expect(rig.nav.dolly).toBeLessThanOrEqual(DEFAULT_EGO_RIG.maxDollyMm + 1e-6);
  });
});

/**
 * M5 gate: on screen means visible. The HUD's screen layer covers the left avatar column, the open log on the right,
 * the toolbar and the hand fan (ui/hand.ts fitInsets, handed to the rig as the scene host's fit insets); the default
 * ego view pulls the seat back and shifts it sideways until the own pieces clear them, and changes nothing where they
 * already do.
 */
describe('the default ego view keeps the own piles clear of the HUD', () => {
  for (const { name, layout } of LAYOUTS) {
    for (const seat of layout.seats) {
      for (const vp of EGO_FRAMING_VIEWPORTS) {
        for (const thumb of [0, 64]) {
          it(`${name}, seat ${seat.index}, ${vp.width}x${vp.height}${thumb ? ', thumb bar' : ''}`, () => {
            const rig = egoRig(layout, seat, vp);
            const [top, right, bottom, left] = fitInsets(vp.height, true, false, thumb).split(' ').map(Number) as [number, number, number, number];
            rig.setInsets({ top, right, bottom, left });
            rig.setEgoKeep(ownPieces(seat).flatMap((p) => corners(p.rect)));
            for (const piece of ownPieces(seat)) {
              for (const p of corners(piece.rect)) {
                const s = rig.tableToScreen(p);
                expect(rig.depthOf(p), piece.name).toBeGreaterThan(0);
                expect(s.x, `${piece.name} x`).toBeGreaterThanOrEqual(left);
                expect(s.x, `${piece.name} x`).toBeLessThanOrEqual(vp.width - right);
                expect(s.y, `${piece.name} y`).toBeGreaterThanOrEqual(top);
                expect(s.y, `${piece.name} y`).toBeLessThanOrEqual(vp.height - bottom);
              }
            }
            // Still the ego rig's look: pitch and field of view kept, the camera above and behind the own edge.
            expect(rig.pose().pitchDeg).toBe(35);
            expect(rig.pose().fovDeg).toBe(45);
            expect(rig.pose().position[2]).toBeGreaterThanOrEqual(CAMERA.ego.height - 1e-6);
          });
        }
      }
    }
  }

  it('changes nothing when the HUD covers none of the own pieces', () => {
    const layout = mtgLayout('1v1');
    const seat = layout.seats[0]!;
    const rig = egoRig(layout, seat, EGO_FRAMING_VIEWPORTS[0]!);
    const before = rig.pose();
    rig.setEgoKeep(ownPieces(seat).flatMap((p) => corners(p.rect)));
    expect(rig.egoFrame).toEqual({ pull: 0, shift: 0 });
    expect(rig.pose()).toEqual(before);
  });
});

/**
 * Review fix (M5): like the bird's-eye rig, which re-fits only a fitted view, a HUD inset or viewport change reframes
 * only the default ego view. An ego view the viewer navigated keeps its pose (opening the log does not move the table
 * under them), and a rig switch keeps the cursor's table point under the cursor while the HUD changes mid-blend (DESIGN
 * "Camera and navigation", Switching). A held-back change applies once the ego view is out of sight.
 */
describe('a HUD or viewport change reframes only the default ego view', () => {
  const insets = (vh: number, log: boolean) => {
    const [top, right, bottom, left] = fitInsets(vh, log, false).split(' ').map(Number) as [number, number, number, number];
    return { top, right, bottom, left };
  };
  const keepOf = (seat: SeatLayout) => ownPieces(seat).flatMap((p) => corners(p.rect));
  function framedRig(layout: TableLayout, seat: SeatLayout, vp: { width: number; height: number }, rig: CameraRig, log: boolean): TableRig {
    const r = egoRig(layout, seat, vp);
    if (rig !== 'ego') r.setRig(rig, 0, 0, null);
    // As the table scene does: a new table (default ego view), then the HUD's insets and the own pieces.
    r.setTable(r.table, r.angle, r.bird.frame, lateralOf(seat.territory, seat.angle));
    r.setInsets(insets(vp.height, log));
    r.setEgoKeep(keepOf(seat));
    r.bird.view = r.bird.fitView();
    return r;
  }
  const VP = { width: 1440, height: 900 };

  it('the default ego view follows the log opening and closing, and stays the default view', () => {
    const layout = mtgLayout('ffa4');
    const r = framedRig(layout, layout.seats[0]!, VP, 'ego', false);
    const before = r.pose();
    r.setInsets(insets(VP.height, true));
    expect(r.egoAtDefault()).toBe(true);
    expect(r.egoFrame.shift).not.toBeCloseTo(0, 0);
    expect(r.pose().position).not.toEqual(before.position);
    r.setInsets(insets(VP.height, false));
    expect(r.egoAtDefault()).toBe(true);
    expect(r.pose().position.map((v) => Math.round(v * 1e6))).toEqual(before.position.map((v) => Math.round(v * 1e6)));
  });

  it('an ego view the viewer navigated stays put when the log opens or the window resizes', () => {
    for (const { layout } of LAYOUTS) {
      for (const seat of layout.seats) {
        const r = framedRig(layout, seat, VP, 'ego', false);
        r.panBy(120, -40);
        expect(r.egoAtDefault()).toBe(false);
        const before = r.pose();
        r.setInsets(insets(VP.height, true));
        expect(r.pose()).toEqual(before);
        r.resize({ w: 1194, h: 834 });
        r.resize({ w: VP.width, h: VP.height });
        expect(r.pose()).toEqual(before);
        // Out of sight in bird's-eye the held-back framing applies: back in ego, the seat is the one for the open log.
        r.setRig('birdseye', 0, 0, null);
        const fresh = framedRig(layout, seat, VP, 'ego', true);
        expect(r.egoFrame).toEqual(fresh.egoFrame);
        expect(r.lateral).toBeCloseTo(fresh.lateral, 9);
      }
    }
  });

  it('a new table or seat brings the default ego view, framed for the HUD it finds', () => {
    const layout = mtgLayout('ffa4');
    const seat = layout.seats[0]!;
    const r = framedRig(layout, seat, VP, 'ego', false);
    r.panBy(120, -40);
    r.setInsets(insets(VP.height, true));
    r.setTable(r.table, r.angle, r.bird.frame, lateralOf(seat.territory, seat.angle));
    expect(r.egoAtDefault()).toBe(true);
    expect(r.egoFrame).toEqual(framedRig(layout, seat, VP, 'ego', true).egoFrame);
  });

  const SEATS = LAYOUTS.flatMap(({ layout }) => layout.seats.map((seat) => ({ layout, seat })));
  const unit = fc.noBias(fc.integer({ min: 0, max: 100_000 })).map((v) => v / 100_000);
  const setup = fc.record({ i: fc.integer({ min: 0, max: SEATS.length - 1 }), vp: fc.constantFrom(...EGO_FRAMING_VIEWPORTS), log: fc.boolean(), to: fc.constantFrom<CameraRig>('ego', 'birdseye'), cursor: fc.record({ x: unit, y: unit }), at: fc.integer({ min: 0, max: 200 }).map((v) => v * 2) });
  const screenOf = (r: TableRig, a: TablePoint, vp: { width: number; height: number }): ScreenPoint => {
    const q = projectPoint(r.pose(), r.angle, { w: vp.width, h: vp.height }, [a.x, a.y, 0]);
    return { x: q.x, y: q.y };
  };

  it('the HUD changing mid-switch keeps the cursor\'s table point under the cursor (within 2 px); a switch to ego lands still', () => {
    let checked = 0;
    fc.assert(
      fc.property(setup, ({ i, vp, log, to, cursor, at }) => {
        const { layout, seat } = SEATS[i]!;
        const r = framedRig(layout, seat, vp, to === 'ego' ? 'birdseye' : 'ego', log);
        const c = { x: cursor.x * vp.width, y: cursor.y * vp.height };
        const a = r.screenToTableOrNull(c.x, c.y);
        // The guarantee holds for table points (a cursor over the surround is outside it).
        if (!a || Math.abs(a.x) > r.table.w / 2 || Math.abs(a.y) > r.table.d / 2 || r.table.rot) return;
        checked++;
        r.setRig(to, 0, 400, c);
        let worst = 0;
        for (let t = 0; t <= 404; t += 2) {
          if (t === at) r.setInsets(insets(vp.height, !log));
          r.step(t, 2);
          // While the rigs blend; a switch to ego also after it (the ego view it lands on is not moved). A bird's-eye
          // view takes the new insets after the blend as any bird's-eye view does (re-clamped, re-fitted when fitted).
          const s = screenOf(r, a, vp);
          if (r.switching || to === 'ego') worst = Math.max(worst, Number.isFinite(s.x) ? Math.hypot(s.x - c.x, s.y - c.y) : Infinity);
        }
        expect(worst).toBeLessThan(2);
        // Once the blend is over the change applies: the bird's-eye rig has the new insets; the ego view the switch
        // landed on is not the default one, so it keeps its pose (and its framing until it is out of sight).
        expect(r.bird.insets).toEqual(insets(vp.height, !log));
      }),
      { numRuns: 400, seed: 5 },
    );
    expect(checked).toBeGreaterThan(100);
  });
});
