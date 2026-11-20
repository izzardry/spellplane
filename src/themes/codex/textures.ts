/**
 * Codex's procedural textures (docs/design/m7-directions.html, Direction C: "The table is a deep midnight-blue, faintly
 * tooled with a geometric knot pattern and framed by a thin gilt line with diamond corners"). Nothing is bundled;
 * docs/ASSETS.md lists these as procedural. No particles, no glow: the fantasy lives in materials.
 *
 * - LEATHER: pebbled midnight leather with a lattice tooled in at ±45° (its grooves faintly gilt), and its normal map.
 * - EBONY: the desk under it, dark boards with a cool cast.
 * - CODEX_BACK: the look's neutral card back: a navy chequer field, a gilt frame and a vermilion seal in a gilt diamond,
 *   geometric only (no official back, no Wizards artwork).
 */
import type { TextureSource } from '../../util/texture';
import { planks, tooledLeather } from '../kit/surfaces';
import { roundRect } from '../kit/procedural';

/** The leather tile: 256 px over 64 mm; the lattice repeats every 128 px, a groove every 22.6 mm across. */
export const LEATHER_TILE_MM = 64;
export const LEATHER = tooledLeather({ id: 'codex-leather', px: 256, pitchPx: 128, base: '#1d2539', dark: '#161c2d', light: '#252e46', line: '#c8a75e', lineMix: 0.16, strength: 1.2, seed: 91 });

export const EBONY_TILE_MM = 480;
export const EBONY: TextureSource = planks({ id: 'codex-ebony', px: 512, boards: 4, base: '#221d1c', dark: '#151213', light: '#2f2827', seam: '#0d0b0b', seed: 97 });

export const CODEX_BACK_COLOURS = { a: '#232b44', b: '#1b2235', gilt: '#c8a75e', seal: '#b8432f' } as const;

export const CODEX_BACK: TextureSource = {
  id: 'codex-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    const c = CODEX_BACK_COLOURS;
    ctx.fillStyle = c.b;
    ctx.fillRect(0, 0, w, h);
    // A chequer of small squares at 45° (the mock's conic pattern).
    const s = w * 0.04;
    ctx.fillStyle = c.a;
    for (let y = -s; y < h + s; y += s)
      for (let x = -s; x < w + s; x += s) {
        if ((Math.round(x / s) + Math.round(y / s)) % 2 !== 0) continue;
        ctx.beginPath();
        ctx.moveTo(x + s / 2, y);
        ctx.lineTo(x + s, y + s / 2);
        ctx.lineTo(x + s / 2, y + s);
        ctx.lineTo(x, y + s / 2);
        ctx.closePath();
        ctx.fill();
      }
    // A gilt hairline frame with diamond corners.
    ctx.strokeStyle = c.gilt;
    ctx.lineWidth = w * 0.006;
    const i = w * 0.08;
    roundRect(ctx, i, i, w - 2 * i, h - 2 * i, 2);
    ctx.stroke();
    const diamond = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    };
    for (const [x, y] of [
      [i, i],
      [w - i, i],
      [i, h - i],
      [w - i, h - i],
    ] as const) {
      diamond(x, y, w * 0.025);
      ctx.fillStyle = c.b;
      ctx.fill();
      ctx.stroke();
    }
    // The seal: a gilt-ringed circle with a diamond and a vermilion centre.
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.17, 0, Math.PI * 2);
    ctx.stroke();
    diamond(w / 2, h / 2, w * 0.12);
    ctx.stroke();
    diamond(w / 2, h / 2, w * 0.035);
    ctx.fillStyle = c.seal;
    ctx.fill();
    ctx.stroke();
  },
};
