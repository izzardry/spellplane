/**
 * Face textures for the scene (DESIGN "Card data and images"; "Camera and navigation", Level of detail;
 * "Specification: geometry, layout and motion", Texture tiers). Resolves faces through the FaceSource (placeholder
 * canvas or URL), decodes them off the main thread where the browser can (createImageBitmap), and keeps them in
 * the tier arrays under the LRU policy of textures.ts: 400 MB of decoded textures, thumbnails pinned.
 */
import type * as THREE from 'three';
import type { CardRef } from '../core/types';
import type { FaceImage, FaceSource, ImageTier } from '../data/types';
import type { TextureSource } from '../util/texture';
import { TierArray, slotsPerLayer, type SlotUv } from './atlas';
import { BACK_KEY, BLANK_KEY, faceKey } from './faces-key';
import { drawPlaceholderFace } from './placeholder';
import { TEXTURE_CAP_BYTES, TIERS, TextureLru, tierBytes, type CacheEntry } from './textures';

export { BACK_KEY, BLANK_KEY, faceKey };

interface Job {
  key: string;
  tier: ImageTier;
  load: () => Promise<CanvasImageSource>;
}

const MAX_IN_FLIGHT = 6;
/** Decoded bytes uploaded per frame at most (keeps frames smooth while 300 thumbnails stream in). */
const UPLOAD_BUDGET = 12 * 1024 * 1024;

export class FaceTextures {
  readonly lru: TextureLru;
  readonly arrays: Record<ImageTier, TierArray>;
  private queue: Job[] = [];
  private queued = new Set<string>();
  private inFlight = 0;
  private ready: { key: string; tier: ImageTier; image: CanvasImageSource }[] = [];
  private failed = new Set<string>();
  /** Textures that did not fit (everything evictable was in use): retry after this frame. */
  private blocked = new Map<string, number>();
  private frame = 0;
  private loader: FaceLoader;
  private disposed = false;
  /** Called when a texture becomes available (the scene re-renders). */
  onChange: () => void = () => {};

  constructor(
    renderer: THREE.WebGLRenderer,
    faces: FaceSource,
    back: TextureSource,
    capBytes = TEXTURE_CAP_BYTES,
  ) {
    this.loader = new FaceLoader(faces, back);
    this.lru = new TextureLru(capBytes);
    const maxLayers = (tier: ImageTier) => Math.ceil(capBytes / (slotsPerLayer(tier) * tierBytes(tier))) + 1;
    this.arrays = {
      small: new TierArray(renderer, 'small', 1, 64),
      normal: new TierArray(renderer, 'normal', 1, maxLayers('normal')),
      large: new TierArray(renderer, 'large', 1, maxLayers('large')),
    };
    this.request(BLANK_KEY, 'small');
    this.request(BACK_KEY, 'small');
  }

  /** Remember how to load a face key. */
  register(ref: CardRef, faceIndex: 0 | 1): string {
    return this.loader.register(ref, faceIndex);
  }

  /** Pending work (queued, loading or decoded but not uploaded). */
  get pending(): number {
    return this.queue.length + this.inFlight + this.ready.length;
  }

  /** Decoded bytes resident in the cache (DESIGN: at most 400 MB). */
  get bytes(): number {
    return this.lru.bytes;
  }

  /**
   * The best resident texture for `key` at `want` (falling back to smaller tiers), touching it for the LRU and
   * requesting what is missing: the thumbnail always, the wanted tier when bigger.
   */
  use(key: string, want: ImageTier, frame: number): SlotUv | null {
    this.frame = frame;
    const wantI = TIERS.indexOf(want);
    if (key === BACK_KEY && wantI > 1) return this.use(key, 'normal', frame);
    if (!this.lru.get(key, 'small')) this.request(key, 'small');
    if (wantI > 0 && !this.lru.get(key, want)) this.request(key, want);
    for (let i = wantI; i >= 0; i--) {
      const tier = TIERS[i]!;
      const e = this.lru.get(key, tier);
      if (e) {
        this.lru.touch(e, frame);
        return this.arrays[tier].uv(e.slot);
      }
    }
    return null;
  }

  private request(key: string, tier: ImageTier): void {
    const id = `${tier}|${key}`;
    if (this.queued.has(id) || this.failed.has(id) || this.lru.get(key, tier)) return;
    if ((this.blocked.get(id) ?? -1) > this.frame) return;
    this.queued.add(id);
    this.queue.push({ key, tier, load: () => this.loader.load(key, tier) });
    this.drain();
  }

  private drain(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      // Thumbnails first: they are what the table shows at overview zoom.
      let idx = this.queue.findIndex((j) => j.tier === 'small');
      if (idx < 0) idx = 0;
      const job = this.queue.splice(idx, 1)[0]!;
      this.inFlight++;
      job
        .load()
        .then((image) => {
          if (this.disposed) return;
          this.ready.push({ key: job.key, tier: job.tier, image });
          this.onChange();
        })
        .catch(() => {
          this.failed.add(`${job.tier}|${job.key}`);
          this.queued.delete(`${job.tier}|${job.key}`);
        })
        .finally(() => {
          this.inFlight--;
          this.drain();
        });
    }
  }

  /** Upload decoded images into the arrays (bounded per frame). Returns whether anything changed. */
  pump(frame: number): boolean {
    let budget = UPLOAD_BUDGET;
    let changed = false;
    while (this.ready.length && budget > 0) {
      const item = this.ready.shift()!;
      this.queued.delete(`${item.tier}|${item.key}`);
      const pinned = item.tier === 'small';
      const arr = this.arrays[item.tier];
      const bytes = tierBytes(item.tier);
      let slot = arr.alloc();
      if (slot === null && arr.grow()) slot = arr.alloc();
      const room = this.lru.makeRoom(item.tier, bytes, frame, slot === null, pinned);
      for (const e of room.evicted) this.arrays[e.tier].release(e.slot);
      if (!room.ok) {
        this.blocked.set(`${item.tier}|${item.key}`, frame + 30);
        if (slot !== null) arr.release(slot);
        if (item.image instanceof ImageBitmap) item.image.close();
        continue;
      }
      if (slot === null) slot = arr.alloc();
      if (slot === null) continue;
      arr.upload(slot, item.image);
      if (item.image instanceof ImageBitmap) item.image.close();
      const entry: CacheEntry = { key: item.key, tier: item.tier, bytes, pinned, lastDrawn: frame, slot };
      this.lru.add(entry);
      budget -= bytes;
      changed = true;
    }
    if (changed) for (const t of TIERS) this.arrays[t].finish();
    return changed;
  }

  textures(): [THREE.DataArrayTexture, THREE.DataArrayTexture, THREE.DataArrayTexture] {
    return [this.arrays.small.texture, this.arrays.normal.texture, this.arrays.large.texture];
  }

  dispose(): void {
    this.disposed = true;
    for (const t of TIERS) this.arrays[t].dispose();
    this.queue = [];
    this.ready = [];
  }
}

/** Fetch and decode a face image off the main thread where the browser can. */
async function decodeUrl(url: string): Promise<CanvasImageSource> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

/**
 * Resolves a face key at a tier to a decodable image: asks the FaceSource for that tier (a real source returns a
 * different image per tier: 146x204, 488x680, 672x936), so a thumbnail never downloads the bigger image and the
 * close-zoom tier is never an upscale. Placeholder drawings do not depend on the tier and are shared between tiers.
 */
export class FaceLoader {
  private bases = new Map<string, HTMLCanvasElement>();
  private refs = new Map<string, { ref: CardRef; faceIndex: 0 | 1 }>();

  constructor(
    private faces: FaceSource,
    private back: TextureSource,
    private decode: (url: string) => Promise<CanvasImageSource> = decodeUrl,
  ) {}

  /** Remember how to load a face key. */
  register(ref: CardRef, faceIndex: 0 | 1): string {
    const key = faceKey(ref, faceIndex);
    if (!this.refs.has(key)) this.refs.set(key, { ref, faceIndex });
    return key;
  }

  async load(key: string, tier: ImageTier): Promise<CanvasImageSource> {
    if (key === BLANK_KEY) return blankCanvas();
    if (key === BACK_KEY) return sourceCanvas(this.back);
    const r = this.refs.get(key);
    if (!r) throw new Error(`unknown face ${key}`);
    const img: FaceImage = await this.faces.faceFor(r.ref, r.faceIndex, tier);
    if (img.kind === 'placeholder') {
      const cached = this.bases.get(key);
      if (cached) return cached;
      const canvas = drawPlaceholderFace(img.face) as HTMLCanvasElement;
      // Keep a few drawn placeholders so the thumbnail and the bigger tiers share one drawing.
      this.bases.set(key, canvas);
      if (this.bases.size > 48) this.bases.delete(this.bases.keys().next().value!);
      return canvas;
    }
    return this.decode(img.url);
  }
}

function blankCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 146;
  c.height = 204;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ececea';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function sourceCanvas(src: TextureSource): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  if (ctx) src.draw(ctx, src.width, src.height);
  return c;
}
