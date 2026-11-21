/**
 * Gate M8 layout findings (docs/gates/M8-gate.md): the hand fan keeps to the band between the own plate and the primary
 * (F17), the evening's proposals join the Menu's "This game" group (F6), a made-up nickname is told from a chosen one
 * (F9), and an anchored tilt from the fitted view keeps the own side's near corners on screen (F15).
 */
import { describe, expect, it } from 'vitest';
import { fanLayout } from '../../../src/ui/hand';
import { menuWithShell, type HudMenuGroup } from '../../../src/ui/hud/menu-model';
import { isMadeUpNickname, randomNickname } from '../../../src/ui/lobby/names';
import { makeRig, px, TABLES } from '../camera/helpers';
import { tableCorners } from '../../../src/scene/camera/table';

describe('the hand fan between the own plate and the primary (F17)', () => {
  for (const [vw, vh] of [
    [1280, 800],
    [1440, 900],
  ] as const) {
    it(`${vw} × ${vh}: seven resting cards stay inside the band, centred in it`, () => {
      const span = { left: 16 + 360 + 16, right: vw - 16 - 264 - 16 };
      const boxes = fanLayout(7, vw, vh, null, span);
      expect(boxes).toHaveLength(7);
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(span.left - 1e-9);
        expect(b.left + b.width).toBeLessThanOrEqual(span.right + 1e-9);
      }
      const mid = (boxes[0]!.left + boxes[6]!.left + boxes[6]!.width) / 2;
      expect(mid).toBeCloseTo((span.left + span.right) / 2);
    });
  }

  it('a raised card stays inside the band where it fits', () => {
    const span = { left: 392, right: 1144 };
    const raised = fanLayout(7, 1440, 900, 0, span)[0]!;
    expect(raised.left).toBeGreaterThanOrEqual(span.left);
    expect(raised.left + raised.width).toBeLessThanOrEqual(span.right);
  });

  it('a band narrower than one card is ignored (the old 80 % layout)', () => {
    expect(fanLayout(3, 1440, 900, null, { left: 700, right: 720 })).toEqual(fanLayout(3, 1440, 900));
  });
});

describe('the evening proposals in "This game" (F6)', () => {
  const shell: HudMenuGroup[] = [
    {
      id: 'top:this-game',
      label: 'This game',
      items: [
        { id: 'top:leave', label: 'Leave to home' },
        { id: 'top:concede', label: 'Concede', danger: true },
      ],
    },
  ];
  const own: HudMenuGroup[] = [
    { id: 'game', label: 'Game', items: [{ id: 'mulligan', label: 'Mulligan' }] },
    { id: 'table', label: 'Table', items: [{ id: 'nextGame', label: 'Next game…' }] },
  ];

  it('moves Next game into This game, before Concede, and drops the Table group', () => {
    const m = menuWithShell(shell, own);
    expect(m.map((g) => g.id)).toEqual(['top:this-game', 'game']);
    expect(m[0]!.items.map((i) => i.id)).toEqual(['top:leave', 'nextGame', 'top:concede']);
  });

  it('without a This game group the menus are only joined', () => {
    expect(menuWithShell([], own)).toEqual(own);
  });
});

describe('made-up nicknames (F9)', () => {
  it('every generated nickname is recognised; chosen names are not', () => {
    for (let i = 0; i < 50; i++) expect(isMadeUpNickname(randomNickname())).toBe(true);
    for (const n of ['Ann', 'Ann Lee', 'Player', '', 'Tawny Wren Two', 'tawny wren']) expect(isMadeUpNickname(n)).toBe(false);
  });
});

describe('an anchored tilt from the fitted view keeps the near corners on screen (F15)', () => {
  it('a right-drag from the middle preset down to first person: the press point holds and the near corners stay inside 1440 × 900', () => {
    const rig = makeRig({ tilt: 0.5, insets: { top: 74, right: 0, bottom: 206, left: 190 } });
    const c = { x: 720, y: 470 };
    const a = rig.screenToTable(c.x, c.y);
    rig.beginTiltDrag(c, 'drag');
    for (let i = 0; i < 10; i++) rig.tiltDragBy(-0.05);
    expect(rig.tilt()).toBeCloseTo(0, 9);
    expect(px(rig.tableToScreen(a), c)).toBeLessThan(1e-3);
    const near = tableCorners(TABLES['1v1']).filter((p) => p.y < 0);
    for (const p of near) {
      const s = rig.tableToScreen(p);
      expect(s.x).toBeGreaterThanOrEqual(15);
      expect(s.x).toBeLessThanOrEqual(1440 - 15);
    }
  });
});
