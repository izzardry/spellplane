/**
 * Drifting ember particles (DESIGN "Themes and rendering", theme table: Wyrm's "drifting ember particles"; "embers ...
 * are shaders"). One THREE.Points draw call: every ember rises from a point on the slab, sways and drifts with a light
 * wind, glows hot then cools and fades, and is reborn elsewhere. The whole motion is computed on the GPU from the time
 * uniform, so a frame costs the CPU one uniform write. Colours are above 1 so the bloom catches them.
 *
 * The quality level turns them on or off (themes/types.ts QualityLevel.particles); reduced motion freezes them in
 * place. Seeds come from a fixed hash, so the field looks the same on every load.
 */
import * as THREE from 'three';
import { hash01 } from './scales';

/** Embers on the table at full quality. */
export const EMBER_COUNT = 180;

/** Ember motion: rise height mm, life s, sway mm, wind mm per life, size mm, pixel size limits. */
export const EMBER_MOTION = { rise: 240, life: 7.5, sway: 14, wind: [36, 22] as const, sizeMm: 2.6, minPx: 1.5, maxPx: 7 } as const;

/** The time embers are frozen at with reduced motion: a moment with most of them visible. */
export const FROZEN_TIME_S = 11.3;

const VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec2 uHalf;
uniform float uViewportH;
varying float vAlpha;
varying float vHeat;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float life = ${EMBER_MOTION.life.toFixed(2)};
  float t = uTime * aSeed.w + aSeed.z * life;
  float cycle = floor(t / life);
  float age = fract(t / life);
  // Reborn somewhere else every cycle, wrapped onto the table.
  vec2 jitter = vec2(h1(aSeed.z * 91.7 + cycle * 13.1), h1(aSeed.z * 47.3 + cycle * 7.9)) - 0.5;
  vec2 base = mod(aSeed.xy + jitter * uHalf + uHalf, 2.0 * uHalf) - uHalf;
  float s = ${EMBER_MOTION.sway.toFixed(2)};
  vec2 sway = vec2(sin(age * 8.2 + aSeed.z * 40.0), cos(age * 5.7 + aSeed.z * 17.0)) * s * age;
  vec2 wind = vec2(${EMBER_MOTION.wind[0].toFixed(2)}, ${EMBER_MOTION.wind[1].toFixed(2)}) * age;
  vec2 xy = base + sway + wind;
  vec3 world = vec3(xy.x, 2.0 + age * ${EMBER_MOTION.rise.toFixed(2)}, -xy.y);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = ${EMBER_MOTION.sizeMm.toFixed(2)} * (0.6 + 0.8 * aSeed.w) * projectionMatrix[1][1] * uViewportH * 0.5 / max(1.0, -mv.z);
  gl_PointSize = clamp(px, ${EMBER_MOTION.minPx.toFixed(2)}, ${EMBER_MOTION.maxPx.toFixed(2)});
  vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.55, 1.0, age));
  vHeat = 1.0 - age * 0.7;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uIntensity;
varying float vAlpha;
varying float vHeat;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = (1.0 - d) * vAlpha;
  vec3 cool = vec3(0.9, 0.16, 0.03);
  vec3 hot = vec3(1.0, 0.62, 0.22);
  gl_FragColor = vec4(mix(cool, hot, vHeat) * uIntensity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Embers {
  readonly object: THREE.Points;
  /** Embers drawn now (0 when off). */
  readonly count: number;
  /** Ember clock in seconds (stands still with reduced motion). */
  readonly time: number;
  setEnabled(on: boolean): void;
  /** Advance by `dtMs`; `viewportH` is the drawing buffer's height in device px. */
  update(dtMs: number, viewportH: number): void;
  dispose(): void;
}

/** The seeds of `count` embers over a table of `table` mm: x, y in mm, phase 0..1, speed 0.7..1.3. Deterministic. */
export function emberSeeds(count: number, table: { w: number; d: number }): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = (hash01(i, 1, 31) - 0.5) * table.w;
    out[i * 4 + 1] = (hash01(i, 2, 31) - 0.5) * table.d;
    out[i * 4 + 2] = hash01(i, 3, 31);
    out[i * 4 + 3] = 0.7 + 0.6 * hash01(i, 4, 31);
  }
  return out;
}

export function createEmbers(table: { w: number; d: number }, opts: { reducedMotion: boolean; count?: number }): Embers {
  const count = opts.count ?? EMBER_COUNT;
  const seeds = emberSeeds(count, table);
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    position[i * 3] = seeds[i * 4]!;
    position[i * 3 + 2] = -seeds[i * 4 + 1]!;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const uniforms = {
    uTime: { value: opts.reducedMotion ? FROZEN_TIME_S : 0 },
    uHalf: { value: new THREE.Vector2(table.w / 2, table.d / 2) },
    uViewportH: { value: 900 },
    uIntensity: { value: 3.2 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'wyrm-embers',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    lights: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'wyrm-embers';
  // Positions move in the shader: never cull on the seed positions.
  points.frustumCulled = false;
  points.renderOrder = 2;
  let enabled = true;
  return {
    object: points,
    get count() {
      return enabled ? count : 0;
    },
    get time() {
      return uniforms.uTime.value;
    },
    setEnabled(on) {
      enabled = on;
      points.visible = on;
    },
    update(dtMs, viewportH) {
      if (viewportH > 0) uniforms.uViewportH.value = viewportH;
      if (!opts.reducedMotion && enabled) uniforms.uTime.value += dtMs / 1000;
    },
    dispose() {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
