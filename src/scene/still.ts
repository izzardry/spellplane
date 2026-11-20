/**
 * The soft arena still behind Home (journey.md J1; contracts.md Part G "Visual" item 1; owner, 20 Nov 2026: a deck
 * "as present as a blurred-out arena in the background"): one frame of the empty arena in the viewer's look, softened
 * on 2D canvases and handed back small, for the browser to scale up. Never a CSS filter, never a canvas `filter`
 * (Safari: no blur anywhere, docs/design/m8/m7-adjustments.md rulings).
 *
 * 1. The look's world is built without a table state and without marks (no card, no hidden information) by a
 *    temporary renderer, with the camera at the settled pose of tilt 0.35 for seat 0 of the default two-player table
 *    (scene/camera/pose-at.ts poseAtTilt, the rig's own maths), and drawn once.
 * 2. The frame is halved repeatedly on 2D canvases (each step averages 2 × 2 pixels) down to one sixteenth of its
 *    width, box-blurred there three times (radius 2 px, by pixel loops), and returned as a PNG Blob.
 * 3. The renderer, the world's geometries, materials and textures are released at once; the context is counted while
 *    it lives (scene/lifecycle.ts) and lost on purpose afterwards. Without WebGL the promise resolves null.
 */
import * as THREE from 'three';
import { mtgLayout } from '../games/mtg/layout';
import type { Theme } from '../themes/types';
import { basis, poseAtTilt } from './camera/pose';
import { trackContext, untrackContext } from './lifecycle';
import { ThemeRuntime } from './theme-runtime';

/** The tilt the still is drawn at: leaning in, the table in depth (PLAN M8-C HUD and scene seam). */
export const STILL_TILT = 0.35;
/** The still is this fraction of the frame's width (contracts.md Part G: one sixteenth). */
export const STILL_SCALE = 1 / 16;
/** Box blur: radius in px of the small image, and passes (three box passes are close to a Gaussian). */
export const STILL_BLUR = { radius: 2, passes: 3 } as const;
/** The widest frame drawn, CSS px (a 5K backdrop needs no more: it is scaled up soft anyway). */
const MAX_WIDTH = 2560;

export interface ArenaStillOptions {
  /** Width of the drawn frame in px (the backdrop's width); the still is a sixteenth of it. */
  width: number;
  /** Height of the frame; default the window's aspect (16:9 without a window). */
  height?: number;
  /** Tests: receives the unsoftened frame (a 2D canvas) before it is softened. */
  onFrame?: (frame: HTMLCanvasElement) => void;
}

type Canvas2DContext = CanvasRenderingContext2D;

function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Canvas2DContext } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx ? { canvas, ctx } : null;
}

/**
 * One horizontal and one vertical box pass of radius `r` over RGBA pixels (edges clamped), in place. Plain loops over
 * the pixel array: no canvas filter.
 */
export function boxBlur(data: Uint8ClampedArray, w: number, h: number, r: number): void {
  const tmp = new Float32Array(data.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += data[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c]!;
        tmp[(y * w + x) * 4 + c] = s / n;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c]!;
        data[(y * w + x) * 4 + c] = Math.round(s / n);
      }
}

/** Halve `src` by averaging 2 × 2 pixels until it is at most `target` px wide; the last canvas. */
function halveDown(src: HTMLCanvasElement, target: number): HTMLCanvasElement | null {
  let cur = src;
  while (cur.width > target) {
    const w = Math.max(1, Math.ceil(cur.width / 2));
    const h = Math.max(1, Math.ceil(cur.height / 2));
    const from = cur.getContext('2d', { willReadFrequently: true });
    const next = canvas2d(w, h);
    if (!from || !next) return null;
    const a = from.getImageData(0, 0, cur.width, cur.height).data;
    const out = next.ctx.createImageData(w, h);
    const cw = cur.width;
    const ch = cur.height;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let s = 0;
          let k = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const sx = 2 * x + dx;
              const sy = 2 * y + dy;
              if (sx < cw && sy < ch) {
                s += a[(sy * cw + sx) * 4 + c]!;
                k++;
              }
            }
          out.data[(y * w + x) * 4 + c] = Math.round(s / k);
        }
    next.ctx.putImageData(out, 0, 0);
    cur = next.canvas;
  }
  return cur;
}

/** Draw the empty arena of `theme` once and copy it to a 2D canvas; null without WebGL. */
function drawArena(theme: Theme, w: number, h: number): HTMLCanvasElement | null {
  const gl = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  trackContext(renderer);
  let runtime: ThemeRuntime | null = null;
  const scene = new THREE.Scene();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const layout = mtgLayout('1v1');
    const pose = poseAtTilt(STILL_TILT, layout, 's0', { w, h }, theme.camera);
    const angle = layout.seats[0]?.angle ?? 0;
    const camera = new THREE.PerspectiveCamera(pose.fovDeg, w / h, 10, 100000);
    const b = basis(angle, pose.pitchDeg);
    const p = pose.position;
    camera.position.set(p[0], p[2], -p[1]);
    camera.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(b.r[0], b.r[2], -b.r[1]), new THREE.Vector3(b.u[0], b.u[2], -b.u[1]), new THREE.Vector3(-b.d[0], -b.d[2], b.d[1])),
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    runtime = new ThemeRuntime(renderer, scene, camera, { post: false }, theme, { table: layout.table, viewerAngle: angle, reducedMotion: true });
    runtime.setSize(w, h);
    // The runtime may have raised the pixel ratio to the quality level's: one CSS px is one pixel here.
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    runtime.update(0);
    runtime.render(0);
    const out = canvas2d(w, h);
    if (!out) return null;
    out.ctx.drawImage(gl, 0, 0, w, h);
    return out.canvas;
  } catch {
    return null;
  } finally {
    runtime?.dispose();
    // Anything the theme left in the scene (it should leave nothing): released before the renderer.
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
    });
    scene.clear();
    renderer.dispose();
    untrackContext(renderer);
    renderer.forceContextLoss();
  }
}

/**
 * Render the empty arena of `theme` as a soft still: a PNG one sixteenth of `width` wide (the browser scales it up
 * when shown). Resolves null when WebGL or a 2D canvas is unavailable.
 */
export async function renderArenaStill(theme: Theme, opts: ArenaStillOptions): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const w = Math.max(16, Math.min(MAX_WIDTH, Math.round(opts.width)));
  const aspect = typeof innerWidth === 'number' && innerWidth > 0 && innerHeight > 0 ? innerHeight / innerWidth : 9 / 16;
  const h = Math.max(9, Math.round(opts.height ?? w * aspect));
  const frame = drawArena(theme, w, h);
  if (!frame) return null;
  opts.onFrame?.(frame);
  const small = halveDown(frame, Math.max(1, Math.round(w * STILL_SCALE)));
  const ctx = small?.getContext('2d', { willReadFrequently: true });
  if (!small || !ctx) return null;
  const img = ctx.getImageData(0, 0, small.width, small.height);
  for (let i = 0; i < STILL_BLUR.passes; i++) boxBlur(img.data, small.width, small.height, STILL_BLUR.radius);
  ctx.putImageData(img, 0, 0);
  return new Promise<Blob | null>((resolve) => small.toBlob((b) => resolve(b), 'image/png'));
}
