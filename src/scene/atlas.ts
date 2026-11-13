/**
 * Card texture arrays (DESIGN "Themes and rendering", Renderer: instanced quads; "Specification: geometry, layout and
 * motion", Texture tiers). One DataArrayTexture per tier; each layer is an atlas page of equally sized slots, so all
 * cards render in a single instanced draw call whatever their faces. Slots are filled by GPU uploads of canvases
 * (copyTextureToTexture), arrays grow by doubling their layer count with a GPU-side copy.
 */
import * as THREE from 'three';
import { IMAGE_TIERS, type ImageTier } from '../data/types';

/** Padding around each image in its slot, px (edge pixels repeated) against mip-map bleeding. */
export const SLOT_PAD = 2;

/** A slot's image rectangle in normalised texture coordinates (origin at the image's top-left) and its layer. */
export interface SlotUv {
  tier: number;
  layer: number;
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

const GRID: Record<ImageTier, { cols: number; rows: number }> = {
  small: { cols: 13, rows: 9 },
  normal: { cols: 4, rows: 3 },
  large: { cols: 3, rows: 2 },
};

/** Slots per atlas page of a tier. */
export const slotsPerLayer = (tier: ImageTier): number => GRID[tier].cols * GRID[tier].rows;

export const TIER_INDEX: Record<ImageTier, number> = { small: 0, normal: 1, large: 2 };

function makeArray(w: number, h: number, depth: number, anisotropy: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(null, w, h, depth);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.mipmapsAutoUpdate = false;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.source.dataReady = false;
  tex.needsUpdate = true;
  return tex;
}

/** One tier's array of atlas pages. */
export class TierArray {
  readonly tier: ImageTier;
  readonly imgW: number;
  readonly imgH: number;
  readonly slotW: number;
  readonly slotH: number;
  readonly cols: number;
  readonly rows: number;
  readonly texW: number;
  readonly texH: number;
  layers: number;
  readonly maxLayers: number;
  texture: THREE.DataArrayTexture;
  private free: number[] = [];
  private next = 0;
  private dirty = false;
  private scratch: HTMLCanvasElement;
  private scratchTex: THREE.Texture;

  constructor(
    private renderer: THREE.WebGLRenderer,
    tier: ImageTier,
    layers: number,
    maxLayers: number,
  ) {
    this.tier = tier;
    this.imgW = IMAGE_TIERS[tier].width;
    this.imgH = IMAGE_TIERS[tier].height;
    this.slotW = this.imgW + 2 * SLOT_PAD;
    this.slotH = this.imgH + 2 * SLOT_PAD;
    this.cols = GRID[tier].cols;
    this.rows = GRID[tier].rows;
    this.texW = this.cols * this.slotW;
    this.texH = this.rows * this.slotH;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const glMax: unknown = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
    this.maxLayers = Math.max(1, Math.min(maxLayers, Number(glMax) || 256));
    this.layers = Math.min(Math.max(1, layers), this.maxLayers);
    this.texture = makeArray(this.texW, this.texH, this.layers, renderer.capabilities.getMaxAnisotropy());
    renderer.initTexture(this.texture);
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.slotW;
    this.scratch.height = this.slotH;
    this.scratchTex = new THREE.Texture(this.scratch);
  }

  get perLayer(): number {
    return this.cols * this.rows;
  }

  get capacity(): number {
    return this.perLayer * this.layers;
  }

  /** Decoded bytes of one slot's image. */
  get slotBytes(): number {
    return this.imgW * this.imgH * 4;
  }

  /** GPU bytes allocated by this array (level 0 only). */
  get allocatedBytes(): number {
    return this.texW * this.texH * 4 * this.layers;
  }

  /** A free slot, or null when the array is full (the caller evicts or grows). */
  alloc(): number | null {
    const s = this.free.pop();
    if (s !== undefined) return s;
    if (this.next < this.capacity) return this.next++;
    return null;
  }

  release(slot: number): void {
    this.free.push(slot);
  }

  /** Bytes of one layer (level 0). */
  get layerBytes(): number {
    return this.texW * this.texH * 4;
  }

  /** Grow to `to` layers (default: double; GPU copy of the old layers). False when it cannot grow. */
  grow(to = this.layers * 2): boolean {
    const layers = Math.min(this.maxLayers, to);
    if (layers <= this.layers) return false;
    const next = makeArray(this.texW, this.texH, layers, this.texture.anisotropy);
    this.renderer.initTexture(next);
    this.renderer.copyTextureToTexture(this.texture, next, new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(this.texW, this.texH, this.layers)), new THREE.Vector3(0, 0, 0));
    this.texture.dispose();
    this.texture = next;
    this.layers = layers;
    this.dirty = true;
    return true;
  }

  uv(slot: number): SlotUv {
    const layer = Math.floor(slot / this.perLayer);
    const i = slot % this.perLayer;
    const col = i % this.cols;
    const row = Math.floor(i / this.cols);
    return {
      tier: TIER_INDEX[this.tier],
      layer,
      u0: (col * this.slotW + SLOT_PAD) / this.texW,
      v0: (row * this.slotH + SLOT_PAD) / this.texH,
      du: this.imgW / this.texW,
      dv: this.imgH / this.texH,
    };
  }

  /** Draw `image` into a slot (stretched to the tier size; edges repeated into the padding). */
  upload(slot: number, image: CanvasImageSource): void {
    const ctx = this.scratch.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.slotW, this.slotH);
    ctx.drawImage(image, 0, 0, this.slotW, this.slotH);
    ctx.drawImage(image, SLOT_PAD, SLOT_PAD, this.imgW, this.imgH);
    const layer = Math.floor(slot / this.perLayer);
    const i = slot % this.perLayer;
    const x = (i % this.cols) * this.slotW;
    const y = Math.floor(i / this.cols) * this.slotH;
    this.renderer.copyTextureToTexture(this.scratchTex, this.texture, null, new THREE.Vector3(x, y, layer));
    this.dirty = true;
  }

  /** Regenerate mip-maps once after a batch of uploads. */
  finish(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const props = this.renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) return;
    this.renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, props.__webglTexture);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.renderer.state.unbindTexture();
  }

  dispose(): void {
    this.texture.dispose();
    this.scratchTex.dispose();
  }
}
