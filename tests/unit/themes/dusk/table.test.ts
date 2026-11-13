// Dusk's table build (DESIGN "Themes and rendering": a theme "creates table, lights, environment"; themes switch
// mid-game without reloading, so a theme frees what it built: PLAN M4-P2 "leaks no GPU textures after ten switches").
// The felt covers exactly the layout's table; the rail lies outside it, so it never covers a zone.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../../../../src/scene/types';
import { dusk } from '../../../../src/themes/dusk/index';
import { buildDusk, DUSK_OBJECTS, FELT, RAIL, RAIL_MM } from '../../../../src/themes/dusk/table';
import { FELT_TILE_MM } from '../../../../src/themes/dusk/textures';
import type { MaterialSpec, SceneContext } from '../../../../src/themes/types';

function fakeLibrary(): MaterialLibrary & { live: Map<THREE.Material, number>; specs: MaterialSpec[] } {
  const live = new Map<THREE.Material, number>();
  const specs: MaterialSpec[] = [];
  return {
    live,
    specs,
    get(spec) {
      specs.push(spec);
      const m = new THREE.MeshStandardMaterial({ color: spec.colour });
      live.set(m, 1);
      return m;
    },
    cardFace: () => new THREE.MeshBasicMaterial(),
    cardSides: () => ({ sleeve: new THREE.MeshBasicMaterial(), edge: new THREE.MeshBasicMaterial() }),
    release(m) {
      live.delete(m);
    },
    stats: () => ({ materials: live.size, textures: 0 }),
    dispose: () => live.clear(),
  };
}

function context(table: { w: number; d: number }, materials?: MaterialLibrary): SceneContext {
  return {
    renderer: {} as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    table,
    quality: dusk.quality[0]!,
    reducedMotion: false,
    ...(materials ? { materials } : {}),
    viewerAngle: 0,
  };
}

/** World bounding box of a mesh, in table mm (x, y = -z). */
function tableBox(o: THREE.Object3D): { x0: number; x1: number; y0: number; y1: number; h: number } {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  return { x0: b.min.x, x1: b.max.x, y0: -b.max.z, y1: -b.min.z, h: b.max.y - b.min.y };
}

describe('Dusk’s table', () => {
  for (const table of [
    { w: 1400, d: 1100 },
    { w: 1800, d: 1800 },
    { w: 2200, d: 1100 },
  ]) {
    it(`lays felt over exactly the ${table.w} × ${table.d} table and a flat rail around it`, () => {
      const lib = fakeLibrary();
      const ctx = context(table, lib);
      const inst = buildDusk(ctx);
      const felt = ctx.scene.getObjectByName(DUSK_OBJECTS.felt) as THREE.Mesh;
      const rail = ctx.scene.getObjectByName(DUSK_OBJECTS.rail) as THREE.Mesh;
      expect(felt).toBeDefined();
      expect(rail).toBeDefined();
      const f = tableBox(felt);
      expect([f.x0, f.x1, f.y0, f.y1]).toEqual([-table.w / 2, table.w / 2, -table.d / 2, table.d / 2].map((v) => expect.closeTo(v, 6)));
      expect(f.h).toBeCloseTo(0, 6);
      const r = tableBox(rail);
      expect([r.x0, r.x1, r.y0, r.y1]).toEqual([-table.w / 2 - RAIL_MM, table.w / 2 + RAIL_MM, -table.d / 2 - RAIL_MM, table.d / 2 + RAIL_MM].map((v) => expect.closeTo(v, 6)));
      expect(r.h).toBeCloseTo(0, 6);
      // Every rail triangle lies outside the table.
      const pos = (rail.geometry as THREE.BufferGeometry).getAttribute('position');
      const index = (rail.geometry as THREE.BufferGeometry).getIndex()!;
      for (let i = 0; i < index.count; i += 3) {
        let cx = 0;
        let cy = 0;
        for (let k = 0; k < 3; k++) {
          cx += pos.getX(index.getX(i + k)) / 3;
          cy += pos.getY(index.getX(i + k)) / 3;
        }
        expect(Math.abs(cx) > table.w / 2 - 1e-6 || Math.abs(cy) > table.d / 2 - 1e-6, `triangle ${i / 3} at ${cx},${cy}`).toBe(true);
      }
      // Felt UVs are millimetres, so the nap repeats every FELT_TILE_MM whatever the table size.
      const uv = (felt.geometry as THREE.BufferGeometry).getAttribute('uv');
      let umax = 0;
      let vmax = 0;
      for (let i = 0; i < uv.count; i++) {
        umax = Math.max(umax, uv.getX(i));
        vmax = Math.max(vmax, uv.getY(i));
      }
      expect([umax, vmax]).toEqual([table.w, table.d]);
      expect(FELT.tileMm).toBe(FELT_TILE_MM);
      // The felt receives the contact shadows' light; both are lit physically based surfaces from the library.
      expect(lib.specs).toEqual([FELT, RAIL]);
      inst.dispose();
    });
  }

  it('frees what it built on dispose, once', () => {
    const lib = fakeLibrary();
    const ctx = context({ w: 1400, d: 1100 }, lib);
    const before = ctx.scene.children.length;
    const inst = buildDusk(ctx);
    const geometries = ctx.scene.children.slice(before).map((o) => (o as THREE.Mesh).geometry);
    let disposed = 0;
    for (const g of geometries) g.addEventListener('dispose', () => disposed++);
    expect(lib.live.size).toBe(2);
    inst.dispose();
    expect(ctx.scene.children.length).toBe(before);
    expect(lib.live.size).toBe(0);
    expect(disposed).toBe(2);
    inst.dispose();
    expect(disposed).toBe(2);
  });

  it('builds without the pipeline’s material library and disposes its own materials', () => {
    const ctx = context({ w: 1400, d: 1100 });
    const inst = buildDusk(ctx);
    const meshes = ctx.scene.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
    expect(meshes).toHaveLength(2);
    let disposed = 0;
    for (const m of meshes) (m.material as THREE.Material).addEventListener('dispose', () => disposed++);
    inst.dispose();
    expect(disposed).toBe(2);
  });

  it('applies a quality level without a rebuild and does not animate', () => {
    const ctx = context({ w: 1400, d: 1100 }, fakeLibrary());
    const inst = buildDusk(ctx);
    const snapshot = () => ctx.scene.children.map((o) => `${o.name}:${o.position.toArray().join(',')}:${o.visible}`);
    const a = snapshot();
    expect(inst.setQuality).toBeTypeOf('function');
    for (const q of dusk.quality) inst.setQuality!(q);
    inst.update(16);
    inst.update(1000);
    expect(snapshot()).toEqual(a);
    inst.dispose();
  });
});
