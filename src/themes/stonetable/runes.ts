/**
 * Stonetable's runes (DESIGN "Themes and rendering": "Glowing runes", ornament "stays geometric (scales, knotwork,
 * runes) so it can be generated procedurally"; no Wizards artwork, logos or official card back). A small invented
 * alphabet of straight-stroke glyphs drawn on canvases: the glowing band carved around the slab and the theme's
 * neutral card back. Everything here is procedural; nothing is bundled.
 */
import type { Canvas2D, TextureSource } from '../../util/texture';

/** A glyph: polylines of points in a unit cell (x right, y down, 0..1). */
export type Glyph = readonly (readonly (readonly [number, number])[])[];

/**
 * The rune alphabet: sixteen invented glyphs, each a stave with branches, angles or a lozenge (geometric, carved with
 * a chisel: straight strokes only).
 */
export const GLYPHS: readonly Glyph[] = [
  [[[0.5, 0], [0.5, 1]], [[0.5, 0.2], [0.85, 0.05]], [[0.5, 0.45], [0.85, 0.3]]],
  [[[0.3, 0], [0.3, 1]], [[0.3, 0], [0.75, 0.3], [0.3, 0.55]]],
  [[[0.5, 0], [0.5, 1]], [[0.15, 0.25], [0.85, 0.6]]],
  [[[0.25, 0], [0.25, 1]], [[0.75, 0], [0.75, 1]], [[0.25, 0.3], [0.75, 0.7]]],
  [[[0.5, 0], [0.85, 0.5], [0.5, 1], [0.15, 0.5], [0.5, 0]]],
  [[[0.2, 0], [0.8, 1]], [[0.8, 0], [0.2, 1]]],
  [[[0.5, 0], [0.5, 1]], [[0.15, 0.3], [0.5, 0.05], [0.85, 0.3]]],
  [[[0.25, 0], [0.25, 1]], [[0.25, 0.15], [0.8, 0.45], [0.25, 0.75]]],
  [[[0.5, 0], [0.5, 1]], [[0.2, 0.55], [0.5, 0.8], [0.8, 0.55]]],
  [[[0.2, 0], [0.2, 1]], [[0.8, 0], [0.8, 1]], [[0.2, 0.25], [0.8, 0.25]], [[0.2, 0.75], [0.8, 0.75]]],
  [[[0.5, 0], [0.5, 1]], [[0.5, 0.35], [0.15, 0.1]], [[0.5, 0.35], [0.85, 0.1]]],
  [[[0.2, 0.15], [0.5, 0.5], [0.2, 0.85]], [[0.8, 0.15], [0.5, 0.5], [0.8, 0.85]]],
  [[[0.5, 0], [0.5, 1]], [[0.5, 0.5], [0.85, 0.25]], [[0.5, 0.5], [0.85, 0.75]]],
  [[[0.25, 1], [0.25, 0], [0.75, 0.35], [0.75, 1]]],
  [[[0.5, 0], [0.5, 1]], [[0.2, 0.3], [0.8, 0.3]], [[0.2, 0.7], [0.8, 0.7]]],
  [[[0.5, 0.05], [0.85, 0.35], [0.5, 0.65], [0.15, 0.35], [0.5, 0.05]], [[0.5, 0.65], [0.5, 1]]],
];

/** Pale, cold rune light (sRGB), set against the warm torch. */
export const RUNE_TINT = '#9fe6ff';

/** Every glyph's points lie in the unit cell and every polyline has at least two points (unit-tested). */
export function glyphProblems(glyphs: readonly Glyph[] = GLYPHS): string[] {
  const out: string[] = [];
  glyphs.forEach((g, i) => {
    if (g.length === 0) out.push(`glyph ${i} has no strokes`);
    for (const line of g) {
      if (line.length < 2) out.push(`glyph ${i} has a stroke with fewer than two points`);
      for (const [x, y] of line) if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) out.push(`glyph ${i} leaves the unit cell at ${x},${y}`);
    }
  });
  return out;
}

/** Stroke `glyph` into the box (x, y, w, h). */
export function strokeGlyph(ctx: Canvas2D, glyph: Glyph, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  for (const line of glyph) {
    line.forEach(([gx, gy], k) => {
      const px = x + gx * w;
      const py = y + gy * h;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
  }
  ctx.stroke();
}

/** Runes per tile of the band texture. */
export const BAND_RUNES = 12;

/** The band texture is BAND_ASPECT times as long as it is wide; one tile covers BAND_ASPECT × the band's width in mm. */
export const BAND_ASPECT = 16;

/**
 * The rune band carved around the slab: a transparent strip with a dark chiselled groove under every stroke and a
 * glowing core, framed by two engraved lines. The material multiplies it above 1 so the runes bloom.
 */
export const RUNE_BAND: TextureSource = {
  id: 'stonetable-rune-band',
  width: 1024,
  height: 64,
  draw(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const frame = (alpha: number, width: number, colour: string) => {
      ctx.strokeStyle = colour;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.1);
      ctx.lineTo(w, h * 0.1);
      ctx.moveTo(0, h * 0.9);
      ctx.lineTo(w, h * 0.9);
      ctx.stroke();
    };
    // Grooves first (dark, wide), then the light inside them (narrow): carved, then lit from within.
    frame(0.7, h * 0.08, '#000000');
    frame(0.55, h * 0.025, RUNE_TINT);
    const cell = w / BAND_RUNES;
    const gh = h * 0.56;
    const gw = gh * 0.62;
    for (let i = 0; i < BAND_RUNES; i++) {
      const glyph = GLYPHS[(i * 5 + 3) % GLYPHS.length]!;
      const x = i * cell + (cell - gw) / 2;
      const y = (h - gh) / 2;
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = h * 0.12;
      strokeGlyph(ctx, glyph, x, y, gw, gh);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = RUNE_TINT;
      ctx.lineWidth = h * 0.09;
      strokeGlyph(ctx, glyph, x, y, gw, gh);
      ctx.globalAlpha = 1;
      ctx.lineWidth = h * 0.04;
      strokeGlyph(ctx, glyph, x, y, gw, gh);
      // A small lozenge between runes.
      const mx = (i + 1) * cell;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = h * 0.03;
      ctx.beginPath();
      ctx.moveTo(mx, h * 0.42);
      ctx.lineTo(mx + h * 0.08, h * 0.5);
      ctx.lineTo(mx, h * 0.58);
      ctx.lineTo(mx - h * 0.08, h * 0.5);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};

/**
 * Stonetable's neutral card back (DESIGN "Themes and rendering", Card dressing: "the neutral card back"; no official
 * back): a slate panel with a bevelled frame and a ring of runes around a lozenge. Opaque, so a face-down card never
 * shows what lies under it.
 */
export const STONE_BACK: TextureSource = {
  id: 'stonetable-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1b1916';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#3a3631');
    g.addColorStop(1, '#25221e');
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.05, h * 0.036, w * 0.9, h * 0.928);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#8f8572';
    ctx.lineWidth = w * 0.012;
    ctx.strokeRect(w * 0.09, h * 0.065, w * 0.82, h * 0.87);
    ctx.strokeStyle = '#5d564b';
    ctx.lineWidth = w * 0.006;
    ctx.strokeRect(w * 0.115, h * 0.083, w * 0.77, h * 0.834);
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.3;
    ctx.strokeStyle = '#8f8572';
    ctx.lineWidth = w * 0.01;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
    ctx.stroke();
    // Eight runes around the ring, upright.
    const gs = r * 0.22;
    ctx.strokeStyle = '#b9e9f5';
    ctx.lineWidth = w * 0.008;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const gx = cx + Math.cos(a) * r * 0.84;
      const gy = cy + Math.sin(a) * r * 0.84;
      strokeGlyph(ctx, GLYPHS[(i * 3 + 1) % GLYPHS.length]!, gx - gs * 0.3, gy - gs / 2, gs * 0.6, gs);
    }
    // The central lozenge.
    ctx.strokeStyle = '#8f8572';
    ctx.lineWidth = w * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.45);
    ctx.lineTo(cx + r * 0.3, cy);
    ctx.lineTo(cx, cy + r * 0.45);
    ctx.lineTo(cx - r * 0.3, cy);
    ctx.closePath();
    ctx.stroke();
  },
};
