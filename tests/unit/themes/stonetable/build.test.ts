// Stonetable's build in a scene (DESIGN "Themes and rendering": "a theme is a data package that swaps materials,
// lighting, …"; Stonetable: carved stone slab with PBR materials, glowing runes, dust motes in the light; themes switch
// mid-game without reloading; a quality setting drops particles; "Specification: geometry, layout and motion": the
// table plane is height 0 and cards lie on it; Motion: "With reduced motion, all of these are cuts"). Built in Node
// with three's scene graph, a renderer stand-in and the real material library (PLAN M4-P2: no texture leaks).
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMaterialLibrary } from '../../../../src/scene/materials';
import { ThemeRuntime } from '../../../../src/scene/theme-runtime';
import { qualityLevel, type QualityId, type SceneContext } from '../../../../src/themes/index';
import { stonetable } from '../../../../src/themes/stonetable/index';
import { MOTE_CEILING_MM, MOTE_FLOOR_MM, moteCount } from '../../../../src/themes/stonetable/motes';
import { TORCH } from '../../../../src/themes/stonetable/rig';
import { BAND_LIFT_MM, BAND_WIDTH_MM, BAND_INSET_MM, RUNE_GLOW, SLAB_RIM_MM, type StonetableInstance } from '../../../../src/themes/stonetable/table';
import { fakeRenderer } from '../../render/fakes';
import { installRecordingCanvas } from './helpers';

let restore: () => void;
beforeAll(() => (restore = installRecordingCanvas()));
afterAll(() => restore());

const TABLES = [
  { w: 1400, d: 1100 },
  { w: 2000, d: 1300 },
  { w: 1800, d: 1800 },
  { w: 2200, d: 1100 },
];

function context(opts: { table?: { w: number; d: number }; quality?: QualityId; reducedMotion?: boolean; viewerAngle?: number; materials?: boolean } = {}) {
  const renderer = fakeRenderer();
  const scene = new THREE.Scene();
  const materials = createMaterialLibrary(renderer);
  const ctx: SceneContext = {
    renderer,
    scene,
    camera: new THREE.PerspectiveCamera(),
    table: opts.table ?? { w: 1400, d: 1100 },
    quality: qualityLevel(stonetable, opts.quality ?? 'high'),
    reducedMotion: opts.reducedMotion ?? false,
    viewerAngle: opts.viewerAngle ?? 0,
    ...(opts.materials === false ? {} : { materials }),
  };
  return { ctx, scene, materials };
}

const build = (ctx: SceneContext) => stonetable.build(ctx) as StonetableInstance;

function drawables(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) out.push(o);
  });
  return out;
}

function box(o: THREE.Mesh | THREE.Points): THREE.Box3 {
  o.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(o);
}

describe('the slab', () => {
  it.each(TABLES)('covers the %o table with its top flush at height 0 and a rim beyond every edge', (table) => {
    const { ctx } = context({ table });
    const t = build(ctx);
    const b = box(t.slab);
    expect(b.max.y).toBeCloseTo(0, 6);
    expect(b.min.y).toBeLessThan(-20);
    expect(b.max.x).toBeCloseTo(table.w / 2 + SLAB_RIM_MM, 6);
    expect(b.min.x).toBeCloseTo(-table.w / 2 - SLAB_RIM_MM, 6);
    expect(b.max.z).toBeCloseTo(table.d / 2 + SLAB_RIM_MM, 6);
    expect(b.min.z).toBeCloseTo(-table.d / 2 - SLAB_RIM_MM, 6);
    t.dispose();
  });

  it('is lit stone that receives the torch’s shadows, from the procedural PBR maps', () => {
    const { ctx } = context();
    const t = build(ctx);
    expect(t.slab.receiveShadow).toBe(true);
    const m = t.slab.material as THREE.MeshStandardMaterial;
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.map?.name).toContain('stonetable-stone-albedo');
    expect(m.normalMap?.name).toContain('stonetable-stone-normal');
    expect(m.roughnessMap?.name).toContain('stonetable-stone-roughness');
    // One draw call: a single material for the whole box.
    expect(Array.isArray(t.slab.material)).toBe(false);
    t.dispose();
  });

  it('maps its UVs in millimetres, so the grain keeps its size on every table', () => {
    const { ctx } = context({ table: { w: 2200, d: 1100 } });
    const t = build(ctx);
    const g = t.slab.geometry;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    let tops = 0;
    for (let i = 0; i < pos.count; i++) {
      if (nor.getY(i) < 0.5) continue;
      tops++;
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i), 6);
      expect(uv.getY(i)).toBeCloseTo(-pos.getZ(i), 6);
    }
    expect(tops).toBeGreaterThan(0);
    t.dispose();
  });

  it('falls back to a plain stone material where no material library is given (pre-game surfaces before M4-P2)', () => {
    const { ctx, scene } = context({ materials: false });
    const t = build(ctx);
    expect((t.slab.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    t.dispose();
    expect(drawables(scene)).toEqual([]);
  });
});

describe('the rune band', () => {
  it.each(TABLES)('runs around the %o table on the rim, never under a card, just above the stone', (table) => {
    const { ctx } = context({ table });
    const t = build(ctx);
    const pos = t.band.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      const z = Math.abs(pos.getZ(i));
      expect(pos.getY(i)).toBeCloseTo(BAND_LIFT_MM, 6);
      // Outside the table on at least one axis, inside the slab on both.
      expect(x >= table.w / 2 + BAND_INSET_MM - 1e-6 || z >= table.d / 2 + BAND_INSET_MM - 1e-6).toBe(true);
      expect(x).toBeLessThanOrEqual(table.w / 2 + SLAB_RIM_MM);
      expect(z).toBeLessThanOrEqual(table.d / 2 + SLAB_RIM_MM);
    }
    // Four strips, all facing up.
    const g = t.band.geometry.toNonIndexed();
    g.computeVertexNormals();
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeCloseTo(1, 6);
    expect(g.getAttribute('position').count).toBe(4 * 6);
    const b = box(t.band);
    expect(b.max.x).toBeCloseTo(table.w / 2 + BAND_INSET_MM + BAND_WIDTH_MM, 6);
    expect(b.max.z).toBeCloseTo(table.d / 2 + BAND_INSET_MM + BAND_WIDTH_MM, 6);
    t.dispose();
  });

  it('glows (above 1, for the bloom) and breathes slowly, but holds still with reduced motion', () => {
    const moving = context();
    const a = build(moving.ctx);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      a.update(100);
      seen.add(Math.round(a.runeGlow() * 1000));
      expect(a.runeGlow()).toBeGreaterThan(1);
      expect((a.band.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(a.runeGlow(), 6);
    }
    expect(seen.size).toBeGreaterThan(5);
    a.dispose();

    const still = context({ reducedMotion: true });
    const b = build(still.ctx);
    for (let i = 0; i < 20; i++) {
      b.update(100);
      expect(b.runeGlow()).toBe(RUNE_GLOW);
    }
    b.dispose();
  });

  it('repeats its rune texture along the band (wrapping), transparent over the stone', () => {
    const { ctx } = context();
    const t = build(ctx);
    const m = t.band.material as THREE.MeshBasicMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.map!.wrapS).toBe(THREE.RepeatWrapping);
    const uv = t.band.geometry.getAttribute('uv');
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) maxU = Math.max(maxU, uv.getX(i));
    expect(maxU).toBeGreaterThan(1);
    t.dispose();
  });
});

describe('the dust motes', () => {
  it.each(TABLES)('hang over the %o table in the light’s volume, more over bigger tables', (table) => {
    const { ctx } = context({ table });
    const t = build(ctx);
    expect(t.motes.count).toBe(moteCount(table.w, table.d));
    expect(t.motes.count).toBeGreaterThan(100);
    const pos = t.motes.points.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(table.w / 2);
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(table.d / 2);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(MOTE_FLOOR_MM);
      expect(pos.getY(i)).toBeLessThanOrEqual(MOTE_CEILING_MM);
    }
    t.dispose();
  });

  it('are the same cloud on every build (seeded, no randomness)', () => {
    const a = build(context().ctx);
    const b = build(context().ctx);
    expect(Array.from(a.motes.points.geometry.getAttribute('position').array)).toEqual(Array.from(b.motes.points.geometry.getAttribute('position').array));
    a.dispose();
    b.dispose();
  });

  it('glow in the torch’s cone, which follows the viewer’s seat', () => {
    const near = build(context({ viewerAngle: 0 }).ctx);
    const far = build(context({ viewerAngle: 180 }).ctx);
    const pos = (t: StonetableInstance) => t.motes.material.uniforms.uLightPos!.value as THREE.Vector3;
    // Viewer frame (x right, y away, z up) to three's world (x, z up → y, y away → -z), rotated by the seat angle.
    expect(pos(near).x).toBeCloseTo(TORCH.position[0], 3);
    expect(pos(near).y).toBeCloseTo(TORCH.position[2], 3);
    expect(pos(near).z).toBeCloseTo(-TORCH.position[1], 3);
    expect(pos(far).x).toBeCloseTo(-TORCH.position[0], 3);
    expect(pos(far).z).toBeCloseTo(TORCH.position[1], 3);
    expect(near.motes.material.uniforms.uCosOuter!.value).toBeCloseTo(Math.cos((TORCH.angleDeg * Math.PI) / 180), 9);
    near.dispose();
    far.dispose();
  });

  it('drift while time passes, and freeze with reduced motion', () => {
    const moving = build(context().ctx);
    for (let i = 0; i < 10; i++) moving.update(100);
    expect(moving.motes.seconds).toBeCloseTo(1, 6);
    expect(moving.motes.material.uniforms.uTime!.value).toBeCloseTo(1, 6);
    // A long stall (tab in the background) does not fling the motes.
    moving.update(60_000);
    expect(moving.motes.seconds).toBeLessThan(1.3);
    moving.dispose();
    const still = build(context({ reducedMotion: true }).ctx);
    still.update(500);
    expect(still.motes.seconds).toBe(0);
    still.dispose();
  });

  it('are shown only at quality levels with particles, switching without a rebuild', () => {
    const { ctx } = context({ quality: 'low' });
    const t = build(ctx);
    expect(t.motes.points.visible).toBe(false);
    t.setQuality!(qualityLevel(stonetable, 'high'));
    expect(t.motes.points.visible).toBe(true);
    t.setQuality!(qualityLevel(stonetable, 'medium'));
    expect(t.motes.points.visible).toBe(true);
    t.setQuality!(qualityLevel(stonetable, 'low'));
    expect(t.motes.points.visible).toBe(false);
    t.dispose();
  });

  it('blend additively without writing depth (light, not matter)', () => {
    const t = build(context().ctx);
    expect(t.motes.material.blending).toBe(THREE.AdditiveBlending);
    expect(t.motes.material.depthWrite).toBe(false);
    t.dispose();
  });
});

describe('build and dispose', () => {
  it('adds three drawables (slab, band, motes), whatever the table', () => {
    for (const table of TABLES) {
      const { ctx, scene } = context({ table });
      const t = build(ctx);
      expect(drawables(scene).map((o) => o.name).sort()).toEqual(['stonetable-motes', 'stonetable-rune-band', 'stonetable-slab']);
      t.dispose();
    }
  });

  it('removes everything and releases its materials and textures on dispose, ten times over', () => {
    const { ctx, scene, materials } = context();
    for (let i = 0; i < 10; i++) {
      const t = build(ctx);
      expect(materials.stats().materials).toBeGreaterThan(0);
      t.update(16);
      t.dispose();
      expect(drawables(scene)).toEqual([]);
      expect(scene.children).toEqual([]);
      expect(materials.stats()).toEqual({ materials: 0, textures: 0 });
    }
  });

  it('disposes the GPU resources it made itself (band texture, geometries, shader material)', () => {
    const { ctx } = context();
    const t = build(ctx);
    const disposed: string[] = [];
    const watch = (o: { addEventListener(type: 'dispose', fn: () => void): void }, name: string) => o.addEventListener('dispose', () => disposed.push(name));
    watch(t.slab.geometry, 'slab geometry');
    watch(t.band.geometry, 'band geometry');
    watch(t.band.material as THREE.Material, 'band material');
    watch((t.band.material as THREE.MeshBasicMaterial).map!, 'band texture');
    watch(t.motes.points.geometry, 'mote geometry');
    watch(t.motes.material, 'mote material');
    t.dispose();
    expect(disposed.sort()).toEqual(['band geometry', 'band material', 'band texture', 'mote geometry', 'mote material', 'slab geometry']);
  });
});

describe('in the theme runtime (the pipeline M4-P2 built)', () => {
  const placement = { table: { w: 1400, d: 1100 }, viewerAngle: 0, reducedMotion: false };
  const lights = (scene: THREE.Scene) => {
    const out: THREE.Light[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) out.push(o as THREE.Light);
    });
    return out;
  };

  it('lights the slab with the torch casting shadow-map shadows at the best level, and drops them below', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const rt = new ThemeRuntime(renderer, scene, new THREE.PerspectiveCamera(), { post: true, overlay: new THREE.Scene() }, stonetable, placement, 'high');
    const torch = lights(scene).find((l) => (l as THREE.SpotLight).isSpotLight) as THREE.SpotLight;
    expect(torch.castShadow).toBe(true);
    expect(torch.shadow.mapSize.x).toBe(2048);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(rt.post.passes()).toEqual(['render', 'bloom', 'vignette', 'output']);
    // The torch flickers.
    const base = torch.intensity;
    const seen = new Set<number>();
    for (let i = 0; i < 10; i++) {
      rt.update(37);
      seen.add(torch.intensity);
    }
    expect(seen.size).toBeGreaterThan(5);
    for (const v of seen) expect(Math.abs(v - base) / base).toBeLessThanOrEqual(TORCH.flicker!.amplitude + 1e-9);

    rt.setQuality('medium');
    expect(torch.castShadow).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(rt.post.passes()).toEqual(['render', 'bloom', 'vignette', 'output']);
    rt.setQuality('low');
    expect(rt.post.passes()).toEqual([]);
    rt.dispose();
  });

  it('a theme switch away leaves nothing of Stonetable behind', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const rt = new ThemeRuntime(renderer, scene, new THREE.PerspectiveCamera(), { post: true, overlay: new THREE.Scene() }, stonetable, placement, 'high');
    for (let i = 0; i < 3; i++) {
      rt.setTheme({ ...stonetable, build: () => ({ update() {}, dispose() {} }), lighting: { ...stonetable.lighting, lit: false, lights: [] } });
      expect(drawables(scene)).toEqual([]);
      expect(lights(scene)).toEqual([]);
      expect(rt.materials.stats()).toEqual({ materials: 0, textures: 0 });
      rt.setTheme(stonetable);
      expect(drawables(scene)).toHaveLength(3);
    }
    rt.dispose();
  });
});
