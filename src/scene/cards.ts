/**
 * All cards as one instanced mesh (DESIGN "Themes and rendering", Renderer: cards are instanced quads, boxes in themes
 * with thickness). Each instance samples its face from one of the three tier arrays (atlas.ts) by layer and slot
 * rectangle, so every card on the table costs one draw call together. Rounded corners (3 mm) and the hover/selection
 * outline are drawn in the fragment shader; instances are painted in buffer order (draw order), so no depth test is
 * needed.
 * Card faces are never recoloured: the only changes to face pixels are the owner's dimmed view of their own
 * face-down card (DESIGN "Card manipulation", Flip), which blends toward the table colour, and a lit theme's face
 * shade, at most CARD_FACE_MAX_SHADE of darkening from the key light's angle (themes/types.ts CardDressing.faceShade).
 *
 * M4-P2: in themes with thickness, `CardBoxes` draws a rounded box under every face (sleeve border and edges, lit,
 * casting and receiving shadows) and `ContactShadows` a soft shadow under each card; both live in the world scene
 * that is lit and post-processed, while the faces are drawn after post-processing (scene/post.ts). A held card is
 * lifted (CardDressing.held.lift) and tilted toward the drag direction (held.tiltDeg, lit themes).
 */
import * as THREE from 'three';
import type { Pose } from '../core/types';
import type { CardDressing, ShadowSettings } from '../themes/types';
import type { SlotUv } from './atlas';
import { TABLE_FOIL } from './foil';
import { KEY_LIGHT_GLSL } from './materials';
import { CARD_H, CARD_W, DEG } from './math';

/** Outline margin around each quad, mm (must hold the widest highlight). */
const PAD_MM = 2;

/**
 * An outline width in mm that shows at least `minPx` CSS px on a card drawn `cardPx` tall, never wider than the outline
 * slot (PAD_MM); the theme's width when that is wider already or the card is off screen.
 */
export function legibleOutlineMm(mm: number, cardPx: number, minPx: number): number {
  if (!(cardPx > 0)) return mm;
  return Math.min(PAD_MM, Math.max(mm, (minPx * CARD_H) / cardPx));
}

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
  /** Held by the pointer (DESIGN geometry table: lift while dragged); its contact shadow follows it. */
  held?: boolean;
  /** Tilt of a held card: the edge toward table direction (x, y) dips by `deg` (DESIGN geometry table: 4° in lit themes). */
  tilt?: { x: number; y: number; deg: number } | null;
  /**
   * A foil printing shown face up: the hue (0..1) of its foil badge, a small diamond over the card's bottom-left corner
   * (scene/foil.ts TABLE_FOIL); null or absent draws no badge. The sheen rim goes in `highlight`.
   */
  foil?: number | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpAxis = new THREE.Vector3();
const tmpBase = new THREE.Matrix4();
const tmpRot = new THREE.Matrix4();

/**
 * Write the instance matrix of `d` at `o` (16 floats): columns card x axis (scaled for the flip), card y axis, table
 * normal (scaled by `up`), position at height d.z + `lift`. Table (x, y) -> world (x, z, -y). A tilt rotates the card
 * about the horizontal axis across the tilt direction, so the edge toward it dips.
 */
export function cardMatrix(d: CardDraw, m: Float32Array, o: number, lift = 0, up = 1): void {
  const r = d.pose.rot * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
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
  m[o + 9] = up;
  m[o + 10] = 0;
  m[o + 11] = 0;
  m[o + 12] = d.pose.x;
  m[o + 13] = d.z + lift;
  m[o + 14] = -d.pose.y;
  m[o + 15] = 1;
  const t = d.tilt;
  if (!t || !t.deg || (t.x === 0 && t.y === 0)) return;
  // Axis = up × direction (world), so a rotation by +deg moves the leading edge down.
  tmpAxis.set(t.x, 0, -t.y).normalize();
  tmpAxis.crossVectors(UP, tmpAxis).normalize();
  tmpBase.fromArray(m, o);
  tmpBase.setPosition(0, 0, 0);
  tmpRot.makeRotationAxis(tmpAxis, t.deg * DEG);
  tmpRot.multiply(tmpBase);
  tmpRot.setPosition(d.pose.x, d.z + lift, -d.pose.y);
  tmpRot.toArray(m, o);
}

const VERT = /* glsl */ `
attribute vec4 aUv;
attribute vec4 aMisc;
attribute vec4 aHi;
uniform vec2 uCard;
uniform float uPad;
uniform vec4 uKeyLight;
varying vec2 vLocal;
varying vec2 vUv;
varying float vLight;
flat varying vec4 vUvRect;
flat varying vec4 vMisc;
flat varying vec4 vHi;
${KEY_LIGHT_GLSL}
void main() {
  vec2 local = position.xy * (uCard + 2.0 * uPad);
  vLocal = local;
  vUv = local / uCard + 0.5;
  vUvRect = aUv;
  vMisc = aMisc;
  vHi = aHi;
  mat4 world = modelMatrix * instanceMatrix;
  vec4 wp = world * vec4(local, 0.0, 1.0);
  vLight = keyLightFactor(uKeyLight, wp.xyz, normalize(mat3(world) * vec3(0.0, 0.0, 1.0)));
  gl_Position = projectionMatrix * viewMatrix * wp;
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
uniform float uShade;
uniform vec3 uFoil;
varying vec2 vLocal;
varying vec2 vUv;
varying float vLight;
flat varying vec4 vUvRect;
flat varying vec4 vMisc;
flat varying vec4 vHi;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
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
  // Near-unlit: the key light may darken the face by at most uShade (≤ CARD_FACE_MAX_SHADE), never tint it.
  c.rgb *= 1.0 - uShade * (1.0 - vLight);
  c.rgb = mix(c.rgb, uBg, vMisc.z);
  // Foil badge (vMisc.w = 1 + hue): a diamond over the bottom-left corner, outlined dark, drawn over the face like a
  // counter badge; the face around it is untouched.
  if (vMisc.w > 0.5) {
    vec2 bp = vLocal - (-uCard * 0.5 + vec2(uFoil.x));
    float bd = (abs(bp.x) + abs(bp.y) - uFoil.y) * 0.70710678;
    float baa = max(fwidth(bd), 1e-4);
    vec3 fill = hsl2rgb(fract(vMisc.w), 0.6, 0.72 + 0.12 * clamp(1.0 - length(bp) / uFoil.y, 0.0, 1.0));
    vec3 badge = mix(fill, vec3(0.08, 0.08, 0.1), smoothstep(-uFoil.z - baa, -uFoil.z + baa, bd));
    c.rgb = mix(c.rgb, badge, 1.0 - smoothstep(-baa, baa, bd));
  }
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
        uShade: { value: 0 },
        uKeyLight: { value: new THREE.Vector4(0, 1, 0, -1) },
        uFoil: { value: new THREE.Vector3(TABLE_FOIL.badge.inset, TABLE_FOIL.badge.radius, TABLE_FOIL.badge.outline) },
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

  /** Face shade (clamped by the caller to CARD_FACE_MAX_SHADE) and the key light it follows (scene/materials.ts keyLightUniform). */
  setShade(shade: number, keyLight: THREE.Vector4): void {
    this.material.uniforms.uShade!.value = shade;
    (this.material.uniforms.uKeyLight!.value as THREE.Vector4).copy(keyLight);
  }

  /** Faces sit on top of the card box: `thickness` mm above the card's height (0 in flat themes). */
  faceLift = 0;

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
      cardMatrix(d, m, i * 16, this.faceLift);
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
      misc[q + 3] = d.foil == null ? 0 : 1 + Math.min(0.999, Math.max(0, d.foil));
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

/** A rounded card box: the card (plus a sleeve margin) extruded by `thickness` mm; groups 0 = top and bottom, 1 = edges. */
export function cardBoxGeometry(thickness: number, margin: number): THREE.BufferGeometry {
  const w = CARD_W + 2 * margin;
  const h = CARD_H + 2 * margin;
  const r = 3 + margin;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 3 });
}

/** Sleeve margin around the printed card in themes with a sleeve, mm: the lit border a sleeve shows around the face. */
export const SLEEVE_MARGIN_MM = 0.8;

/** Settings of the card boxes for one theme and quality level. */
export interface CardBoxSettings {
  /** Card thickness in mm; 0 draws no boxes (flat themes). */
  thickness: number;
  /** Sleeve margin in mm (0 for a bare card). */
  margin: number;
  /** Sleeve (top and bottom) and edge materials, from MaterialLibrary.cardSides. */
  materials: { sleeve: THREE.Material; edge: THREE.Material } | null;
  castShadow: boolean;
  receiveShadow: boolean;
}

/** Card boxes of a theme with thickness (DESIGN "Themes and rendering": "cards with thickness"), one instanced mesh in the lit world. */
export class CardBoxes {
  mesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private capacity = 0;
  private settings: CardBoxSettings = { thickness: 0, margin: 0, materials: null, castShadow: false, receiveShadow: false };

  constructor(private scene: THREE.Scene) {}

  configure(next: CardBoxSettings): void {
    const prev = this.settings;
    this.settings = next;
    if (next.thickness <= 0 || !next.materials) {
      this.drop();
      return;
    }
    if (!this.geometry || prev.thickness !== next.thickness || prev.margin !== next.margin) {
      this.drop();
      this.geometry = cardBoxGeometry(next.thickness, next.margin);
    }
    if (!this.mesh) this.build(Math.max(64, this.capacity));
    const mesh = this.mesh!;
    mesh.material = [next.materials.sleeve, next.materials.edge];
    mesh.castShadow = next.castShadow;
    mesh.receiveShadow = next.receiveShadow;
  }

  get active(): boolean {
    return this.mesh !== null;
  }

  private build(capacity: number): void {
    this.capacity = capacity;
    const mats = this.settings.materials!;
    const mesh = new THREE.InstancedMesh(this.geometry!, [mats.sleeve, mats.edge], capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // After the table markings (renderOrder 1), so hairlines and labels never draw over a card's border.
    mesh.renderOrder = 2;
    mesh.count = 0;
    mesh.name = 'card-boxes';
    mesh.castShadow = this.settings.castShadow;
    mesh.receiveShadow = this.settings.receiveShadow;
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  private drop(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry?.dispose();
    this.geometry = null;
  }

  write(draws: readonly CardDraw[]): void {
    if (!this.mesh) return;
    if (draws.length > this.capacity) {
      let cap = this.capacity;
      while (cap < draws.length) cap *= 2;
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
      this.build(cap);
    }
    const mesh = this.mesh!;
    const m = mesh.instanceMatrix.array as Float32Array;
    draws.forEach((d, i) => cardMatrix(d, m, i * 16));
    mesh.count = draws.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.drop();
  }
}

const SHADOW_VERT = /* glsl */ `
attribute vec2 aShadow;
uniform vec2 uCard;
varying vec2 vLocal;
flat varying vec2 vS;
void main() {
  vec2 local = position.xy * (uCard + 4.0 * aShadow.y);
  vLocal = local;
  vS = aShadow;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
uniform vec2 uCard;
uniform float uRadius;
varying vec2 vLocal;
flat varying vec2 vS;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = sdRoundRect(vLocal, uCard * 0.5, uRadius);
  float a = vS.x * (1.0 - smoothstep(-0.5 * vS.y, 1.5 * vS.y, d));
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

/** Height (mm) under which a card counts as lying on the table for its contact shadow (the bottom card of a pile). */
const ON_TABLE_MM = 0.5;

/**
 * Contact shadow of one card (DESIGN theme table, Dusk: "soft contact shadows"): its opacity fades linearly to 0 at
 * `heightMm` above the table and its blur grows with the height, so a held card's shadow softens as it lifts.
 */
export function contactShadowOf(z: number, contact: NonNullable<ShadowSettings['contact']>): { opacity: number; blur: number } {
  const h = Math.max(0, z);
  const fade = contact.heightMm > 0 ? Math.max(0, 1 - h / contact.heightMm) : h > 0 ? 0 : 1;
  return { opacity: contact.opacity * fade, blur: Math.max(0.1, contact.blurMm + h * 0.5) };
}

/** Soft contact shadows under the cards (ShadowSettings.contact): one instanced quad per card, no textures. */
export class ContactShadows {
  mesh: THREE.InstancedMesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private geometry = new THREE.PlaneGeometry(1, 1);
  private aShadow: THREE.InstancedBufferAttribute | null = null;
  private capacity = 0;
  private contact: NonNullable<ShadowSettings['contact']> | null = null;

  constructor(private scene: THREE.Scene) {}

  configure(contact: ShadowSettings['contact'] | null): void {
    this.contact = contact ?? null;
    if (!this.contact) {
      this.drop();
      return;
    }
    if (!this.mesh) this.build(Math.max(64, this.capacity));
  }

  get active(): boolean {
    return this.mesh !== null;
  }

  private build(capacity: number): void {
    this.capacity = capacity;
    this.material ??= new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { uCard: { value: new THREE.Vector2(CARD_W, CARD_H) }, uRadius: { value: 3 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = this.geometry.clone();
    this.aShadow = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aShadow', this.aShadow);
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Over the table (transparent list), under the table markings and the card boxes.
    mesh.renderOrder = 0.5;
    mesh.count = 0;
    mesh.name = 'contact-shadows';
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  private drop(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.mesh = null;
    this.aShadow = null;
  }

  write(draws: readonly CardDraw[]): void {
    if (!this.mesh || !this.contact) return;
    const casting = draws.filter((d) => d.held || d.z < ON_TABLE_MM);
    if (casting.length > this.capacity) {
      let cap = this.capacity;
      while (cap < casting.length) cap *= 2;
      this.drop();
      this.build(cap);
    }
    const mesh = this.mesh!;
    const m = mesh.instanceMatrix.array as Float32Array;
    const a = this.aShadow!.array as Float32Array;
    casting.forEach((d, i) => {
      const o = i * 16;
      cardMatrix(d.tilt ? { ...d, tilt: null } : d, m, o);
      m[o + 13] = 0.02;
      const s = contactShadowOf(d.z, this.contact!);
      a[i * 2] = s.opacity;
      a[i * 2 + 1] = s.blur;
    });
    mesh.count = casting.length;
    mesh.instanceMatrix.needsUpdate = true;
    this.aShadow!.needsUpdate = true;
  }

  dispose(): void {
    this.drop();
    this.geometry.dispose();
    this.material?.dispose();
    this.material = null;
  }
}

/** The card dressing's box settings for a theme (thickness, sleeve margin); materials and shadows come from the scene. */
export function boxShape(dressing: CardDressing): { thickness: number; margin: number } {
  const thickness = Math.max(0, dressing.thickness);
  return { thickness, margin: thickness > 0 && (dressing.sleeve !== null || dressing.sleeveMaterial !== null) ? SLEEVE_MARGIN_MM : 0 };
}
