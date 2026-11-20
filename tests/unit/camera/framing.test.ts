/**
 * The hand and the own seat stay in reach at every tilt (PLAN M7-P3: "The hand stays in reach and readable at every
 * tilt"; Owner decisions, One continuous tilt: "with the hand kept in reach throughout"), and first person keeps M5's
 * ego framing (PLAN Milestone 5, owner decisions, Ego framing: "your own pile column (library, graveyard, exile,
 * command) and your whole battlefield row are on screen at the default ego view, at 1440x900 and on an iPad landscape
 * viewport"; scene/types.ts EGO_FRAMING_VIEWPORTS).
 *
 * The hand itself is the HUD's fan in the screen layer (DESIGN "Camera and navigation", Screen-anchored layer: it keeps
 * a constant size at any zoom), so the camera's part is to keep the table clear of it: the fitted view at every tilt
 * puts the own pieces inside the HUD's free area (ui/hand.ts fitInsets), never under the fan or the toolbar.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '../../../src/core/geometry';
import type { Format } from '../../../src/core/types';
import { mtgLayout, soloLayout } from '../../../src/games/mtg/layout';
import type { Rect, SeatLayout, TableLayout } from '../../../src/games/types';
import type { Insets } from '../../../src/scene/camera/birdseye';
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { cameraTable } from '../../../src/scene/layout';
import { forward, rectPoint } from '../../../src/scene/math';
import { EGO_FRAMING_VIEWPORTS } from '../../../src/scene/types';
import { fitInsets } from '../../../src/ui/hand';
import { px } from './helpers';

const LAYOUTS: { name: string; layout: TableLayout }[] = [
  ...(['1v1', 'ffa3', 'ffa4', '2hg'] as Format[]).map((f) => ({ name: f, layout: mtgLayout(f) })),
  { name: 'solo', layout: soloLayout() },
];
const TILTS = [0, 0.25, 0.5, 0.75, 1];

const corners = (r: Rect) => [
  rectPoint(r, -r.w / 2, -r.d / 2),
  rectPoint(r, r.w / 2, -r.d / 2),
  rectPoint(r, r.w / 2, r.d / 2),
  rectPoint(r, -r.w / 2, r.d / 2),
];
const card = (p: { x: number; y: number; rot: number }): Rect => ({ ...p, w: GEOMETRY.card.w, d: GEOMETRY.card.h });

/** What the view must keep in reach of the own seat: the battlefield row, the pile column and the command area. */
function ownPieces(seat: SeatLayout): { name: string; rect: Rect }[] {
  return [
    { name: 'battlefield row (territory)', rect: seat.territory },
    { name: 'library', rect: card(seat.zones.library) },
    { name: 'graveyard', rect: card(seat.zones.graveyard) },
    { name: 'exile', rect: card(seat.zones.exile) },
    { name: 'command', rect: seat.zones.command },
  ];
}

const hud = (vh: number, log: boolean, thumb = 0): Insets => {
  const [top, right, bottom, left] = fitInsets(vh, log, false, thumb).split(' ').map(Number) as [number, number, number, number];
  return { top, right, bottom, left };
};

function seatRig(layout: TableLayout, seat: SeatLayout, vp: { width: number; height: number }, tilt: number, insets: Insets): TableRig {
  return new TableRig({ table: cameraTable(layout, seat.angle), viewport: { w: vp.width, h: vp.height }, angle: seat.angle, inertiaMs: 325, tilt, lateral: lateralOf(seat.territory, seat.angle), insets });
}

describe('the own seat stays in reach, clear of the hand fan and the toolbar, at every tilt', () => {
  for (const { name, layout } of LAYOUTS) {
    for (const seat of layout.seats) {
      for (const vp of EGO_FRAMING_VIEWPORTS) {
        for (const thumb of [0, 64]) {
          it(`${name}, seat ${seat.index}, ${vp.width}x${vp.height}${thumb ? ', thumb bar' : ''}`, () => {
            const insets = hud(vp.height, true, thumb);
            for (const t of TILTS) {
              const rig = seatRig(layout, seat, vp, t, insets);
              for (const piece of ownPieces(seat)) {
                for (const p of corners(piece.rect)) {
                  const s = rig.tableToScreen(p);
                  const label = `t=${t} ${piece.name}`;
                  expect(rig.depthOf(p), label).toBeGreaterThan(0);
                  expect(s.x, `${label} x`).toBeGreaterThanOrEqual(insets.left - 1e-6);
                  expect(s.x, `${label} x`).toBeLessThanOrEqual(vp.width - insets.right + 1e-6);
                  expect(s.y, `${label} y`).toBeGreaterThanOrEqual(insets.top - 1e-6);
                  expect(s.y, `${label} y`).toBeLessThanOrEqual(vp.height - insets.bottom + 1e-6);
                }
              }
            }
          });
        }
      }
    }
  }
});

describe('first person keeps the ego framing: your hand and battlefield large in front', () => {
  for (const { name, layout } of LAYOUTS) {
    for (const seat of layout.seats) {
      it(`${name}, seat ${seat.index}: the own near edge low on screen, the own side larger than the far side, the far side further up`, () => {
        const vp = EGO_FRAMING_VIEWPORTS[0]!;
        const rig = seatRig(layout, seat, vp, 0, hud(vp.height, false));
        expect(rig.pose().pitchDeg).toBe(35);
        expect(rig.pose().fovDeg).toBe(45);
        const t = seat.territory;
        const f = forward(seat.angle);
        const near = rig.tableToScreen({ x: t.x - f.x * (t.d / 2), y: t.y - f.y * (t.d / 2) });
        const far = rig.tableToScreen({ x: t.x + f.x * (t.d / 2), y: t.y + f.y * (t.d / 2) });
        expect(near.y).toBeGreaterThan(vp.height * 0.6);
        expect(far.y).toBeLessThan(near.y);
        const ownScale = rig.pxPerMmAt({ x: t.x, y: t.y });
        const across = rig.pxPerMmAt({ x: t.x + f.x * 700, y: t.y + f.y * 700 });
        expect(ownScale).toBeGreaterThan(across * 1.2);
      });
    }
  }

  it('the own cards are larger on screen in first person than at bird\'s-eye (the fitted views of the same HUD)', () => {
    const layout = mtgLayout('1v1');
    const seat = layout.seats[0]!;
    const vp = EGO_FRAMING_VIEWPORTS[0]!;
    const own = seat.territory;
    const fp = seatRig(layout, seat, vp, 0, hud(vp.height, false));
    const be = seatRig(layout, seat, vp, 1, hud(vp.height, false));
    expect(fp.cardScreenHeight({ x: own.x, y: own.y, rot: 90 })).toBeGreaterThan(be.cardScreenHeight({ x: own.x, y: own.y, rot: 90 }));
  });
});

describe('the HUD changing mid-tilt', () => {
  const SEATS = LAYOUTS.flatMap(({ layout }) => layout.seats.map((seat) => ({ layout, seat })));
  const unit = fc.noBias(fc.integer({ min: 0, max: 100_000 })).map((v) => v / 100_000);

  it('keeps the cursor\'s table point under the cursor (within 2 px) while the log opens or closes (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SEATS.length - 1 }), fc.constantFrom(...EGO_FRAMING_VIEWPORTS), fc.boolean(), fc.constantFrom(0, 0.5, 1), fc.constantFrom(0, 0.25, 0.75, 1), unit, unit, fc.integer({ min: 0, max: 30 }), (i, vp, log, from, to, fx, fy, at) => {
        if (from === to) return;
        const { layout, seat } = SEATS[i]!;
        const r = seatRig(layout, seat, vp, from, hud(vp.height, log));
        const c = { x: fx * vp.width, y: fy * vp.height };
        const a = r.screenToTableOrNull(c.x, c.y);
        if (!a || Math.abs(a.x) > r.table.w / 2 || Math.abs(a.y) > r.table.d / 2 || r.table.rot) return;
        checked++;
        r.setTilt(to, 0, 400, c);
        let worst = 0;
        for (let k = 0; k <= 120 && r.switching; k++) {
          if (k === at) r.setInsets(hud(vp.height, !log));
          r.step(16 * (k + 1), 16);
          worst = Math.max(worst, px(r.tableToScreen(a), c));
        }
        expect(worst).toBeLessThan(2);
      }),
      { numRuns: 600, seed: 5 },
    );
    expect(checked).toBeGreaterThan(100);
  });
});
