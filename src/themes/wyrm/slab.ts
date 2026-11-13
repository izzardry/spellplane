/**
 * Wyrm's table: an obsidian slab with the computed scale relief and ember-lit seams (DESIGN "Themes and rendering",
 * theme table; themes/wyrm/scales.ts). A thick box whose top lies at table height 0, so cards, markings and shadows sit
 * on it as on Paper's plane; its top carries the tile in table millimetres (the scales keep their size on every table),
 * its sides are plain polished obsidian.
 *
 * The material is a MeshStandardMaterial built here rather than through SceneContext.materials, because a MaterialSpec
 * has no emissive map and the seams glow from one. A slow travelling heat wave brightens and dims the seams (a few
 * lines injected into three's standard shader); with reduced motion it stands still. Everything is freed on dispose.
 */
import * as THREE from 'three';
import { scaleMaps, type ScaleMaps } from './scales';

/** Slab thickness below the table top, mm. */
export const SLAB_DEPTH = 40;

/** Seam glow: base emissive intensity, and how far the heat wave swings it either way. */
export const SEAM_GLOW = { intensity: 1.0, swing: 0.5 } as const;

export interface Slab {
  readonly object: THREE.Mesh;
  /** Advance the heat wave to `timeS` seconds. */
  update(timeS: number): void;
  /** The textures this slab owns (tests). */
  readonly textures: readonly THREE.Texture[];
  dispose(): void;
}

function dataTexture(data: Uint8Array, size: number, srgb: boolean, repeat: THREE.Vector2): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.copy(repeat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** GLSL injected into the standard material: a heat wave across the table in world space (mm). */
const WAVE_VERTEX_DECL = /* glsl */ `
varying vec2 vWyrmXZ;
`;
const WAVE_VERTEX = /* glsl */ `
vWyrmXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
`;
const WAVE_FRAGMENT_DECL = /* glsl */ `
uniform float uWyrmTime;
uniform float uWyrmSwing;
varying vec2 vWyrmXZ;
`;
const WAVE_FRAGMENT = /* glsl */ `
{
  vec2 p = vWyrmXZ * 0.004;
  float w = sin(p.x * 1.7 + uWyrmTime * 0.35) * cos(p.y * 1.3 - uWyrmTime * 0.27) + 0.5 * sin((p.x + p.y) * 2.9 - uWyrmTime * 0.6);
  totalEmissiveRadiance *= max(0.0, 1.0 + uWyrmSwing * w);
}
`;

/** Build the slab for a table of `table` mm. */
export function createSlab(table: { w: number; d: number }, maps: ScaleMaps = scaleMaps()): Slab {
  const tile = maps.options.tileMm;
  const n = maps.options.size;
  // BoxGeometry's top face has UVs 0..1 over the whole table: repeat the tile every tileMm.
  const repeat = new THREE.Vector2(table.w / tile, table.d / tile);
  const albedo = dataTexture(maps.albedo, n, true, repeat);
  const normal = dataTexture(maps.normal, n, false, repeat);
  const orm = dataTexture(maps.orm, n, false, repeat);
  const emissive = dataTexture(maps.emissive, n, true, repeat);
  albedo.name = 'wyrm-slab-albedo';
  normal.name = 'wyrm-slab-normal';
  orm.name = 'wyrm-slab-orm';
  emissive.name = 'wyrm-slab-emissive';

  const uniforms = { uWyrmTime: { value: 0 }, uWyrmSwing: { value: SEAM_GLOW.swing } };
  const top = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(1, 1),
    aoMap: orm,
    aoMapIntensity: 1,
    roughnessMap: orm,
    roughness: 1,
    metalnessMap: orm,
    metalness: 1,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: emissive,
    emissiveIntensity: SEAM_GLOW.intensity,
  });
  top.name = 'wyrm-slab-top';
  top.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = WAVE_VERTEX_DECL + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${WAVE_VERTEX}`);
    shader.fragmentShader = WAVE_FRAGMENT_DECL + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WAVE_FRAGMENT}`);
  };
  top.customProgramCacheKey = () => 'wyrm-slab-top';
  const side = new THREE.MeshStandardMaterial({ color: '#120c0b', roughness: 0.25, metalness: 0, emissive: new THREE.Color('#3a0e04'), emissiveIntensity: 0.25 });
  side.name = 'wyrm-slab-side';

  const geometry = new THREE.BoxGeometry(table.w, SLAB_DEPTH, table.d);
  // Box faces: +x, -x, +y (top), -y, +z, -z.
  const mesh = new THREE.Mesh(geometry, [side, side, top, side, side, side]);
  mesh.name = 'wyrm-slab';
  mesh.position.set(0, -SLAB_DEPTH / 2, 0);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;

  const textures = [albedo, normal, orm, emissive];
  return {
    object: mesh,
    textures,
    update(timeS) {
      uniforms.uWyrmTime.value = timeS;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      top.dispose();
      side.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
