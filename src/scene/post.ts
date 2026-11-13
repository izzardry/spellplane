/**
 * Post-processing (DESIGN "Themes and rendering", Lighting and post-processing: bloom, vignette, tone mapping), built
 * from three's examples/jsm passes: EffectComposer, RenderPass, UnrealBloomPass, ShaderPass with VignetteShader and
 * OutputPass (tone mapping and the sRGB conversion). Implemented by M4-P2.
 *
 * The chain post-processes the world (table, light, shadows, card boxes, table markings, theme effects). The overlay
 * (card faces, text and lines over the cards) is drawn after it, straight to the canvas without tone mapping, so no
 * pass can recolour a printed card face (DESIGN "Card faces are never restyled"; PLAN M4-P2). Lines and ping rings may
 * be drawn a second time into the bloomed image (`glow`), so they glow on the table while staying crisp on top.
 *
 * Pass order: render, glow (with bloom), bloom (order 100), theme passes (default 500, ascending), vignette (900),
 * output. With post off (quality level or no pass) `render` is a plain renderer.render of the world, then the overlay.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { PostSettings, QualityLevel } from '../themes/types';
import type { PostPipeline } from './types';

/** Order of the built-in passes among theme passes (PostPipeline.addPass). */
export const PASS_ORDER = { bloom: 100, theme: 500, vignette: 900 } as const;

/**
 * GPU memory the chain's two ping-pong targets may take, bytes (PLAN M4 Performance: texture memory under 400 MB,
 * shared with the 400 MB-capped face cache that holds far less with 300 cards on screen). MSAA samples are lowered
 * until both targets fit: on a high-density or very large screen the chain runs without MSAA, where the pixel density
 * already smooths the edges (the card faces and lines drawn over it keep the canvas's own antialiasing).
 */
export const POST_TARGET_BUDGET = 160 * 1024 * 1024;

/** Bytes per pixel of the chain's half-float RGBA targets. */
const BYTES_PER_PIXEL = 8;

/** MSAA samples for a chain of `width` × `height` device pixels: the level's, lowered to fit POST_TARGET_BUDGET. */
export function postSamples(wanted: number, width: number, height: number, maxSamples: number): number {
  const base = Math.max(1, width * height * BYTES_PER_PIXEL);
  // Two targets, each a resolved texture plus `samples` multisampled buffers.
  const fit = Math.floor(POST_TARGET_BUDGET / (2 * base)) - 1;
  const n = Math.min(Math.floor(wanted), maxSamples, fit);
  // A single sample is no antialiasing, only cost.
  return n >= 2 ? n : 0;
}

/** Approximate GPU bytes of the chain: two targets with their MSAA buffers, and the bloom's half-size bright target and mip chain. */
export function postBytes(width: number, height: number, samples: number, bloom: boolean): number {
  const base = width * height * BYTES_PER_PIXEL;
  return Math.round(2 * (1 + samples) * base + (bloom ? base / 4 + (2 * base) / 3 : 0));
}

export interface PostPipelineOptions {
  /** Drawn after the chain straight to the canvas, never post-processed or tone-mapped (card faces, text, lines over cards). */
  overlay?: THREE.Object3D;
  /** Objects drawn a second time into the image that blooms (lines and ping rings), while bloom is on. */
  glow?: () => THREE.Object3D[];
}

/** The pipeline with the scene's extras. */
export interface PostPipelineImpl extends PostPipeline {
  /** Approximate bytes of the chain's render targets (the debug hook's texture memory). */
  textureBytes(): number;
  /** The composer while post runs, else null (tests). */
  readonly composer: EffectComposer | null;
}

/**
 * Least width of a glow source stroke in the chain's device pixels. The bloom finds bright areas in a half-resolution
 * copy of the image, one bilinear sample per 2 × 2 pixels: a thinner antialiased stroke can fall between two sample
 * rows, average under the threshold and not glow at all, depending only on its sub-pixel position (a 3 px Dusk line
 * glowed straight down and vanished from the bloom under Dusk's 10° tilt with MSAA). From 4 px a stroke always covers
 * one sample's 2 × 2 pixels fully, wherever it falls.
 */
export const GLOW_MIN_DEVICE_PX = 4;

/** The glow copy's width of a stroke `widthPx` CSS px wide at device pixel ratio `pixelRatio`, CSS px. */
export function glowWidthPx(widthPx: number, pixelRatio: number): number {
  return Math.max(widthPx, GLOW_MIN_DEVICE_PX / (pixelRatio > 0 ? pixelRatio : 1));
}

const viewportTmp = new THREE.Vector4();
const isLineMaterial = (m: unknown): m is LineMaterial => (m as { isLineMaterial?: boolean } | null)?.isLineMaterial === true;

/**
 * Draws objects into the read buffer without clearing (glow sources for the bloom). Screen-space strokes (fat lines)
 * are drawn at least glowWidthPx wide there; the crisp stroke over the table keeps its own width (the overlay).
 */
class ObjectsPass extends Pass {
  private widened: { material: LineMaterial; width: number }[] = [];

  constructor(
    private objects: () => THREE.Object3D[],
    private camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(read);
    // Fat lines take their width in the viewport's CSS px (LineSegments2 sets its resolution from it); the target is larger by this.
    const pr = read.width / Math.max(1, renderer.getViewport(viewportTmp).z);
    for (const o of this.objects()) {
      if (!o.visible) continue;
      o.traverseVisible((x) => {
        const m = (x as THREE.Mesh).material;
        if (!isLineMaterial(m)) return;
        const width = glowWidthPx(m.linewidth, pr);
        if (width === m.linewidth) return;
        this.widened.push({ material: m, width: m.linewidth });
        m.linewidth = width;
      });
      renderer.render(o, this.camera);
      for (const w of this.widened) w.material.linewidth = w.width;
      this.widened.length = 0;
    }
    renderer.autoClear = autoClear;
  }
}

interface Entry {
  id: string;
  pass: Pass;
  order: number;
  seq: number;
}

/** The scene's post-processing pipeline; with post off it renders directly. */
export function createPostPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: PostPipelineOptions = {}): PostPipelineImpl {
  let settings: PostSettings = { bloom: null, vignette: null };
  let level: QualityLevel | null = null;
  const themePasses = new Map<string, Entry>();
  let seq = 0;
  let composer: EffectComposer | null = null;
  let renderPass: RenderPass | null = null;
  let glowPass: ObjectsPass | null = null;
  let bloom: UnrealBloomPass | null = null;
  let vignette: ShaderPass | null = null;
  let output: OutputPass | null = null;
  let ids: string[] = [];
  let samples = 0;
  const size = { w: 1, h: 1, pr: 1 };
  const device = () => ({ w: Math.max(1, Math.round(size.w * size.pr)), h: Math.max(1, Math.round(size.h * size.pr)) });
  const wantedSamples = () => {
    const d = device();
    return postSamples(level?.msaa ?? 0, d.w, d.h, renderer.capabilities.maxSamples);
  };

  const wanted = (): boolean => !!level?.post && (settings.bloom !== null || settings.vignette !== null || themePasses.size > 0);

  function teardown(): void {
    bloom?.dispose();
    vignette?.dispose();
    output?.dispose();
    glowPass?.dispose();
    renderPass?.dispose();
    composer?.dispose();
    composer = null;
    renderPass = glowPass = bloom = vignette = output = null;
    ids = [];
  }

  function build(): void {
    teardown();
    if (!wanted() || !level) return;
    samples = wantedSamples();
    const d = device();
    const rt = new THREE.WebGLRenderTarget(d.w, d.h, { type: THREE.HalfFloatType, samples });
    rt.texture.name = 'post.rt';
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(size.pr);
    composer.setSize(size.w, size.h);
    renderPass = new RenderPass(scene, camera);
    if (settings.bloom) {
      const b = settings.bloom;
      bloom = new UnrealBloomPass(new THREE.Vector2(size.w * size.pr, size.h * size.pr), b.strength, b.radius, b.threshold);
      if (opts.glow) glowPass = new ObjectsPass(opts.glow, camera);
    }
    if (settings.vignette) {
      vignette = new ShaderPass(VignetteShader);
      vignette.uniforms.offset!.value = settings.vignette.offset;
      vignette.uniforms.darkness!.value = settings.vignette.darkness;
    }
    output = new OutputPass();
    assemble();
  }

  /** Put the passes into the composer in order (no allocation of render targets). */
  function assemble(): void {
    if (!composer || !renderPass || !output) return;
    const middle: Entry[] = [...themePasses.values()];
    if (bloom) middle.push({ id: 'bloom', pass: bloom, order: PASS_ORDER.bloom, seq: -2 });
    if (vignette) middle.push({ id: 'vignette', pass: vignette, order: PASS_ORDER.vignette, seq: -1 });
    middle.sort((a, b) => a.order - b.order || a.seq - b.seq);
    for (const p of [...composer.passes]) composer.removePass(p);
    composer.addPass(renderPass);
    ids = ['render'];
    if (glowPass) {
      composer.addPass(glowPass);
      ids.push('glow');
    }
    for (const e of middle) {
      composer.addPass(e.pass);
      ids.push(e.id);
    }
    composer.addPass(output);
    ids.push('output');
  }

  function renderOverlay(): void {
    if (!opts.overlay) return;
    const toneMapping = renderer.toneMapping;
    const autoClear = renderer.autoClear;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(opts.overlay, camera);
    renderer.autoClear = autoClear;
    renderer.toneMapping = toneMapping;
  }

  const pipeline: PostPipelineImpl = {
    get active() {
      return composer !== null;
    },
    get composer() {
      return composer;
    },
    configure(next, quality) {
      settings = next;
      level = quality;
      build();
    },
    addPass(id, pass, order = PASS_ORDER.theme) {
      themePasses.set(id, { id, pass, order, seq: ++seq });
      if (wanted() && !composer) build();
      else assemble();
    },
    removePass(id) {
      const e = themePasses.get(id);
      if (!e) return;
      themePasses.delete(id);
      if (composer) composer.removePass(e.pass);
      if (!wanted()) teardown();
      else assemble();
    },
    setSize(width, height, pixelRatio) {
      size.w = Math.max(1, Math.round(width));
      size.h = Math.max(1, Math.round(height));
      size.pr = pixelRatio > 0 ? pixelRatio : 1;
      // A size that changes how many MSAA samples fit rebuilds the targets.
      if (composer && wantedSamples() !== samples) build();
      else if (composer) {
        composer.setPixelRatio(size.pr);
        composer.setSize(size.w, size.h);
      }
    },
    render(dt) {
      if (composer) composer.render(dt / 1000);
      else {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
      renderOverlay();
    },
    passes() {
      return composer ? [...ids] : [];
    },
    textureBytes() {
      if (!composer) return 0;
      const d = device();
      return postBytes(d.w, d.h, samples, bloom !== null);
    },
    dispose() {
      teardown();
      themePasses.clear();
    },
  };
  return pipeline;
}
