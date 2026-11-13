/**
 * Texture tiers and the decoded-texture cache policy (DESIGN "Camera and navigation", Level of detail;
 * "Specification: geometry, layout and motion", Texture tiers). Pure bookkeeping; the GPU side is atlas.ts.
 *
 * A card uses the 146x204 image below 160 px on-screen height, 488x680 up to 560 px and 672x936 above that.
 * At most 400 MB of decoded textures are kept, least recently drawn evicted first; thumbnails are pinned
 * (never evicted during a game).
 */
import { IMAGE_TIERS, type ImageTier } from '../data/types';

export const TEXTURE_CAP_BYTES = 400 * 1024 * 1024;
/**
 * Room kept free under the texture cap for render targets that come and go (a resize, a quality change), bytes: the
 * face arrays may take the cap less the theme's own textures less this (scene/table-scene.ts faceBudget).
 */
export const FACE_BUDGET_HEADROOM = 16 * 1024 * 1024;
export const TIERS: readonly ImageTier[] = ['small', 'normal', 'large'];

/** GPU bytes per byte of level 0 with a full mip chain (the face arrays are mip-mapped). */
export const MIP_FACTOR = 4 / 3;

/**
 * How many layers a tier's face array may grow to (DESIGN "Specification: geometry, layout and motion", Texture tiers:
 * at most 400 MB of textures): normally double, but never past its maximum or past what still fits in `budget` bytes
 * next to `otherBytes` already allocated (both with mip-maps). Returns the current count when it cannot grow.
 */
export function grownLayers(a: { layers: number; maxLayers: number; layerBytes: number }, otherBytes: number, budget: number): number {
  const fit = Math.floor((budget - otherBytes) / (a.layerBytes * MIP_FACTOR));
  return Math.max(a.layers, Math.min(a.maxLayers, a.layers * 2, fit));
}

/** The tier for a card drawn `px` CSS px tall. */
export function tierForScreenHeight(px: number): ImageTier {
  if (px < IMAGE_TIERS.small.maxScreenHeightPx) return 'small';
  if (px <= IMAGE_TIERS.normal.maxScreenHeightPx) return 'normal';
  return 'large';
}

/** Decoded RGBA bytes of one texture of a tier. */
export function tierBytes(tier: ImageTier): number {
  return IMAGE_TIERS[tier].width * IMAGE_TIERS[tier].height * 4;
}

export interface CacheEntry {
  key: string;
  tier: ImageTier;
  bytes: number;
  pinned: boolean;
  /** Frame number this texture was last drawn in. */
  lastDrawn: number;
  /** Slot in the tier's atlas array. */
  slot: number;
}

/**
 * The decoded-texture cache: at most `cap` bytes, the least recently drawn texture evicted first, thumbnails pinned.
 *
 * Performance (M5-P6): every drawn card touches its texture once per frame, and an upload under the cap may evict
 * several textures, so neither may scan the whole cache. Each tier keeps its evictable entries in a Map in order of
 * their last draw (a touch moves an entry to the end), and pinned entries apart: the least recently drawn entry of a
 * tier is the first of its Map, and the overall victim is the oldest of the three tiers' first entries. `examined`
 * counts the entries looked at to find victims (the soak and unit tests check it stays independent of the cache size).
 */
export class TextureLru {
  readonly cap: number;
  bytes = 0;
  /** Entries looked at while choosing victims, since construction (performance check). */
  examined = 0;
  private entries = new Map<string, CacheEntry>();
  /** Evictable entries per tier, oldest draw first. */
  private readonly order: Record<ImageTier, Map<string, CacheEntry>> = { small: new Map(), normal: new Map(), large: new Map() };
  /** The latest draw in each tier's order (an upper bound once its entry is gone). */
  private readonly newest: Record<ImageTier, number> = { small: -Infinity, normal: -Infinity, large: -Infinity };

  constructor(cap = TEXTURE_CAP_BYTES) {
    this.cap = cap;
  }

  private id(key: string, tier: ImageTier): string {
    return `${tier}|${key}`;
  }

  get(key: string, tier: ImageTier): CacheEntry | undefined {
    return this.entries.get(this.id(key, tier));
  }

  get size(): number {
    return this.entries.size;
  }

  all(): CacheEntry[] {
    return [...this.entries.values()];
  }

  touch(e: CacheEntry, frame: number): void {
    if (frame <= e.lastDrawn) return;
    e.lastDrawn = frame;
    if (e.pinned) return;
    const id = this.id(e.key, e.tier);
    if (this.order[e.tier].get(id) !== e) return;
    // Drawn now: to the end of its tier's order.
    this.order[e.tier].delete(id);
    this.enqueue(id, e);
  }

  /** Append `e` to its tier's order; one drawn before the newest there (only tests do that) re-sorts the order. */
  private enqueue(id: string, e: CacheEntry): void {
    const q = this.order[e.tier];
    q.set(id, e);
    if (e.lastDrawn >= this.newest[e.tier]) {
      this.newest[e.tier] = e.lastDrawn;
      return;
    }
    const sorted = [...q.entries()].sort((a, b) => a[1].lastDrawn - b[1].lastDrawn);
    q.clear();
    for (const [k, v] of sorted) q.set(k, v);
  }

  add(e: CacheEntry): void {
    const id = this.id(e.key, e.tier);
    const old = this.entries.get(id);
    if (old) this.remove(old);
    this.entries.set(id, e);
    this.bytes += e.bytes;
    if (!e.pinned) this.enqueue(id, e);
  }

  remove(e: CacheEntry): void {
    const id = this.id(e.key, e.tier);
    if (this.entries.get(id) !== e) return;
    this.entries.delete(id);
    this.order[e.tier].delete(id);
    this.bytes -= e.bytes;
  }

  /** The least recently drawn evictable entry of `tier` (not pinned, not drawn in `frame`). */
  private oldest(frame: number, tier: ImageTier): CacheEntry | null {
    const first = this.order[tier].values().next();
    if (first.done === true) return null;
    this.examined++;
    // In draw order: if the oldest was drawn this frame, so were all the others.
    return first.value.lastDrawn >= frame ? null : first.value;
  }

  /** Least recently drawn evictable entry (not pinned, not drawn in `frame`), optionally of one tier. */
  private victim(frame: number, tier?: ImageTier): CacheEntry | null {
    if (tier) return this.oldest(frame, tier);
    let best: CacheEntry | null = null;
    for (const t of TIERS) {
      const e = this.oldest(frame, t);
      if (e && (!best || e.lastDrawn < best.lastDrawn)) best = e;
    }
    return best;
  }

  /**
   * Make room for a new texture of `bytes` in `tier`. When `tierFull`, one entry of that tier must go to free a
   * slot. Evicted entries are removed here; the caller releases their slots. `ok` is false when the new texture
   * cannot fit without evicting something pinned or drawn this frame. Pinned textures may exceed the cap.
   */
  makeRoom(tier: ImageTier, bytes: number, frame: number, tierFull: boolean, pinned = false): { ok: boolean; evicted: CacheEntry[] } {
    const evicted: CacheEntry[] = [];
    if (tierFull) {
      const v = this.victim(frame, tier);
      if (!v) return { ok: false, evicted };
      this.remove(v);
      evicted.push(v);
    }
    while (this.bytes + bytes > this.cap) {
      const v = this.victim(frame);
      if (!v) return { ok: pinned, evicted };
      this.remove(v);
      evicted.push(v);
    }
    return { ok: true, evicted };
  }
}
