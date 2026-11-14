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
import { describe, expect, it } from 'vitest';
import { CAMERA, GEOMETRY, SCREEN_LAYER } from '../../../src/core/geometry';
import type { Format } from '../../../src/core/types';
import { mtgLayout, soloLayout } from '../../../src/games/mtg/layout';
import type { Rect, SeatLayout, TableLayout } from '../../../src/games/types';
import { egoSeat } from '../../../src/scene/camera/ego';
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { cameraTable } from '../../../src/scene/layout';
import { forward } from '../../../src/scene/math';
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
