/**
 * The art of a closed booster, drawn by the app from the set code (docs/design/m8/visual.md V16, 2.8 "Booster pack"):
 * pure and seeded by an FNV-1a hash of `"<code>:<index>"`. No logo, set symbol, card art or image of any kind: a foil
 * wrap with crimped ends, a sigil computed from the code, and the code as text. Added by M8-P1.
 */

export interface PackArt {
  /** The seed (FNV-1a 32-bit of `"<CODE>:<index>"`). */
  hash: number;
  /** Points of the sigil's star, 5 to 8. */
  points: number;
  /** The sigil's turn, 0 to 359 degrees. */
  turnDeg: number;
  /** Concentric rings of the sigil, 2 or 3. */
  rings: number;
  /** The set code as printed (upper case, at most 5 characters). */
  code: string;
}

/** FNV-1a, 32-bit. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function packArt(setCode: string, index = 0): PackArt {
  const code = setCode.trim().toUpperCase().slice(0, 5) || '???';
  const hash = fnv1a(`${code}:${index}`);
  return {
    hash,
    points: 5 + (hash % 4),
    turnDeg: (hash >>> 2) % 360,
    rings: 2 + ((hash >>> 11) % 2),
    code,
  };
}

/** The star polygon of a sigil around (0, 0): `points` outer points at radius `r`, inner at `r * inner`. */
export function starPoints(points: number, r: number, turnDeg: number, inner = 0.45): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = ((turnDeg + (i * 180) / points) * Math.PI) / 180;
    const rr = i % 2 === 0 ? r : r * inner;
    out.push(`${(Math.sin(a) * rr).toFixed(2)},${(-Math.cos(a) * rr).toFixed(2)}`);
  }
  return out.join(' ');
}

/** The outline of a pack `w` × `h` whose two ends are crimped: `teeth` triangles `depth` deep. A closed path. */
export function packOutline(w: number, h: number, teeth = 18, depth = 7): string {
  const step = w / teeth;
  const f = (n: number): string => n.toFixed(2);
  let d = `M0 ${depth}`;
  for (let i = 0; i < teeth; i++) d += ` L${f(i * step + step / 2)} 0 L${f((i + 1) * step)} ${depth}`;
  d += ` L${w} ${h - depth}`;
  for (let i = teeth - 1; i >= 0; i--) d += ` L${f(i * step + step / 2)} ${h} L${f(i * step)} ${h - depth}`;
  return `${d} Z`;
}
