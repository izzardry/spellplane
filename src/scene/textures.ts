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
export const TIERS: readonly ImageTier[] = ['small', 'normal', 'large'];

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

export class TextureLru {
  readonly cap: number;
  bytes = 0;
  private entries = new Map<string, CacheEntry>();

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
    if (frame > e.lastDrawn) e.lastDrawn = frame;
  }

  add(e: CacheEntry): void {
    const id = this.id(e.key, e.tier);
    const old = this.entries.get(id);
    if (old) this.bytes -= old.bytes;
    this.entries.set(id, e);
    this.bytes += e.bytes;
  }

  remove(e: CacheEntry): void {
    if (this.entries.delete(this.id(e.key, e.tier))) this.bytes -= e.bytes;
  }

  /** Least recently drawn evictable entry (not pinned, not drawn in `frame`), optionally of one tier. */
  private victim(frame: number, tier?: ImageTier): CacheEntry | null {
    let best: CacheEntry | null = null;
    for (const e of this.entries.values()) {
      if (e.pinned || e.lastDrawn >= frame) continue;
      if (tier && e.tier !== tier) continue;
      if (!best || e.lastDrawn < best.lastDrawn) best = e;
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
