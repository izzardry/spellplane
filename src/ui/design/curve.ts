/**
 * The geometry of the curve chart (docs/design/m8/visual.md V15, 2.8 "Curve chart"): eight columns, mana value 0 to
 * 7+; per column an ink bar for creatures and a halftone bar for other spells at 9 px per card (scaled down when the
 * tallest column would not fit), and a dotted outline to the height of a good curve. Pure. Added by M8-P1.
 */
export const CURVE_COLUMNS = 8;
/** px per card at full size (visual.md 2.8). */
export const CURVE_PX_PER_CARD = 9;

export interface CurveColumn {
  /** Mana value label: '0' … '6', '7+'. */
  mv: string;
  creatures: number;
  others: number;
  /** Bar heights in px. */
  cr: number;
  sp: number;
  /** Target outline height in px, null without a target. */
  tg: number | null;
}

/** Eight non-negative whole counts (missing columns are 0, extra ones are folded into 7+). */
export function eight(values: readonly number[]): number[] {
  const out = Array.from({ length: CURVE_COLUMNS }, (_, i) => Math.max(0, Math.round(values[i] ?? 0)));
  for (let i = CURVE_COLUMNS; i < values.length; i++) out[CURVE_COLUMNS - 1]! += Math.max(0, Math.round(values[i] ?? 0));
  return out;
}

/** Columns for a chart whose bars may be at most `barSpace` px high. */
export function curveColumns(creatures: readonly number[], others: readonly number[], target: readonly number[] | undefined, barSpace: number): CurveColumn[] {
  const c = eight(creatures);
  const o = eight(others);
  const t = target ? eight(target) : null;
  const tallest = Math.max(1, ...c.map((v, i) => v + o[i]!), ...(t ?? [0]));
  const px = Math.min(CURVE_PX_PER_CARD, barSpace / tallest);
  return c.map((cr, i) => ({
    mv: i === CURVE_COLUMNS - 1 ? '7+' : String(i),
    creatures: cr,
    others: o[i]!,
    cr: cr * px,
    sp: o[i]! * px,
    tg: t ? t[i]! * px : null,
  }));
}

/** Sparkline bar heights (px, at most `max`), in proportion to the largest value. */
export function sparkHeights(values: readonly number[], max = 20): number[] {
  const top = Math.max(1, ...values.map((v) => Math.max(0, v)));
  return values.map((v) => Math.round((Math.max(0, v) / top) * max));
}
