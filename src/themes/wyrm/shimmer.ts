/**
 * Heat shimmer over the stack (DESIGN "Themes and rendering", theme table: Wyrm's "heat shimmer on the stack").
 * A post-processing pass (three's ShaderPass, added through SceneContext.post) that wavers the image in an ellipse
 * around the stack lane while the stack holds items, as if hot air rose from it, and fades in and out over 400 ms.
 *
 * Card faces are never distorted (DESIGN "Card faces are never restyled"): the table scene draws them, with the text and
 * the lines over them, after the post-processing chain (scene/post.ts), so the shimmer only ever moves the slab, the
 * embers and the card boxes' edges behind them; the region also follows the lane, never the whole screen.
 *
 * The region is the screen-space bounding ellipse of a circle around the lane's centre on the table (both lane
 * orientations fit in it), projected with the scene camera each frame, so it follows panning, zoom and the ego rig.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GEOMETRY } from '../../core/geometry';

/** Pass id in the post chain (debug hook RenderStats.passes). */
export const SHIMMER_PASS_ID = 'wyrm-shimmer';

/** Radius on the table around the stack lane's centre that the shimmer covers, mm: the lane's half diagonal and a margin, so the whole lane lies inside in either orientation. */
export const SHIMMER_RADIUS_MM = Math.hypot(GEOMETRY.stackLane.w, GEOMETRY.stackLane.d) / 2 + 20;

/** Fade in and out, ms. */
export const SHIMMER_FADE_MS = 400;

/** Largest displacement in CSS px at full strength. */
export const SHIMMER_AMPLITUDE_PX = 2.4;

/** The shimmer's region in UV space (0..1, y up): centre and the ellipse's half axes. */
export interface ShimmerRegion {
  centre: [number, number];
  radius: [number, number];
}

const scratch = new THREE.Vector3();

/**
 * The screen region over a stack focus `at` (table mm): the bounding ellipse of a ring of `radiusMm` around it and of
 * the same ring raised by a hand's height (the heat rises), in UV. Null when the focus is behind the camera or off
 * screen entirely. Pure apart from three's vector maths.
 */
export function shimmerRegion(camera: THREE.Camera, at: { x: number; y: number }, radiusMm = SHIMMER_RADIUS_MM): ShimmerRegion | null {
  camera.updateMatrixWorld();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const steps = 12;
  for (const z of [0, 60]) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      scratch.set(at.x + Math.cos(a) * radiusMm, z, -(at.y + Math.sin(a) * radiusMm));
      // Behind the camera: a projection would flip; the region is not usable.
      const view = scratch.clone().applyMatrix4(camera.matrixWorldInverse);
      if (view.z >= -1e-3) return null;
      scratch.project(camera);
      const u = scratch.x * 0.5 + 0.5;
      const v = scratch.y * 0.5 + 0.5;
      minX = Math.min(minX, u);
      maxX = Math.max(maxX, u);
      minY = Math.min(minY, v);
      maxY = Math.max(maxY, v);
    }
  }
  if (maxX < 0 || maxY < 0 || minX > 1 || minY > 1) return null;
  return { centre: [(minX + maxX) / 2, (minY + maxY) / 2], radius: [Math.max(1e-4, (maxX - minX) / 2), Math.max(1e-4, (maxY - minY) / 2)] };
}

/** The shimmer shader (three ShaderPass format: tDiffuse in, vUv). */
export const ShimmerShader = {
  name: 'WyrmShimmerShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uCentre: { value: new THREE.Vector2(0.5, 0.5) },
    uRadius: { value: new THREE.Vector2(0.1, 0.1) },
    uStrength: { value: 0 },
    /** UV per CSS px (x, y), times the amplitude in px. */
    uAmp: { value: new THREE.Vector2(0.002, 0.003) },
    /** Device px per UV (x, y), for the wave's spatial frequency. */
    uRes: { value: new THREE.Vector2(1440, 900) },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uCentre;
uniform vec2 uRadius;
uniform float uStrength;
uniform vec2 uAmp;
uniform vec2 uRes;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - uCentre) / uRadius;
  float m = (1.0 - smoothstep(0.45, 1.0, length(q))) * uStrength;
  vec2 uv = vUv;
  float w = 0.0;
  if (m > 0.001) {
    vec2 p = vUv * uRes / 100.0;
    // Waves that rise up the screen and sway sideways, like air over embers.
    w = sin(p.y * 9.0 - uTime * 4.2 + sin(p.x * 5.0 + uTime * 1.3) * 1.6);
    float w2 = sin(p.x * 7.0 + uTime * 2.7 + p.y * 3.0);
    uv += vec2(w * 0.8 + w2 * 0.2, w2 * 0.5 + w * 0.3) * uAmp * m;
  }
  vec4 c = texture2D(tDiffuse, uv);
  // A faint warm haze where the air is hottest.
  c.rgb += vec3(0.035, 0.012, 0.003) * m * (0.7 + 0.3 * w);
  gl_FragColor = c;
}
`,
};

export interface Shimmer {
  readonly pass: ShaderPass;
  /** Current strength 0..1 (fades toward the target). */
  readonly strength: number;
  /** Strength it is fading toward: 1 while allowed and the stack holds items. */
  readonly target: number;
  readonly region: ShimmerRegion | null;
  /** Whether quality and reduced motion allow the shimmer at all. */
  readonly allowed: boolean;
  readonly focus: { x: number; y: number } | null;
  setAllowed(on: boolean): void;
  setFocus(at: { x: number; y: number } | null): void;
  /**
   * Advance by `dtMs`; returns whether the pass should be in the chain (fading or on). `size` is the drawing buffer
   * in device px and `pixelRatio` the device pixel ratio, so the amplitude stays in CSS px.
   */
  update(dtMs: number, camera: THREE.Camera, size: { w: number; h: number }, pixelRatio: number): boolean;
  dispose(): void;
}

export function createShimmer(opts: { allowed: boolean }): Shimmer {
  const pass = new ShaderPass(ShimmerShader);
  pass.material.name = 'wyrm-shimmer';
  const u = pass.uniforms as unknown as {
    uTime: { value: number };
    uCentre: { value: THREE.Vector2 };
    uRadius: { value: THREE.Vector2 };
    uStrength: { value: number };
    uAmp: { value: THREE.Vector2 };
    uRes: { value: THREE.Vector2 };
  };
  let allowed = opts.allowed;
  let focus: { x: number; y: number } | null = null;
  // Where the shimmer fades out after the stack emptied.
  let last: { x: number; y: number } | null = null;
  let strength = 0;
  let region: ShimmerRegion | null = null;
  let time = 0;
  const target = () => (allowed && focus ? 1 : 0);
  return {
    pass,
    get strength() {
      return strength;
    },
    get target() {
      return target();
    },
    get region() {
      return region;
    },
    get allowed() {
      return allowed;
    },
    get focus() {
      return focus;
    },
    setAllowed(on) {
      allowed = on;
      // Turned off by quality or reduced motion: gone at once, no fade.
      if (!on) strength = 0;
    },
    setFocus(at) {
      focus = at ? { x: at.x, y: at.y } : null;
      if (focus) last = focus;
    },
    update(dtMs, camera, size, pixelRatio) {
      time += dtMs / 1000;
      const goal = target();
      const step = dtMs / SHIMMER_FADE_MS;
      strength = goal > strength ? Math.min(goal, strength + step) : Math.max(goal, strength - step);
      const at = focus ?? (strength > 0 ? last : null);
      region = at ? shimmerRegion(camera, at) : null;
      const on = strength > 0 && region !== null;
      if (region) {
        u.uCentre.value.set(region.centre[0], region.centre[1]);
        u.uRadius.value.set(region.radius[0], region.radius[1]);
      }
      const w = Math.max(1, size.w);
      const h = Math.max(1, size.h);
      const pr = pixelRatio > 0 ? pixelRatio : 1;
      u.uAmp.value.set((SHIMMER_AMPLITUDE_PX * pr) / w, (SHIMMER_AMPLITUDE_PX * pr) / h);
      u.uRes.value.set(w / pr, h / pr);
      u.uStrength.value = on ? strength : 0;
      u.uTime.value = time;
      return on;
    },
    dispose() {
      pass.dispose();
    },
  };
}
