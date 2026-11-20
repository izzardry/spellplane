/**
 * Graphite's procedural textures (docs/design/m7-directions.html, Direction B: "a deep cool charcoal with a barely
 * visible dot grid"; PLAN Milestone 7, Owner decisions: Graphite "gets depth (layered surfaces, soft shadows, a subtle
 * material grain)"). Nothing is bundled; docs/ASSETS.md lists these as procedural.
 *
 * - SLATE: a fine stone grain (grey, multiplied by the charcoal colour) with a dot every DOT_PITCH_MM, and its normal
 *   map (the grain only), so the surface catches light at a grazing first-person view.
 * - GRAPHITE_BACK: the look's neutral card back: a cool gradient field with a mint hairline ring, geometric only.
 */
import type { TextureSource } from '../../util/texture';
import { grain } from '../kit/surfaces';
import { roundRect } from '../kit/procedural';

/** The slate tile, mm; DOT_PITCH_MM divides it, so the grid runs on across tiles. */
export const SLATE_TILE_MM = 120;
export const DOT_PITCH_MM = 20;
export const SLATE = grain({ id: 'graphite-slate', px: 360, lo: 196, hi: 226, strength: 1.1, seed: 71, dots: { perSide: SLATE_TILE_MM / DOT_PITCH_MM, radiusPx: 1.6, grey: 255 } });

/** The plinth's grain: the same stone without the dots. */
export const PLINTH = grain({ id: 'graphite-plinth', px: 256, lo: 200, hi: 236, strength: 1.4, seed: 72 });

export const GRAPHITE_BACK_COLOURS = { from: '#2a3038', to: '#1d2228', ring: '#3fd2a3', line: '#3a414d' } as const;

export const GRAPHITE_BACK: TextureSource = {
  id: 'graphite-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    const c = GRAPHITE_BACK_COLOURS;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, c.from);
    g.addColorStop(1, c.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // A hairline frame and a mint ring: precise, quiet.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = w * 0.008;
    roundRect(ctx, w * 0.07, w * 0.07, w * 0.86, h - w * 0.14, w * 0.035);
    ctx.stroke();
    ctx.strokeStyle = c.ring;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = w * 0.01;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ring;
    roundRect(ctx, w / 2 - w * 0.05, h / 2 - w * 0.07, w * 0.1, w * 0.14, w * 0.02);
    ctx.fill();
  },
};
