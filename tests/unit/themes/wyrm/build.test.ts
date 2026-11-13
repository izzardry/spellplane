// PLAN M4-P4 Wyrm's build in a scene (no WebGL in Node: a renderer stand-in, real three.js objects). DESIGN "Themes and
// rendering": the obsidian slab, ember particles and a heat shimmer on the stack; themes switch mid-game (a build is
// fully disposed); the quality setting drops post-processing before particles; reduced motion stops motion; card faces
// are drawn by the scene after post-processing, so the shimmer is a post pass and never part of a face's material.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { PostPipeline } from '../../../../src/scene/types';
import { qualityLevel, type QualityId, type SceneContext, type ThemeInstance } from '../../../../src/themes/types';
import { wyrmInstances } from '../../../../src/themes/wyrm/debug';
import { EMBER_COUNT, emberSeeds, FROZEN_TIME_S } from '../../../../src/themes/wyrm/embers';
import { wyrm } from '../../../../src/themes/wyrm/index';
import { SHIMMER_FADE_MS, SHIMMER_PASS_ID, shimmerRegion } from '../../../../src/themes/wyrm/shimmer';
import { SLAB_DEPTH } from '../../../../src/themes/wyrm/slab';
import { fakeRenderer, installFakeCanvas } from '../../render/fakes';

let restore: () => void;
beforeAll(() => (restore = installFakeCanvas()));
afterAll(() => restore());

/** A post pipeline that records its theme passes. */
function fakePost() {
  const passes = new Map<string, Pass>();
  const log: string[] = [];
  const post: PostPipeline = {
    active: true,
    configure: () => undefined,
    addPass(id, pass) {
      passes.set(id, pass);
      log.push(`add:${id}`);
    },
    removePass(id) {
      passes.delete(id);
      log.push(`remove:${id}`);
    },
    setSize: () => undefined,
    render: () => undefined,
    passes: () => [...passes.keys()],
    dispose: () => undefined,
  };
  return { post, passes, log };
}

function setup(opts: { quality?: QualityId; reducedMotion?: boolean; post?: boolean; table?: { w: number; d: number } } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 1, 20000);
  // Looking down at the table centre from the near edge (an ego-like view).
  camera.position.set(0, 900, 1100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const p = fakePost();
  const ctx: SceneContext = {
    renderer: fakeRenderer(),
    scene,
    camera,
    table: opts.table ?? { w: 1400, d: 1100 },
    quality: qualityLevel(wyrm, opts.quality ?? 'high'),
    reducedMotion: opts.reducedMotion ?? false,
    viewerAngle: 0,
    ...(opts.post === false ? {} : { post: p.post }),
  };
  const inst = wyrm.build(ctx);
  return { scene, camera, ctx, inst, ...p };
}

const find = (scene: THREE.Scene, name: string) => scene.getObjectByName(name);
const run = (inst: ThemeInstance, ms: number, step = 16) => {
  for (let t = 0; t < ms; t += step) inst.update(step);
};

describe('Wyrm build', () => {
  it('lays an obsidian slab whose top is the table plane, sized to the table, receiving shadows, with embers above it', () => {
    const { scene, inst } = setup({ table: { w: 2000, d: 1300 } });
    const slab = find(scene, 'wyrm-slab') as THREE.Mesh;
    expect(slab).toBeDefined();
    slab.geometry.computeBoundingBox();
    const box = slab.geometry.boundingBox!.clone().translate(slab.position);
    expect(box.max.y).toBeCloseTo(0, 6);
    expect(box.min.y).toBeCloseTo(-SLAB_DEPTH, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(2000, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(1300, 6);
    expect(slab.receiveShadow).toBe(true);
    const top = (slab.material as THREE.Material[])[2] as THREE.MeshStandardMaterial;
    expect(top.normalMap).not.toBeNull();
    expect(top.emissiveMap).not.toBeNull();
    // The tile keeps its size in mm on any table: repeats = table / tile.
    expect(top.map!.repeat.x).toBeCloseTo(2000 / 288, 6);
    expect(top.map!.repeat.y).toBeCloseTo(1300 / 288, 6);
    const embers = find(scene, 'wyrm-embers') as THREE.Points;
    expect(embers.visible).toBe(true);
    expect(embers.geometry.getAttribute('aSeed').count).toBe(EMBER_COUNT);
    inst.dispose();
  });

  it('seeds embers over the table only, the same way every time', () => {
    const table = { w: 1400, d: 1100 };
    const a = emberSeeds(64, table);
    expect(Array.from(a)).toEqual(Array.from(emberSeeds(64, table)));
    for (let i = 0; i < 64; i++) {
      expect(Math.abs(a[i * 4]!)).toBeLessThanOrEqual(table.w / 2);
      expect(Math.abs(a[i * 4 + 1]!)).toBeLessThanOrEqual(table.d / 2);
      expect(a[i * 4 + 3]).toBeGreaterThanOrEqual(0.7);
      expect(a[i * 4 + 3]).toBeLessThanOrEqual(1.3);
    }
  });

  it('lights the heat shimmer over the stack, fades it in and out, and takes the pass out of the chain when it is gone', () => {
    const { inst, log, passes } = setup();
    run(inst, 200);
    expect(passes.size).toBe(0);
    inst.setStackFocus!({ x: 0, y: 0 });
    inst.update(16);
    expect([...passes.keys()]).toEqual([SHIMMER_PASS_ID]);
    let d = wyrmInstances().at(-1)!;
    expect(d.shimmer).toMatchObject({ allowed: true, inChain: true, target: 1, focus: { x: 0, y: 0 } });
    expect(d.shimmer!.strength).toBeGreaterThan(0);
    expect(d.shimmer!.strength).toBeLessThan(1);
    run(inst, SHIMMER_FADE_MS + 50);
    expect(wyrmInstances().at(-1)!.shimmer!.strength).toBe(1);
    // The stack empties: the shimmer fades out where it was, then leaves the chain.
    inst.setStackFocus!(null);
    inst.update(16);
    d = wyrmInstances().at(-1)!;
    expect(d.shimmer!.inChain).toBe(true);
    expect(d.shimmer!.strength).toBeLessThan(1);
    run(inst, SHIMMER_FADE_MS + 50);
    expect(passes.size).toBe(0);
    expect(log).toEqual([`add:${SHIMMER_PASS_ID}`, `remove:${SHIMMER_PASS_ID}`]);
    inst.dispose();
  });

  it('keeps the pass out of the chain while the lane is off screen or behind the camera, and brings it back', () => {
    const { inst, passes } = setup();
    inst.setStackFocus!({ x: 40000, y: 0 });
    run(inst, SHIMMER_FADE_MS + 50);
    expect(passes.size).toBe(0);
    expect(wyrmInstances().at(-1)!.shimmer).toMatchObject({ target: 1, inChain: false });
    inst.setStackFocus!({ x: 0, y: 0 });
    inst.update(16);
    expect(passes.has(SHIMMER_PASS_ID)).toBe(true);
    inst.dispose();
    expect(passes.size).toBe(0);
  });

  it('applies quality levels without a rebuild: medium drops the shimmer at once, low the embers too, high restores both', () => {
    const { scene, inst, passes } = setup();
    const embers = find(scene, 'wyrm-embers')!;
    inst.setStackFocus!({ x: 0, y: 0 });
    run(inst, SHIMMER_FADE_MS + 50);
    expect(passes.has(SHIMMER_PASS_ID)).toBe(true);
    expect(wyrmInstances().at(-1)!.slab.anisotropy).toBe(8);
    inst.setQuality!(qualityLevel(wyrm, 'medium'));
    expect(wyrmInstances().at(-1)!.slab.anisotropy).toBe(4);
    // Gone before the next frame renders, not faded.
    expect(passes.has(SHIMMER_PASS_ID)).toBe(false);
    run(inst, 100);
    expect(passes.has(SHIMMER_PASS_ID)).toBe(false);
    expect(embers.visible).toBe(true);
    inst.setQuality!(qualityLevel(wyrm, 'low'));
    expect(embers.visible).toBe(false);
    expect(wyrmInstances().at(-1)!.embers.count).toBe(0);
    expect(wyrmInstances().at(-1)!.slab.anisotropy).toBe(1);
    // Hidden embers do not advance either.
    const t = wyrmInstances().at(-1)!.embers.time;
    run(inst, 100);
    expect(wyrmInstances().at(-1)!.embers.time).toBe(t);
    inst.setQuality!(qualityLevel(wyrm, 'high'));
    run(inst, SHIMMER_FADE_MS + 50);
    expect(embers.visible).toBe(true);
    expect(passes.has(SHIMMER_PASS_ID)).toBe(true);
    // The same objects: a quality change is not a rebuild.
    expect(find(scene, 'wyrm-embers')).toBe(embers);
    inst.dispose();
  });

  it('with reduced motion keeps the shimmer off and the embers and seams still', () => {
    const { scene, inst, passes } = setup({ reducedMotion: true });
    inst.setStackFocus!({ x: 0, y: 0 });
    run(inst, 1000);
    expect(passes.size).toBe(0);
    const d = wyrmInstances().at(-1)!;
    expect(d.shimmer).toMatchObject({ allowed: false, inChain: false, strength: 0 });
    expect(d.embers.time).toBe(FROZEN_TIME_S);
    expect(d.embers.visible).toBe(true);
    const material = find(scene, 'wyrm-embers') as THREE.Points;
    expect(((material.material as THREE.ShaderMaterial).uniforms.uTime!.value as number)).toBe(FROZEN_TIME_S);
    inst.dispose();
  });

  it('builds without a post pipeline (draft and builder surfaces): embers and slab, no shimmer', () => {
    const { scene, inst } = setup({ post: false });
    inst.setStackFocus!({ x: 0, y: 0 });
    run(inst, 500);
    expect(find(scene, 'wyrm-slab')).toBeDefined();
    expect(wyrmInstances().at(-1)).toMatchObject({ post: false, shimmer: null });
    inst.dispose();
  });

  it('disposes everything it made: objects, geometries, materials, textures, its pass and its debug entry', () => {
    const before = wyrmInstances().length;
    const { scene, inst, passes } = setup();
    expect(wyrmInstances().length).toBe(before + 1);
    inst.setStackFocus!({ x: 0, y: 0 });
    run(inst, 100);
    const disposed = new Set<unknown>();
    const watch = (o: THREE.EventDispatcher<{ dispose: object }>) => o.addEventListener('dispose', () => disposed.add(o));
    const owned: THREE.EventDispatcher<{ dispose: object }>[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      owned.push(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        owned.push(mat);
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) owned.push(v);
      }
    });
    const pass = passes.get(SHIMMER_PASS_ID) as unknown as { material: THREE.Material };
    owned.push(pass.material);
    for (const o of owned) watch(o);
    expect(owned.filter((o) => o instanceof THREE.Texture).length).toBeGreaterThanOrEqual(4);
    inst.dispose();
    expect(scene.children).toEqual([]);
    expect(passes.size).toBe(0);
    for (const o of owned) expect(disposed.has(o), (o as { name?: string }).name ?? String(o)).toBe(true);
    expect(wyrmInstances().length).toBe(before);
  });
});

describe('shimmer region', () => {
  const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 1, 20000);
  camera.position.set(0, 900, 1100);
  camera.lookAt(0, 0, 0);

  it('is centred on the projected lane and wraps it, larger when the camera comes closer', () => {
    const r = shimmerRegion(camera, { x: 0, y: 0 })!;
    const c = new THREE.Vector3(0, 0, 0).project(camera);
    expect(r.centre[0]).toBeCloseTo(c.x * 0.5 + 0.5, 1);
    expect(Math.abs(r.centre[1] - (c.y * 0.5 + 0.5))).toBeLessThan(r.radius[1]);
    // Every corner of the lane (200 × 320, either orientation) lies inside the ellipse.
    for (const [x, y] of [[-100, -160], [100, 160], [-160, 100], [160, -100]] as const) {
      const p = new THREE.Vector3(x, 0, -y).project(camera);
      const q = [(p.x * 0.5 + 0.5 - r.centre[0]) / r.radius[0], (p.y * 0.5 + 0.5 - r.centre[1]) / r.radius[1]];
      expect(Math.hypot(q[0]!, q[1]!)).toBeLessThan(1);
    }
    const near = camera.clone();
    near.position.set(0, 450, 550);
    near.lookAt(0, 0, 0);
    const r2 = shimmerRegion(near, { x: 0, y: 0 })!;
    expect(r2.radius[0]).toBeGreaterThan(r.radius[0]);
  });

  it('is null when the lane is behind the camera or off screen', () => {
    expect(shimmerRegion(camera, { x: 0, y: 5000 })).toBeNull();
    expect(shimmerRegion(camera, { x: 40000, y: 0 })).toBeNull();
  });
});
