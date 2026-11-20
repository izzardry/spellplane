/**
 * Kitchen Table's procedural textures (docs/design/m7-directions.html, Direction A: "an oatmeal playmat on walnut";
 * PLAN M7-P1: procedural only). Nothing is bundled; docs/ASSETS.md lists these as procedural.
 *
 * - LINEN: a plain-weave cloth (grey, multiplied by the oatmeal colour) and its normal map, a thread every 2 mm.
 * - WALNUT: walnut boards running away from the viewer, grain and growth rings, a dark seam between boards.
 * - KITCHEN_BACK: the look's neutral card back (no official back, no Wizards artwork): brick diagonal stripes in a cream
 *   frame with a rounded paper medallion, all geometric.
 */
import type { TextureSource } from '../../util/texture';
import { roundRect } from '../kit/procedural';
import { planks, wovenCloth } from '../kit/surfaces';

/** The linen tile: 256 px over LINEN_TILE_MM (4 px per mm, a thread every 2 mm). */
export const LINEN_TILE_MM = 64;
export const LINEN = wovenCloth({ id: 'kitchen-linen', px: 256, pitch: 8, lo: 206, hi: 250, strength: 1.4, seed: 31 });

/** The walnut tile: four boards of 110 mm across, 512 px. */
export const WALNUT_TILE_MM = 440;
export const WALNUT: TextureSource = planks({ id: 'kitchen-walnut', px: 512, boards: 4, base: '#5b3f2c', dark: '#3f2a1c', light: '#77553b', seam: '#2a1b11', seed: 53 });

/** Colours of the card back (docs/design/m7-directions.html, Direction A `--t-back` and `--t-backline`). */
export const KITCHEN_BACK_COLOURS = { stripeA: '#7b3a24', stripeB: '#86432b', line: '#e6c991', paper: '#f7f1e5' } as const;

export const KITCHEN_BACK: TextureSource = {
  id: 'kitchen-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    const c = KITCHEN_BACK_COLOURS;
    ctx.fillStyle = c.stripeA;
    ctx.fillRect(0, 0, w, h);
    // Diagonal stripes at 45°, 6 and 12 px of the 488 px card in the mock, scaled.
    const step = w * 0.05;
    ctx.fillStyle = c.stripeB;
    for (let k = -h; k < w + h; k += step * 2) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + step, 0);
      ctx.lineTo(k + step - h, h);
      ctx.lineTo(k - h, h);
      ctx.closePath();
      ctx.fill();
    }
    // A cream double line frame inset 7%.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = w * 0.012;
    const inset = w * 0.07;
    roundRect(ctx, inset, inset, w - 2 * inset, h - 2 * inset, w * 0.04);
    ctx.stroke();
    // A rounded paper medallion with a brick lozenge: the look's "paper chip" in the middle.
    ctx.fillStyle = c.paper;
    roundRect(ctx, w * 0.32, h / 2 - w * 0.18, w * 0.36, w * 0.36, w * 0.08);
    ctx.fill();
    ctx.fillStyle = c.stripeA;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - w * 0.1);
    ctx.lineTo(w / 2 + w * 0.1, h / 2);
    ctx.lineTo(w / 2, h / 2 + w * 0.1);
    ctx.lineTo(w / 2 - w * 0.1, h / 2);
    ctx.closePath();
    ctx.fill();
  },
};
