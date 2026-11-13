/**
 * Dusk's table (DESIGN "Themes and rendering", theme table: "Dark felt under a single warm lamp"): a felt cloth the
 * size of the layout's table, with a procedural nap (albedo and normal maps repeating every FELT_TILE_MM, so the
 * cloth keeps its scale at every table size), framed by a dark wooden rail outside the table. Both are lit physically
 * based surfaces; the lamp itself is the theme's light rig (lighting.lights, built by the scene's pipeline), and the
 * contact shadows, bloom and vignette are the pipeline's too. Nothing here animates or depends on the quality level.
 */
import * as THREE from 'three';
import type { MaterialSpec, SceneContext, ThemeInstance } from '../types';
import { FELT_ALBEDO, FELT_NORMAL, FELT_TILE_MM } from './textures';

/** The felt's colour (multiplied by the grey nap of FELT_ALBEDO). */
export const FELT_COLOUR = '#1f4a3e';

/** Width of the wooden rail around the table, mm (outside the layout's table, so it never covers a zone). */
export const RAIL_MM = 46;

/** The felt cloth: rough, matte, a soft nap. */
export const FELT: MaterialSpec = {
  model: 'standard',
  colour: FELT_COLOUR,
  roughness: 0.96,
  metalness: 0,
  tileMm: FELT_TILE_MM,
  normalScale: 0.35,
  maps: { albedo: { kind: 'procedural', source: FELT_ALBEDO }, normal: { kind: 'procedural', source: FELT_NORMAL } },
};

/** The rail: dark oiled wood that catches a little of the lamp. */
export const RAIL: MaterialSpec = { model: 'standard', colour: '#2a1912', roughness: 0.48, metalness: 0 };

/** Object names, for the scene graph and tests. */
export const DUSK_OBJECTS = { felt: 'dusk-felt', rail: 'dusk-rail' } as const;

/** A flat frame around a w × d rectangle, `rail` wide, lying in three's XY plane (UVs in mm). */
function railGeometry(w: number, d: number, rail: number): THREE.ShapeGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const outer = new THREE.Shape();
  outer.moveTo(-hw - rail, -hd - rail);
  outer.lineTo(hw + rail, -hd - rail);
  outer.lineTo(hw + rail, hd + rail);
  outer.lineTo(-hw - rail, hd + rail);
  outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-hw, -hd);
  hole.lineTo(-hw, hd);
  hole.lineTo(hw, hd);
  hole.lineTo(hw, -hd);
  hole.closePath();
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer);
}

/** Build Dusk's table into the scene (Theme.build). */
export function buildDusk(ctx: SceneContext): ThemeInstance {
  const { w, d } = ctx.table;
  const owned: THREE.Material[] = [];
  const material = (spec: MaterialSpec): THREE.Material => {
    if (ctx.materials) return ctx.materials.get(spec);
    // Without the pipeline's library (a surface that gives none): a plain lit material of the spec's colour.
    const m = new THREE.MeshStandardMaterial({ color: spec.colour, roughness: spec.roughness, metalness: spec.metalness });
    owned.push(m);
    return m;
  };

  const feltGeometry = new THREE.PlaneGeometry(w, d);
  // UVs in mm, so the maps repeat every FELT_TILE_MM (scene/materials.ts tileMm).
  const uv = feltGeometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  const feltMaterial = material(FELT);
  const felt = new THREE.Mesh(feltGeometry, feltMaterial);
  felt.name = DUSK_OBJECTS.felt;
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  felt.renderOrder = 0;

  const railGeom = railGeometry(w, d, RAIL_MM);
  const railMaterial = material(RAIL);
  const rail = new THREE.Mesh(railGeom, railMaterial);
  rail.name = DUSK_OBJECTS.rail;
  rail.rotation.x = -Math.PI / 2;
  rail.receiveShadow = true;
  rail.renderOrder = 0;

  ctx.scene.add(felt, rail);
  let disposed = false;
  return {
    update() {
      // A still room: the lamp does not flicker and nothing drifts.
    },
    setQuality() {
      // Nothing of the table depends on the level; the pipeline drops contact shadows and post itself.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctx.scene.remove(felt, rail);
      feltGeometry.dispose();
      railGeom.dispose();
      if (ctx.materials) {
        ctx.materials.release(feltMaterial);
        ctx.materials.release(railMaterial);
      }
      for (const m of owned) m.dispose();
    },
  };
}
