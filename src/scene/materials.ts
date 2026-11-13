/**
 * Materials for the lit pipeline (DESIGN "Themes and rendering": card boxes with thickness, sleeves and tables lit,
 * card faces near-unlit so the printed colours stay; "Card faces are never restyled"; Assets: CC0 PBR maps or
 * procedural canvases). Implemented by M4-P2.
 *
 * One shared three.js material per distinct MaterialSpec, reference counted: a theme `get`s what it needs and
 * `release`s it on dispose; the last release disposes the material and the textures only it used, so a theme
 * switch leaves no GPU textures behind (PLAN M4-P2). Texture maps are shared by source too.
 *
 * Card faces: `cardFace` returns a material that samples the face and multiplies it by at most `shade` (≤
 * CARD_FACE_MAX_SHADE) of darkening from the key light's angle, never tinting it and never tone-mapped. The table
 * scene draws faces after post-processing (scene/post.ts), so no bloom, vignette or tone mapping reaches them.
 * Geometry UVs of lit surfaces are in millimetres when a spec gives `tileMm` (the map repeats every tileMm).
 */
import * as THREE from 'three';
import { CARD_FACE_MAX_SHADE, type CardDressing, type MaterialMap, type MaterialSpec } from '../themes/types';
import type { MaterialLibrary } from './types';

/**
 * The light that may shade card faces by up to their `shade`, in three's world space (x = table x, y = up,
 * z = -table y): a direction toward the light, or a position. null: faces stay unlit.
 */
export type KeyLight = { kind: 'direction'; x: number; y: number; z: number } | { kind: 'position'; x: number; y: number; z: number };

/** The key light as a shader uniform: xyz plus w = 0 direction, 1 position, -1 none. */
export function keyLightUniform(light: KeyLight | null, out = new THREE.Vector4()): THREE.Vector4 {
  if (!light) return out.set(0, 1, 0, -1);
  return out.set(light.x, light.y, light.z, light.kind === 'position' ? 1 : 0);
}

/** GLSL: how much light reaches an upward surface at `wp` (0..1); 1 with no key light. */
export const KEY_LIGHT_GLSL = /* glsl */ `
float keyLightFactor(vec4 key, vec3 wp, vec3 n) {
  if (key.w < -0.5) return 1.0;
  vec3 l = key.w > 0.5 ? key.xyz - wp : key.xyz;
  float len = length(l);
  if (len < 1e-5) return 1.0;
  return clamp(dot(n, l / len), 0.0, 1.0);
}
`;

/** A face's shading never exceeds CARD_FACE_MAX_SHADE (PLAN M4-P2: within 3% of the source). */
export const clampShade = (shade: number): number => (Number.isFinite(shade) ? Math.min(CARD_FACE_MAX_SHADE, Math.max(0, shade)) : 0);

const FACE_VERT = /* glsl */ `
uniform vec4 uKeyLight;
varying vec2 vUv;
varying float vLight;
${KEY_LIGHT_GLSL}
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vLight = keyLightFactor(uKeyLight, wp.xyz, n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FACE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uShade;
varying vec2 vUv;
varying float vLight;
void main() {
  vec4 c = texture2D(uMap, vUv);
  c.rgb *= 1.0 - uShade * (1.0 - vLight);
  gl_FragColor = c;
#ifdef SP_SRGB_MAP
  #include <colorspace_fragment>
#endif
}
`;

/** Stable JSON of a spec: object keys sorted; a procedural map is identified by its TextureSource id and size. */
export function specKey(spec: MaterialSpec): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(norm);
    const o = v as Record<string, unknown>;
    if (o.kind === 'procedural' && typeof o.source === 'object' && o.source) {
      const s = o.source as { id: string; width: number; height: number };
      return { kind: 'procedural', source: { id: s.id, width: s.width, height: s.height } };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = norm(o[k]);
    return out;
  };
  return JSON.stringify(norm(spec));
}

type MapRole = 'albedo' | 'normal' | 'roughness' | 'ao';

interface TexEntry {
  texture: THREE.Texture;
  refs: number;
}

interface MatEntry {
  key: string;
  material: THREE.Material;
  refs: number;
  textures: string[];
}

/** A MaterialLibrary with the scene's extra controls (anisotropy, the key light, recompiles). */
export interface MaterialLibraryImpl extends MaterialLibrary {
  /** Anisotropic filtering of every map the library owns (quality level). */
  setAnisotropy(samples: number): void;
  /** The light that shades card faces by up to their shade. */
  setKeyLight(light: KeyLight | null): void;
  /** Recompile every live material (after shadows were turned on or off). */
  invalidate(): void;
}

function drawSource(map: Extract<MaterialMap, { kind: 'procedural' }>): THREE.Texture {
  const { source } = map;
  const w = Math.max(1, Math.round(source.width));
  const h = Math.max(1, Math.round(source.height));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) source.draw(ctx, w, h);
  return new THREE.CanvasTexture(canvas as HTMLCanvasElement);
}

/** A material library bound to a renderer (anisotropy, colour space). */
export function createMaterialLibrary(renderer: THREE.WebGLRenderer): MaterialLibraryImpl {
  const mats = new Map<string, MatEntry>();
  const byMaterial = new Map<THREE.Material, MatEntry>();
  const texes = new Map<string, TexEntry>();
  const keyLight = new THREE.Vector4(0, 1, 0, -1);
  let anisotropy = 1;
  const maxAniso = Math.max(1, renderer.capabilities.getMaxAnisotropy());

  function texture(map: MaterialMap, role: MapRole, tileMm: number | undefined): { key: string; texture: THREE.Texture } {
    const id = map.kind === 'procedural' ? `proc:${map.source.id}:${map.source.width}x${map.source.height}` : `file:${map.url}`;
    const key = `${id}|${role}|${tileMm ?? 0}`;
    let e = texes.get(key);
    if (!e) {
      const t = map.kind === 'procedural' ? drawSource(map) : new THREE.TextureLoader().load(map.url);
      t.colorSpace = role === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (tileMm && tileMm > 0) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / tileMm, 1 / tileMm);
      }
      t.anisotropy = anisotropy;
      t.name = key;
      e = { texture: t, refs: 0 };
      texes.set(key, e);
    }
    e.refs++;
    return { key, texture: e.texture };
  }

  function releaseTexture(key: string): void {
    const e = texes.get(key);
    if (!e) return;
    if (--e.refs > 0) return;
    e.texture.dispose();
    texes.delete(key);
  }

  function build(spec: MaterialSpec, used: string[]): THREE.Material {
    const map = (m: MaterialMap | undefined, role: MapRole): THREE.Texture | null => {
      if (!m) return null;
      const t = texture(m, role, spec.tileMm);
      used.push(t.key);
      return t.texture;
    };
    const colour = new THREE.Color(spec.colour);
    if (spec.model === 'unlit') {
      return new THREE.MeshBasicMaterial({ color: colour, map: map(spec.maps?.albedo, 'albedo') });
    }
    const params: THREE.MeshStandardMaterialParameters = {
      color: colour,
      roughness: spec.roughness,
      metalness: spec.metalness,
      map: map(spec.maps?.albedo, 'albedo'),
      normalMap: map(spec.maps?.normal, 'normal'),
      roughnessMap: map(spec.maps?.roughness, 'roughness'),
      aoMap: map(spec.maps?.ao, 'ao'),
    };
    if (spec.normalScale !== undefined) params.normalScale = new THREE.Vector2(spec.normalScale, spec.normalScale);
    if (spec.emissive) {
      params.emissive = new THREE.Color(spec.emissive.colour);
      params.emissiveIntensity = spec.emissive.intensity;
    }
    if (spec.model === 'physical') return new THREE.MeshPhysicalMaterial({ ...params, clearcoat: spec.clearcoat ?? 0 });
    return new THREE.MeshStandardMaterial(params);
  }

  function acquire(key: string, make: (used: string[]) => THREE.Material): THREE.Material {
    let e = mats.get(key);
    if (!e) {
      const used: string[] = [];
      const material = make(used);
      material.name = key.length > 80 ? key.slice(0, 80) : key;
      e = { key, material, refs: 0, textures: used };
      mats.set(key, e);
      byMaterial.set(material, e);
    }
    e.refs++;
    return e.material;
  }

  const lib: MaterialLibraryImpl = {
    get(spec) {
      return acquire(`spec:${specKey(spec)}`, (used) => build(spec, used));
    },
    cardFace(map, shade) {
      const s = clampShade(shade);
      return acquire(`face:${map.uuid}:${s}`, () => {
        const m = new THREE.ShaderMaterial({
          vertexShader: FACE_VERT,
          fragmentShader: FACE_FRAG,
          uniforms: { uMap: { value: map }, uShade: { value: s }, uKeyLight: { value: keyLight } },
          transparent: true,
          toneMapped: false,
          fog: false,
          lights: false,
        });
        if (map.colorSpace === THREE.SRGBColorSpace) m.defines = { SP_SRGB_MAP: '' };
        return m;
      });
    },
    cardSides(dressing: CardDressing) {
      const lit = dressing.sleeveMaterial !== null && dressing.sleeveMaterial.model !== 'unlit';
      const sleeve = dressing.sleeveMaterial ?? { model: 'unlit' as const, colour: dressing.sleeve ?? dressing.edge, roughness: 1, metalness: 0 };
      const edge: MaterialSpec = { model: lit ? 'standard' : 'unlit', colour: dressing.edge, roughness: 0.85, metalness: 0 };
      // Card sides are drawn after the table markings (transparent list, opaque look, depth-tested), so a zone hairline
      // never shows on a card's sleeve border; they are keyed apart from theme materials of the same spec.
      const side = (spec: MaterialSpec) =>
        acquire(`side:${specKey(spec)}`, (used) => {
          const m = build(spec, used);
          m.transparent = true;
          m.depthWrite = true;
          return m;
        });
      return { sleeve: side(sleeve), edge: side(edge) };
    },
    release(material) {
      const e = byMaterial.get(material);
      if (!e) return;
      if (--e.refs > 0) return;
      mats.delete(e.key);
      byMaterial.delete(material);
      material.dispose();
      for (const k of e.textures) releaseTexture(k);
    },
    stats() {
      return { materials: mats.size, textures: texes.size };
    },
    setAnisotropy(samples) {
      const n = Math.max(1, Math.min(maxAniso, Math.floor(samples)));
      if (n === anisotropy) return;
      anisotropy = n;
      for (const e of texes.values()) {
        e.texture.anisotropy = n;
        // A file map still loading has no image yet; it uploads with the new value once it arrives.
        if (e.texture.image) e.texture.needsUpdate = true;
      }
    },
    setKeyLight(light) {
      keyLightUniform(light, keyLight);
    },
    invalidate() {
      for (const e of mats.values()) e.material.needsUpdate = true;
    },
    dispose() {
      for (const e of mats.values()) e.material.dispose();
      for (const e of texes.values()) e.texture.dispose();
      mats.clear();
      byMaterial.clear();
      texes.clear();
    },
  };
  return lib;
}
