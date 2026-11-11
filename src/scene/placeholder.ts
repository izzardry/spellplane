/**
 * Placeholder card faces (test harness, ?faces=placeholder): drawn on a canvas from
 * name, mana cost and type line, so tests and screenshots never need Scryfall images.
 * Same input always gives the same picture.
 */
export interface PlaceholderFace {
  name: string;
  cost?: string;
  type?: string;
  /** Free text in the body, e.g. oracle text or power/toughness. */
  text?: string;
  pt?: string;
}

/** Card aspect 63 x 88; 488 x 680 matches Scryfall's "normal" tier. */
export const PLACEHOLDER_SIZE = { width: 488, height: 680 } as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Frame colour from the mana cost's colours, else a muted hue from the name. */
export function placeholderColour(face: PlaceholderFace): string {
  const c = (face.cost ?? '').toUpperCase();
  const colours: string[] = [];
  if (c.includes('W')) colours.push('#e9e2c8');
  if (c.includes('U')) colours.push('#a9c8e6');
  if (c.includes('B')) colours.push('#a9a2a6');
  if (c.includes('R')) colours.push('#e8a990');
  if (c.includes('G')) colours.push('#a8cfa6');
  if (colours.length === 1) return colours[0]!;
  if (colours.length > 1) return '#e2c87a';
  if ((face.type ?? '').toLowerCase().includes('land')) return '#d2c2a8';
  return `hsl(${hash(face.name) % 360} 12% 78%)`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw a face into a new canvas (or the one given). */
export function drawPlaceholderFace(
  face: PlaceholderFace,
  canvas: HTMLCanvasElement | OffscreenCanvas = document.createElement('canvas'),
): HTMLCanvasElement | OffscreenCanvas {
  const { width: W, height: H } = PLACEHOLDER_SIZE;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return canvas;
  const frame = placeholderColour(face);
  ctx.fillStyle = '#16161a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = frame;
  ctx.fillRect(18, 18, W - 36, H - 36);
  // name bar
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(34, 34, W - 68, 52);
  ctx.fillStyle = '#111';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(face.name, 46, 61, W - 68 - 24 - 120);
  if (face.cost) {
    ctx.textAlign = 'right';
    ctx.font = '600 26px ui-monospace, monospace';
    ctx.fillText(face.cost.replace(/[{}]/g, ''), W - 46, 61, 120);
    ctx.textAlign = 'left';
  }
  // art box: diagonal hatch, hue from the name
  const hue = hash(face.name) % 360;
  ctx.fillStyle = `hsl(${hue} 30% 55%)`;
  ctx.fillRect(34, 98, W - 68, 270);
  ctx.strokeStyle = `hsl(${hue} 30% 45%)`;
  ctx.lineWidth = 6;
  for (let x = -270; x < W; x += 28) {
    ctx.beginPath();
    ctx.moveTo(34 + x, 368);
    ctx.lineTo(34 + x + 270, 98);
    ctx.stroke();
  }
  // type bar
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(34, 380, W - 68, 44);
  ctx.fillStyle = '#111';
  ctx.font = '500 24px system-ui, sans-serif';
  ctx.fillText(face.type ?? '', 46, 402, W - 92);
  // text box
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(34, 436, W - 68, 190);
  if (face.text) {
    ctx.fillStyle = '#222';
    ctx.font = '400 21px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    wrap(ctx, face.text, W - 100)
      .slice(0, 7)
      .forEach((l, i) => ctx.fillText(l, 48, 448 + i * 25));
  }
  if (face.pt) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(W - 130, H - 84, 96, 46);
    ctx.fillStyle = '#111';
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face.pt, W - 82, H - 61);
    ctx.textAlign = 'left';
  }
  return canvas;
}
