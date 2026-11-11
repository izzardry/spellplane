/**
 * All cards as one instanced mesh (DESIGN "Themes and rendering", Renderer: cards are instanced quads). Each instance
 * samples its face from one of the three tier arrays (atlas.ts) by layer and slot rectangle, so every card on the
 * table costs one draw call together. Rounded corners (3 mm) and the hover/selection outline are drawn in the
 * fragment shader; instances are painted in buffer order (draw order), so no depth test is needed.
 * Card faces are never recoloured: the only change to face pixels is the owner's dimmed view of their own
 * face-down card (DESIGN "Card manipulation", Flip), which blends toward the table colour.
 */
import * as THREE from 'three';
import type { Pose } from '../core/types';
import type { SlotUv } from './atlas';
import { CARD_H, CARD_W, DEG } from './math';

/** Outline margin around each quad, mm (must hold the widest highlight). */
const PAD_MM = 2;

export interface CardDraw {
  pose: Pose;
  /** Height above the table, mm (lift while dragged, pile steps). */
  z: number;
  /** Horizontal scale for the flip animation (1 at rest). */
  scaleX: number;
  /** Uniform scale of the whole card, face and outline alike (stack markers, M1-P3); 1 when absent. */
  scale?: number;
  uv: SlotUv | null;
  /** 0 = face as printed; > 0 blends toward the table colour (owner's own face-down card). */
  dim: number;
  /** Outline colour (CSS) and width in mm, or null. */
  highlight: { colour: string; width: number } | null;
}

const VERT = /* glsl */ `
attribute vec4 aUv;
attribute vec4 aMisc;
attribute vec4 aHi;
uniform vec2 uCard;
uniform float uPad;
varying vec2 vLocal;
varying vec2 vUv;
flat varying vec4 vUvRect;
flat varying vec4 vMisc;
flat varying vec4 vHi;
void main() {
  vec2 local = position.xy * (uCard + 2.0 * uPad);
  vLocal = local;
  vUv = local / uCard + 0.5;
  vUvRect = aUv;
  vMisc = aMisc;
  vHi = aHi;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTex0;
uniform sampler2DArray uTex1;
uniform sampler2DArray uTex2;
uniform vec2 uCard;
uniform float uRadius;
uniform vec3 uBg;
varying vec2 vLocal;
varying vec2 vUv;
flat varying vec4 vUvRect;
flat varying vec4 vMisc;
flat varying vec4 vHi;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = sdRoundRect(vLocal, uCard * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-4);
  vec2 tuv = vUvRect.xy + vec2(vUv.x, 1.0 - vUv.y) * vUvRect.zw;
  vec2 gx = dFdx(tuv);
  vec2 gy = dFdy(tuv);
  vec3 coord = vec3(clamp(tuv, vUvRect.xy, vUvRect.xy + vUvRect.zw), vMisc.y);
  vec4 c;
  if (vMisc.x < -0.5) c = vec4(0.925, 0.925, 0.918, 1.0);
  else if (vMisc.x < 0.5) c = textureGrad(uTex0, coord, gx, gy);
  else if (vMisc.x < 1.5) c = textureGrad(uTex1, coord, gx, gy);
  else c = textureGrad(uTex2, coord, gx, gy);
  c.rgb = mix(c.rgb, uBg, vMisc.z);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float ring = vHi.a > 0.0 ? 1.0 - smoothstep(vHi.a - aa, vHi.a + aa, d) : 0.0;
  vec4 col = mix(vec4(vHi.rgb, ring), vec4(c.rgb, 1.0), inside);
  if (col.a < 0.004) discard;
  gl_FragColor = col;
}
`;

const tmpColour = new THREE.Color();

/** A CSS colour as raw sRGB components: the card shader writes texture bytes unconverted, so its colours must be too. */
const rawColour = (css: string) => new THREE.Color().setStyle(css, THREE.LinearSRGBColorSpace);

export class CardLayer {
  mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private geometry = new THREE.PlaneGeometry(1, 1);
  private capacity = 0;
  private aUv!: THREE.InstancedBufferAttribute;
  private aMisc!: THREE.InstancedBufferAttribute;
  private aHi!: THREE.InstancedBufferAttribute;

  constructor(
    private scene: THREE.Scene,
    bg: string,
  ) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTex0: { value: null },
        uTex1: { value: null },
        uTex2: { value: null },
        uCard: { value: new THREE.Vector2(CARD_W, CARD_H) },
        uPad: { value: PAD_MM },
        uRadius: { value: 3 },
        uBg: { value: rawColour(bg) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = this.build(64);
  }

  private build(capacity: number): THREE.InstancedMesh {
    this.capacity = capacity;
    this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aHi = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const geometry = this.geometry.clone();
    geometry.setAttribute('aUv', this.aUv);
    geometry.setAttribute('aMisc', this.aMisc);
    geometry.setAttribute('aHi', this.aHi);
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.count = 0;
    mesh.name = 'cards';
    return mesh;
  }

  setTextures(t: [THREE.Texture, THREE.Texture, THREE.Texture]): void {
    this.material.uniforms.uTex0!.value = t[0];
    this.material.uniforms.uTex1!.value = t[1];
    this.material.uniforms.uTex2!.value = t[2];
  }

  setBackground(bg: string): void {
    (this.material.uniforms.uBg!.value as THREE.Color).copy(rawColour(bg));
  }

  /** Write all instances, in draw order (later instances paint over earlier ones). */
  write(draws: readonly CardDraw[]): void {
    if (draws.length > this.capacity) {
      let cap = this.capacity;
      while (cap < draws.length) cap *= 2;
      const old = this.mesh;
      this.scene.remove(old);
      old.geometry.dispose();
      old.dispose();
      this.mesh = this.build(cap);
      this.scene.add(this.mesh);
    }
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const uv = this.aUv.array as Float32Array;
    const misc = this.aMisc.array as Float32Array;
    const hi = this.aHi.array as Float32Array;
    draws.forEach((d, i) => {
      const r = d.pose.rot * DEG;
      const c = Math.cos(r);
      const s = Math.sin(r);
      // Columns: card x axis (scaled for the flip), card y axis, table normal, position. Table (x, y) -> world (x, z, -y).
      const o = i * 16;
      const k = d.scale ?? 1;
      m[o + 0] = c * d.scaleX * k;
      m[o + 1] = 0;
      m[o + 2] = s * d.scaleX * k;
      m[o + 3] = 0;
      m[o + 4] = s * k;
      m[o + 5] = 0;
      m[o + 6] = -c * k;
      m[o + 7] = 0;
      m[o + 8] = 0;
      m[o + 9] = 1;
      m[o + 10] = 0;
      m[o + 11] = 0;
      m[o + 12] = d.pose.x;
      m[o + 13] = d.z;
      m[o + 14] = -d.pose.y;
      m[o + 15] = 1;
      const q = i * 4;
      if (d.uv) {
        uv[q] = d.uv.u0;
        uv[q + 1] = d.uv.v0;
        uv[q + 2] = d.uv.du;
        uv[q + 3] = d.uv.dv;
        misc[q] = d.uv.tier;
        misc[q + 1] = d.uv.layer;
      } else {
        uv[q] = uv[q + 1] = uv[q + 2] = uv[q + 3] = 0;
        misc[q] = -1;
        misc[q + 1] = 0;
      }
      misc[q + 2] = d.dim;
      misc[q + 3] = 0;
      if (d.highlight) {
        tmpColour.setStyle(d.highlight.colour, THREE.LinearSRGBColorSpace);
        hi[q] = tmpColour.r;
        hi[q + 1] = tmpColour.g;
        hi[q + 2] = tmpColour.b;
        hi[q + 3] = Math.min(PAD_MM, d.highlight.width);
      } else {
        hi[q] = hi[q + 1] = hi[q + 2] = hi[q + 3] = 0;
      }
    });
    this.mesh.count = draws.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aMisc.needsUpdate = true;
    this.aHi.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
