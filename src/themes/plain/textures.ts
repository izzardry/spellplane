/**
 * Plain's procedural textures (docs/design/m8/m7-adjustments.md, M7-P1, "The Plain table world": "A procedural
 * halftone on it: dots 0.5 mm across on a 4 mm grid, ink at 5 %; mip-mapped and anisotropically filtered so it fades to
 * an even tone at a distance instead of shimmering"; the desk "with the same halftone at 3 %"). Nothing is bundled;
 * docs/ASSETS.md lists these as procedural.
 *
 * Grey maps multiplied by the material colour: white paper with grey dots. The tile is a power of two in pixels, so the
 * GPU builds the full mip chain (the scene's material library keeps three's default trilinear mip filter and applies
 * the quality level's anisotropy), and the dots are antialiased by coverage, so every mip level averages to the same tone.
 */
import type { TextureSource } from '../../util/texture';
import { putPixels } from '../kit/procedural';

/** The halftone tile, mm: four dots a side. */
export const HALFTONE_TILE_MM = 16;
/** Dot pitch and diameter, mm. */
export const HALFTONE_PITCH_MM = 4;
export const HALFTONE_DOT_MM = 0.5;

/** Pixels a side of a tile (a power of two: a complete mip chain). */
export const HALFTONE_PX = 256;

/**
 * A halftone tile: white, with a dot of `ink` (0..1, the share of black at the dot's centre) every HALFTONE_PITCH_MM,
 * HALFTONE_DOT_MM across, antialiased by pixel coverage (4 × 4 samples per pixel). The dots sit on half-steps, so the
 * tile's edge cuts none and the grid runs on across tiles.
 */
export function halftone(id: string, ink: number): TextureSource {
  return {
    id,
    width: HALFTONE_PX,
    height: HALFTONE_PX,
    draw(ctx, w, h) {
      const pxPerMm = w / HALFTONE_TILE_MM;
      const step = HALFTONE_PITCH_MM * pxPerMm;
      const r = (HALFTONE_DOT_MM / 2) * pxPerMm;
      const S = 4;
      putPixels(ctx, w, h, (x, y) => {
        let hit = 0;
        for (let sy = 0; sy < S; sy++)
          for (let sx = 0; sx < S; sx++) {
            const px = x + (sx + 0.5) / S;
            const py = y + (sy + 0.5) / S;
            const dx = (px % step) - step / 2;
            const dy = (py % step) - step / 2;
            if (dx * dx + dy * dy <= r * r) hit++;
          }
        const v = Math.round(255 * (1 - ink * (hit / (S * S))));
        return [v, v, v];
      });
    },
  };
}

/** The table's halftone (5 % ink) and the desk's (3 %). */
export const TABLE_HALFTONE = halftone('plain-halftone-5', 0.05);
export const DESK_HALFTONE = halftone('plain-halftone-3', 0.03);

/** Plain's neutral card back: pale paper, an ink hairline frame and a ring of dots. Geometric only. */
export const PLAIN_BACK_COLOURS = { paper: '#f7f7f7', ink: '#0d0d0d', line: '#bdbdbd' } as const;

export const PLAIN_BACK: TextureSource = {
  id: 'plain-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    const c = PLAIN_BACK_COLOURS;
    ctx.fillStyle = c.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c.line;
    ctx.lineWidth = w * 0.008;
    ctx.strokeRect(w * 0.07, w * 0.07, w * 0.86, h - w * 0.14);
    ctx.fillStyle = c.ink;
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * w * 0.26, h / 2 + Math.sin(a) * w * 0.26, w * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.05, 0, Math.PI * 2);
    ctx.fill();
  },
};
