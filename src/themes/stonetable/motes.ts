/**
 * Dust motes in the torchlight (DESIGN "Themes and rendering", Stonetable: "dust motes in the light"). One point cloud,
 * one draw call: motes hang over the slab, drift on slow sine paths and rise a little, wrapping at the top with a fade.
 * They glow only where the torch's cone reaches them, so they read as dust caught in the light. The drift is computed
 * in the vertex shader from a time uniform; reduced motion freezes it (DESIGN: with reduced motion, motion is cut).
 * Positions come from a seeded hash, so the cloud is the same on every build. Additive and depth-tested against the
 * world only: card faces are drawn after the world (scene/post.ts overlay), so a mote never covers a printed face.
 */
import * as THREE from 'three';
import { hash2 } from './stone';

/** Motes per square metre of table, at the high quality level. */
export const MOTES_PER_M2 = 220;
/** Lowest and highest mote height above the table, mm. */
export const MOTE_FLOOR_MM = 25;
export const MOTE_CEILING_MM = 420;
/** Mote diameter in mm (on screen it is clamped to 1..6 px). */
export const MOTE_SIZE_MM = 2.4;
/** Rise speed in mm per second (scaled per mote). */
export const MOTE_RISE_MM_S = 5;

/** Where the motes are lit: the torch's position and aim in three's world space, and its cone's half-angle. */
export interface MoteLight {
  position: THREE.Vector3;
  target: THREE.Vector3;
  angleDeg: number;
}

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uFloor;
uniform float uSpan;
uniform float uRise;
uniform float uSize;
uniform float uViewportH;
uniform vec3 uLightPos;
uniform vec3 uLightDir;
uniform float uCosOuter;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.35 + aSeed.y);
  p.x += sin(t * 0.9 + aSeed.x * 6.2831) * aSeed.z;
  p.z += cos(t * 0.7 + aSeed.x * 4.1) * aSeed.z;
  float h = mod(p.y - uFloor + uTime * uRise * (0.4 + aSeed.y), uSpan);
  p.y = uFloor + h;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 d = normalize(p - uLightPos);
  float beam = smoothstep(uCosOuter, mix(uCosOuter, 1.0, 0.45), dot(d, uLightDir));
  float fade = smoothstep(0.0, 40.0, h) * (1.0 - smoothstep(uSpan - 80.0, uSpan, h));
  vAlpha = aSeed.w * fade * (0.12 + 0.88 * beam);
  gl_PointSize = clamp(uSize * projectionMatrix[1][1] * uViewportH * 0.5 / max(1.0, -mv.z), 1.0, 6.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColour;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = vAlpha * (1.0 - smoothstep(0.15, 0.5, length(c)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColour * a, a);
}
`;

/** Mote count for a table of `w` × `d` mm (never more than 900). */
export function moteCount(w: number, d: number): number {
  return Math.max(0, Math.min(900, Math.round(((w * d) / 1e6) * MOTES_PER_M2)));
}

/** A built cloud of motes. */
export class DustMotes {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  private time = 0;
  private readonly size = new THREE.Vector2();

  constructor(
    table: { w: number; d: number },
    light: MoteLight,
    colour: string,
    private reducedMotion: boolean,
  ) {
    const n = moteCount(table.w, table.d);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (hash2(i, 1, 911) - 0.5) * table.w;
      pos[i * 3 + 1] = MOTE_FLOOR_MM + hash2(i, 2, 911) * (MOTE_CEILING_MM - MOTE_FLOOR_MM);
      pos[i * 3 + 2] = (hash2(i, 3, 911) - 0.5) * table.d;
      seed[i * 4] = hash2(i, 4, 911);
      seed[i * 4 + 1] = hash2(i, 5, 911) * 0.6;
      seed[i * 4 + 2] = 6 + hash2(i, 6, 911) * 22;
      seed[i * 4 + 3] = 0.35 + 0.65 * hash2(i, 7, 911);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    // Drift never leaves this box (amplitude ≤ 28 mm), so frustum culling of the whole cloud stays correct.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (MOTE_FLOOR_MM + MOTE_CEILING_MM) / 2, 0), Math.hypot(table.w / 2 + 30, table.d / 2 + 30, MOTE_CEILING_MM));
    const dir = light.target.clone().sub(light.position).normalize();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFloor: { value: MOTE_FLOOR_MM },
        uSpan: { value: MOTE_CEILING_MM - MOTE_FLOOR_MM },
        uRise: { value: MOTE_RISE_MM_S },
        uSize: { value: MOTE_SIZE_MM },
        uViewportH: { value: 900 },
        uLightPos: { value: light.position.clone() },
        uLightDir: { value: dir },
        uCosOuter: { value: Math.cos((light.angleDeg * Math.PI) / 180) },
        uColour: { value: new THREE.Color(colour) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.material.name = 'stonetable-motes';
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'stonetable-motes';
    // Above the table markings, with the card boxes: depth-tested, so a card box in front hides the motes behind it.
    this.points.renderOrder = 3;
  }

  /** Mote count. */
  get count(): number {
    return this.geometry.getAttribute('position').count;
  }

  /** Seconds of drift so far (frozen with reduced motion). */
  get seconds(): number {
    return this.time;
  }

  /** Advance the drift by `dtMs` and follow the drawing buffer's height (point size in px). */
  update(dtMs: number, renderer: Pick<THREE.WebGLRenderer, 'getDrawingBufferSize'> | null): void {
    if (!this.reducedMotion && Number.isFinite(dtMs) && dtMs > 0) this.time += Math.min(dtMs, 250) / 1000;
    this.material.uniforms.uTime!.value = this.time;
    if (renderer) this.material.uniforms.uViewportH!.value = Math.max(1, renderer.getDrawingBufferSize(this.size).y);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
