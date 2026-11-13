/**
 * Wyrm's neutral card back (DESIGN "Themes and rendering", Card dressing: "the neutral card back"; Assets: no Wizards
 * artwork, logos or official card back; ornament stays geometric). Drawn on a canvas: an obsidian field of scales
 * inside an ember frame with a glowing lozenge at its heart. No text, no randomness: the same picture every time.
 */
import type { Canvas2D, TextureSource } from '../../util/texture';

/** Colours of the back, also used by tests to recognise it. */
export const BACK_COLOURS = { field: '#0e0807', band: '#24100a', scale: '#3a1a10', frame: '#c8662c', core: '#ffb04a', mid: '#b4320c', rim: '#2a0c05' } as const;

function scales(ctx: Canvas2D, x0: number, y0: number, w: number, h: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.strokeStyle = BACK_COLOURS.scale;
  ctx.lineWidth = Math.max(1, r * 0.12);
  const rows = Math.ceil(h / (r * 0.8)) + 2;
  const cols = Math.ceil(w / (r * 1.6)) + 2;
  for (let row = 0; row < rows; row++) {
    const cy = y0 + row * r * 0.8 - r;
    const off = row % 2 ? r * 0.8 : 0;
    for (let c = -1; c < cols; c++) {
      const cx = x0 + c * r * 1.6 + off;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function lozenge(ctx: Canvas2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
}

/** The back as a procedural texture (themes/types.ts CardDressing.back). */
export const WYRM_BACK: TextureSource = {
  id: 'wyrm-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    ctx.fillStyle = BACK_COLOURS.band;
    ctx.fillRect(0, 0, w, h);
    const m = w * 0.06;
    ctx.fillStyle = BACK_COLOURS.field;
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
    scales(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.07);
    ctx.strokeStyle = BACK_COLOURS.frame;
    ctx.lineWidth = Math.max(1, w * 0.012);
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.lineWidth = Math.max(1, w * 0.005);
    ctx.strokeRect(m * 1.6, m * 1.6, w - 3.2 * m, h - 3.2 * m);
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.26);
    g.addColorStop(0, BACK_COLOURS.core);
    g.addColorStop(0.45, BACK_COLOURS.mid);
    g.addColorStop(1, BACK_COLOURS.rim);
    lozenge(ctx, cx, cy, w * 0.22, h * 0.2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.01);
    ctx.strokeStyle = BACK_COLOURS.frame;
    ctx.stroke();
    lozenge(ctx, cx, cy, w * 0.07, h * 0.065);
    ctx.fillStyle = BACK_COLOURS.field;
    ctx.fill();
    ctx.stroke();
  },
};
