/**
 * Spellplane's own neutral card back (DESIGN "Card data and images": the official back carries Wizards trademarks;
 * "Themes and rendering", Assets: nothing bundled, ornament stays geometric). Drawn procedurally with canvas
 * primitives: an ink field, a lozenge lattice and a compass-rose emblem. No text, no images, no marks.
 */
import type { Canvas2D, TextureSource } from '../../util/texture';

const INK = '#1c2230';
const PANEL = '#263049';
const LATTICE = 'rgba(214, 200, 160, 0.16)';
const LINE = '#d6c8a0';
const GLOW_IN = 'rgba(120, 150, 220, 0.35)';
const GLOW_OUT = 'rgba(120, 150, 220, 0)';

/** A rounded-rectangle path inside the given box. */
function roundedRect(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** A star of `points` spikes alternating between radii `outer` and `inner`, first spike pointing up, turned by `turn` radians. */
function star(ctx: Canvas2D, cx: number, cy: number, outer: number, inner: number, points: number, turn = 0): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2 + turn;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Paint the back over the whole `width` x `height` area. Same size, same picture. */
export function drawCardBack(ctx: Canvas2D, width: number, height: number): void {
  const s = Math.min(width / 63, height / 88); // pixels per millimetre of card
  const cx = width / 2;
  const cy = height / 2;

  ctx.save();
  // Field: covers the whole texture first, so no transparent corners remain.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);

  // Inner panel with a hairline frame.
  const inset = 3 * s;
  const pw = width - 2 * inset;
  const ph = height - 2 * inset;
  roundedRect(ctx, inset, inset, pw, ph, 2.5 * s);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.35 * s);
  ctx.strokeStyle = LINE;
  ctx.stroke();

  // Lozenge lattice inside the panel.
  const cell = 6 * s;
  const half = cell / 2;
  ctx.strokeStyle = LATTICE;
  ctx.lineWidth = Math.max(0.5, 0.18 * s);
  const cols = Math.floor((pw - 2 * s) / cell);
  const rows = Math.floor((ph - 2 * s) / cell);
  const ox = cx - (cols * cell) / 2;
  const oy = cy - (rows * cell) / 2;
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * cell + half;
      const y = oy + r * cell + half;
      ctx.moveTo(x, y - half);
      ctx.lineTo(x + half, y);
      ctx.lineTo(x, y + half);
      ctx.lineTo(x - half, y);
      ctx.lineTo(x, y - half);
    }
  }
  ctx.stroke();

  // Central glow.
  const R = Math.min(pw, ph) * 0.36;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, GLOW_IN);
  glow.addColorStop(1, GLOW_OUT);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Emblem: two rings around an eight-point compass rose.
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1, 0.4 * s);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.75, 0.2 * s);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.68, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = LINE;
  star(ctx, cx, cy, R * 0.6, R * 0.14, 4);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  star(ctx, cx, cy, R * 0.42, R * 0.1, 4, Math.PI / 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Hub.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Corner lozenges.
  ctx.fillStyle = LINE;
  for (const [x, y] of [
    [inset + 6 * s, inset + 6 * s],
    [width - inset - 6 * s, inset + 6 * s],
    [inset + 6 * s, height - inset - 6 * s],
    [width - inset - 6 * s, height - inset - 6 * s],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y - 2 * s);
    ctx.lineTo(x + 1.4 * s, y);
    ctx.lineTo(x, y + 2 * s);
    ctx.lineTo(x - 1.4 * s, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The neutral card back as a procedural texture at the 488 x 680 tier. */
export const MTG_CARD_BACK: TextureSource = {
  id: 'spellplane-back',
  width: 488,
  height: 680,
  draw: drawCardBack,
};
