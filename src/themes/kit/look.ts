/**
 * One table world from a look's description (PLAN Milestone 7, Owner decisions after the first design round: "each look
 * is built as a 3D table world (surface, frame, lighting, card shadows, pile and zone marks) that reads well at every
 * camera tilt"; M7-P1). The three looks differ in what their slabs are made of and how they mark zones, not in how they
 * are built, so they stay comparable in cost and behaviour:
 *
 * - slabs, bottom to top (a board or plinth under a playmat, slab or leather); the top one's top is the table plane
 *   (height 0), covering the layout's table exactly or with a rim, and the ones under it frame it and show their edge
 *   in first person;
 * - baked soft skirts where one slab sits on another (depth without a shadow map);
 * - the look's ornament (Codex's gilt corners);
 * - the marks layer (kit/marks.ts), redrawn on every `setMarks`.
 *
 * The lights are the theme's rig (Theme.lighting, built by the scene); card shadows are the pipeline's contact shadows
 * (Theme.shadows.contact). Nothing animates: `animating()` is false, so a still table draws no frames (PLAN Milestone 7,
 * A0: render on demand), and no part depends on the quality level.
 */
import * as THREE from 'three';
import type { MaterialSpec, SceneContext, SeatColour, TableMarks, ThemeInstance } from '../types';
import { MarksLayer, type MarkStyle } from './marks';
import { Parts, roundedRect, skirtGeometry, skirtMaterial, slabGeometry } from './world';

/** A slab of the world: the table grown by `growMm` on every side, its top at `top` mm, `depth` mm thick. */
export interface WorldSlab {
  name: string;
  spec: MaterialSpec;
  growMm: number;
  radiusMm: number;
  top: number;
  depth: number;
  bevel: number;
  /** The slab's side faces (and bevel) when they differ from its top (Plain's side one step darker than the desk). */
  side?: MaterialSpec;
}

/** A baked soft shadow around the table grown by `growMm`, lying at `at` mm. */
export interface WorldSkirt {
  growMm: number;
  radiusMm: number;
  spreadMm: number;
  opacity: number;
  at: number;
  colour: string;
}

export interface WorldSpec {
  /** Object name prefix (scene graph, tests). */
  name: string;
  /**
   * The colours the world shows on screen (docs/design/m8/m7-adjustments.md, M7-P1: "Surface and surround colours equal
   * the look's `mat` and `frame` tokens"): the table surface, and what frames it (board, plinth, desk). A unit test
   * compares them with src/ui/design/tokens.ts; the looks spec measures them on screen.
   */
  surface: string;
  surround: string;
  /** Bottom to top; the last one is the table surface (top 0). */
  slabs: WorldSlab[];
  skirts: WorldSkirt[];
  marks: MarkStyle;
  seats: readonly SeatColour[];
  /** The look's own ornament for a table of `table` mm. */
  ornament?(parts: Parts, table: { w: number; d: number }): THREE.Object3D[];
}

/** A built world (the instance the theme returns), with handles for tests. */
export interface WorldInstance extends ThemeInstance {
  readonly group: THREE.Group;
  readonly slabs: Readonly<Record<string, THREE.Mesh>>;
  readonly marks: MarksLayer;
  readonly ornament: readonly THREE.Object3D[];
}

export function buildWorld(ctx: SceneContext, spec: WorldSpec): WorldInstance {
  const { w, d } = ctx.table;
  const parts = new Parts(ctx);
  const group = new THREE.Group();
  group.name = `${spec.name}-world`;
  const slabs: Record<string, THREE.Mesh> = {};
  for (const s of spec.slabs) {
    const geo = parts.geometry(slabGeometry(roundedRect(w + 2 * s.growMm, d + 2 * s.growMm, s.radiusMm), s.top, s.depth, s.bevel));
    // ExtrudeGeometry's groups: 0 the top and bottom, 1 the sides and bevel.
    const mesh = new THREE.Mesh(geo, s.side ? [parts.material(s.spec), parts.material(s.side)] : parts.material(s.spec));
    mesh.name = `${spec.name}-${s.name}`;
    mesh.receiveShadow = true;
    mesh.renderOrder = 0;
    slabs[s.name] = mesh;
    group.add(mesh);
  }
  for (const [i, k] of spec.skirts.entries()) {
    const geo = parts.geometry(skirtGeometry(w + 2 * k.growMm, d + 2 * k.growMm, k.radiusMm, k.spreadMm, k.opacity, k.at));
    const mesh = new THREE.Mesh(geo, parts.own(skirtMaterial(k.colour)));
    mesh.name = `${spec.name}-skirt-${i}`;
    mesh.renderOrder = 0;
    group.add(mesh);
  }
  const ornament = spec.ornament?.(parts, ctx.table) ?? [];
  for (const o of ornament) group.add(o);
  const marks = new MarksLayer(parts, spec.marks, spec.seats, spec.name);
  group.add(marks.object);
  ctx.scene.add(group);

  let disposed = false;
  return {
    group,
    slabs,
    marks,
    ornament,
    update() {
      // A still table: no flicker, no particles.
    },
    animating: () => false,
    setQuality() {
      // Nothing here depends on the level; the pipeline drops contact shadows and lowers the pixel ratio itself.
    },
    setMarks(m: TableMarks) {
      if (!disposed) marks.set(m);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      marks.dispose();
      group.removeFromParent();
      group.clear();
      parts.dispose();
    },
  };
}
