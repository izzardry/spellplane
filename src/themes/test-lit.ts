/**
 * A minimal lit theme for tests only (PLAN M4-P2: the lit pipeline is tested before Dusk, Wyrm and Stonetable land).
 * It turns on everything the pipeline offers at once, harder than any real theme should: a lit procedural table that
 * receives shadows, a shadow-casting key light and a flickering spot, ACES tone mapping with raised exposure, shadow
 * maps and contact shadows, strong bloom with a low threshold, a heavy vignette, a theme pass, card boxes with a lit
 * sleeve and the largest face shade allowed. Loaded only by the render harness (`?harness=render&theme=lit`), never by
 * the app. Added by M4-P2.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { paper } from './paper/index';
import { CARD_FACE_MAX_SHADE, type MaterialSpec, type SceneContext, type Theme, type ThemeId, type ThemeInstance } from './types';

/** The felt-like table map: a procedural canvas, no bundled asset. */
const FELT: MaterialSpec = {
  model: 'standard',
  colour: '#ffffff',
  roughness: 0.9,
  metalness: 0,
  tileMm: 200,
  maps: {
    albedo: {
      kind: 'procedural',
      source: {
        id: 'test-lit-felt',
        width: 64,
        height: 64,
        draw(ctx, w, h) {
          ctx.fillStyle = '#2f4a3a';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#35523f';
          for (let i = 0; i < 64; i++) ctx.fillRect((i * 37) % w, (i * 53) % h, 2, 2);
        },
      },
    },
  },
};

/** What the pipeline handed the lit test theme, for the render harness's tests. */
export const litProbe = {
  builds: 0,
  disposes: 0,
  /** The last build's context: viewer angle, quality level id, reduced motion, and whether post and materials came. */
  last: null as { viewerAngle: number | undefined; quality: string; reducedMotion: boolean; post: boolean; materials: boolean; table: { w: number; d: number } } | null,
  stackFocus: null as { x: number; y: number } | null,
  stackFocusCalls: 0,
};

function buildLit(ctx: SceneContext): ThemeInstance {
  litProbe.builds++;
  litProbe.last = { viewerAngle: ctx.viewerAngle, quality: ctx.quality.id, reducedMotion: ctx.reducedMotion, post: !!ctx.post, materials: !!ctx.materials, table: { ...ctx.table } };
  const geometry = new THREE.PlaneGeometry(ctx.table.w, ctx.table.d);
  // UVs in mm, so the map repeats every tileMm (scene/materials.ts).
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ctx.table.w, uv.getY(i) * ctx.table.d);
  const material = ctx.materials ? ctx.materials.get(FELT) : new THREE.MeshStandardMaterial({ color: '#2f4a3a' });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = 'test-lit-table';
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  ctx.scene.add(plane);
  const pass = new ShaderPass(CopyShader);
  ctx.post?.addPass('test-copy', pass);
  return {
    update() {
      // Static table; the pipeline animates the spot's flicker.
    },
    setStackFocus(at) {
      litProbe.stackFocus = at ? { ...at } : null;
      litProbe.stackFocusCalls++;
    },
    dispose() {
      litProbe.disposes++;
      ctx.scene.remove(plane);
      geometry.dispose();
      if (ctx.materials) ctx.materials.release(material);
      else material.dispose();
      ctx.post?.removePass('test-copy');
      pass.dispose();
    },
  };
}

/** The test theme under a real theme id (ThemeId has no test id); the label says what it is. */
export function litTestTheme(id: ThemeId = 'stonetable'): Theme {
  return {
    ...paper,
    id,
    label: 'Lit test',
    camera: { defaultRig: 'birdseye' },
    build: buildLit,
    tokens: { ...paper.tokens, colours: { ...paper.tokens.colours, surface: '#2f4a3a', bg: '#101410' } },
    cardDressing: {
      ...paper.cardDressing,
      sleeve: '#5a3a22',
      thickness: 0.6,
      // Its own neutral back, so a switch exercises the face texture rebuild (scene/table-scene.ts setTheme).
      back: {
        id: 'test-lit-back',
        width: 146,
        height: 204,
        draw(ctx, w, h) {
          ctx.fillStyle = '#3b2f2a';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#a08060';
          ctx.lineWidth = 6;
          ctx.strokeRect(10, 10, w - 20, h - 20);
        },
      },
      sleeveMaterial: { model: 'physical', colour: '#5a3a22', roughness: 0.4, metalness: 0, clearcoat: 0.6 },
      edge: '#e8e2d0',
      faceShade: CARD_FACE_MAX_SHADE,
      held: { lift: 12, tiltDeg: 4, shadow: true },
    },
    quality: [
      { id: 'high', shadows: true, post: true, particles: true, pixelRatio: 2, shadowMapSize: 2048, anisotropy: 8, msaa: 4 },
      { id: 'medium', shadows: false, post: true, particles: true, pixelRatio: 2, anisotropy: 4, msaa: 0 },
      { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1 },
    ],
    lighting: {
      lit: true,
      lights: [
        { kind: 'ambient', colour: '#ffffff', intensity: 0.35 },
        { kind: 'hemisphere', sky: '#ffe8c8', ground: '#203020', intensity: 0.4 },
        { kind: 'directional', colour: '#ffd9a8', intensity: 2.6, position: [-300, -900, 1400], castShadow: true },
        { kind: 'spot', colour: '#ff9a50', intensity: 1.2, position: [500, -700, 900], angleDeg: 40, penumbra: 0.6, decay: 0, distance: 0, castShadow: false, flicker: { amplitude: 0.15, hz: 1.5 } },
      ],
      toneMapping: 'aces',
      exposure: 1.4,
      background: '#0d100d',
      fog: null,
    },
    shadows: {
      enabled: true,
      map: { type: 'pcfSoft', mapSize: 2048, bias: -0.0005, normalBias: 0.5, radius: 3 },
      contact: { opacity: 0.55, blurMm: 4, heightMm: 40 },
    },
    post: { bloom: { strength: 1.4, radius: 0.7, threshold: 0.1 }, vignette: { darkness: 1.6, offset: 1.1 } },
  };
}
