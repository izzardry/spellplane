/**
 * Building blocks of the M7 table worlds (PLAN Milestone 7, Owner decisions after the first design round: "each look is
 * built as a 3D table world (surface, frame, lighting, card shadows, pile and zone marks) that reads well at every
 * camera tilt"; M7-P1). Every look composes the same few parts, so the three stay cheap and alike in structure:
 *
 * - slabs: rounded, bevelled boxes (the playmat, the board, the plinth, the desk) whose top is a given height, so the
 *   frame and its edge show in first person and the table top is exactly height 0 where the cards lie;
 * - a soft skirt: a baked contact shadow around a slab, a ring of quads whose vertex alpha falls off (no shadow map);
 * - flat overlays (pile beds, territory panels) drawn just above a surface with a polygon offset, under the scene's
 *   hairlines and labels;
 * - seat glyphs: each seat's shape (themes/types.ts SeatGlyph) in its seat colour, one merged mesh.
 *
 * Geometry is in table millimetres (x right, y away from the viewer, rotations clockwise; scene/math.ts) baked into
 * three's world (x, up, −y), so every object has an identity transform and the runtime can turn the whole group.
 * Everything a build creates is owned by a `Parts` and freed by its `dispose`; materials from the scene's library are
 * released, never disposed here (scene/materials.ts reference counting; PLAN M4-P2: no leaks across theme switches).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rot2 } from '../../scene/math';
import type { MarkRect, MaterialSpec, SceneContext, SeatGlyph } from '../types';

/** Owns the geometries and materials of one build. */
export class Parts {
  private geometries = new Set<THREE.BufferGeometry>();
  private owned = new Set<THREE.Material>();
  private shared: THREE.Material[] = [];

  constructor(private ctx: SceneContext) {}

  /** A lit or unlit material for `spec`: the scene library's shared one, else a plain one of the spec's colour. */
  material(spec: MaterialSpec): THREE.Material {
    if (this.ctx.materials) {
      const m = this.ctx.materials.get(spec);
      this.shared.push(m);
      return m;
    }
    const m = spec.model === 'unlit' ? new THREE.MeshBasicMaterial({ color: spec.colour }) : new THREE.MeshStandardMaterial({ color: spec.colour, roughness: spec.roughness, metalness: spec.metalness });
    this.owned.add(m);
    return m;
  }

  /**
   * A material for a flat overlay on a surface (pile beds, panels, plaques' tops): `spec`'s material with a polygon offset
   * toward the camera and no depth writes, so it never fights the surface under it at any distance. Its maps stay shared.
   */
  overlay(spec: MaterialSpec, order = 1): THREE.Material {
    const m = this.material(spec).clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -order;
    m.polygonOffsetUnits = -4 * order;
    m.depthWrite = false;
    this.owned.add(m);
    return m;
  }

  /** Track a material made here. */
  own<M extends THREE.Material>(m: M): M {
    this.owned.add(m);
    return m;
  }

  geometry<G extends THREE.BufferGeometry>(g: G): G {
    this.geometries.add(g);
    return g;
  }

  /** Free one geometry now (marks redrawn). */
  drop(g: THREE.BufferGeometry): void {
    if (this.geometries.delete(g)) g.dispose();
  }

  /** Free everything this build made and release what it borrowed. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.owned) m.dispose();
    if (this.ctx.materials) for (const m of this.shared) this.ctx.materials.release(m);
    this.geometries.clear();
    this.owned.clear();
    this.shared = [];
  }
}

/** Table mm (x, y) to three's world at height `h`: x, up, −y. */
export const world = (x: number, y: number, h = 0): THREE.Vector3 => new THREE.Vector3(x, h, -y);

/**
 * The outline of a rounded rectangle, w × d with corner radius r, centred at (cx, cy) and turned `rot` degrees clockwise,
 * as table points (counter-clockwise in table space), `seg` points per corner arc.
 */
export function roundedRectPoints(w: number, d: number, r: number, cx = 0, cy = 0, rot = 0, seg = 8): THREE.Vector2[] {
  const rr = Math.max(0, Math.min(r, w / 2, d / 2));
  const hw = w / 2 - rr;
  const hd = d / 2 - rr;
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [
    [hw, -hd, -90],
    [hw, hd, 0],
    [-hw, hd, 90],
    [-hw, -hd, 180],
  ];
  for (const [x, y, start] of corners) {
    const n = rr > 0 ? seg : 1;
    for (let i = 0; i < n; i++) {
      const a = ((start + (90 * i) / Math.max(1, n - 1)) * Math.PI) / 180;
      const [px, py] = rot2(x + Math.cos(a) * rr, y + Math.sin(a) * rr, rot);
      pts.push(new THREE.Vector2(cx + px, cy + py));
    }
  }
  return pts;
}

/** A rounded rectangle as a three Shape in table coordinates. */
export function roundedRect(w: number, d: number, r: number, cx = 0, cy = 0, rot = 0): THREE.Shape {
  return new THREE.Shape(roundedRectPoints(w, d, r, cx, cy, rot));
}

/** A shape's geometry laid flat on the table at height `h` (UVs stay table mm, so tiled maps continue across it). */
export function flatGeometry(shapes: THREE.Shape | THREE.Shape[], h: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapes, 6);
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}

/**
 * A bevelled slab: `shape` extruded `depth` mm down from `top` (table height), its edge rounded by `bevel` within the
 * shape's footprint (the bevel never grows past the outline). UVs in mm on every face.
 */
export function slabGeometry(shape: THREE.Shape, top: number, depth: number, bevel: number): THREE.BufferGeometry {
  const b = Math.max(0, Math.min(bevel, depth / 2 - 0.01));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: b > 0 ? 3 : 0,
    curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  g.translate(0, top - g.boundingBox!.max.y, 0);
  g.computeBoundingBox();
  return g;
}

/**
 * A baked soft shadow around a w × d rounded rectangle (radius r) lying at height `h`: `rings` bands out to `spread`
 * mm whose opacity falls from `opacity` at the edge to 0, smoothly. One draw, no texture, no shadow map.
 */
export function skirtGeometry(w: number, d: number, r: number, spread: number, opacity: number, h: number, rings = 5, seg = 8): THREE.BufferGeometry {
  const outline = (o: number) => roundedRectPoints(w + 2 * o, d + 2 * o, r + o, 0, 0, 0, seg);
  const loops = Array.from({ length: rings + 1 }, (_, k) => outline((spread * k) / rings));
  const n = loops[0]!.length;
  const pos: number[] = [];
  const col: number[] = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    // A soft falloff: 1 − smoothstep, squared toward the outside.
    const a = opacity * (1 - t * t * (3 - 2 * t)) * (1 - 0.35 * t);
    for (const p of loops[k]!) {
      pos.push(p.x, h, -p.y);
      col.push(1, 1, 1, a);
    }
  }
  const index: number[] = [];
  for (let k = 0; k < rings; k++)
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      const c = (k + 1) * n + i;
      const e = (k + 1) * n + ((i + 1) % n);
      index.push(a, c, b, b, c, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The material of a skirt: its colour, alpha from the vertices, drawn after the surface under it without depth writes. */
export function skirtMaterial(colour: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: colour, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, toneMapped: false });
}

/** Line segments (pairs of table points) at height `h`, as one LineSegments geometry. */
export function lineGeometry(points: readonly THREE.Vector2[], h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const p of points) pos.push(p.x, h, -p.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** A closed outline as line segment pairs. */
export function loopSegments(outline: readonly THREE.Vector2[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  outline.forEach((p, i) => out.push(p, outline[(i + 1) % outline.length]!));
  return out;
}

/** A rectangle's outline as table points (no rounding). */
export function rectPoints(r: MarkRect, grow = 0): THREE.Vector2[] {
  return roundedRectPoints(r.w + 2 * grow, r.d + 2 * grow, 0, r.x, r.y, r.rot);
}

/** A regular polygon's points, `n` corners on radius `rad`, the first straight up (+y), turned by `phase` degrees. */
function polygon(n: number, rad: number, phase = 0): THREE.Vector2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((90 - phase - (360 * i) / n) * Math.PI) / 180;
    return new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad);
  }).reverse();
}

/**
 * A seat glyph (themes/types.ts SeatGlyph; DESIGN "Input and interaction design", Accessibility: seat colours are paired
 * with a shape, so nothing depends on hue alone) of overall size `s` mm, centred at the origin, pointing to +y.
 */
export function glyphShape(glyph: SeatGlyph, s: number): THREE.Shape {
  const r = s / 2;
  switch (glyph) {
    case 'circle':
      return new THREE.Shape(polygon(28, r));
    case 'square':
      return new THREE.Shape(polygon(4, r * 1.2, 45));
    case 'triangle':
      return new THREE.Shape(polygon(3, r * 1.15));
    case 'diamond':
      return new THREE.Shape(polygon(4, r * 1.15));
    case 'star': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r * 1.1 : r * 0.46;
        const a = ((90 - 36 * i) * Math.PI) / 180;
        pts.push(new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad));
      }
      return new THREE.Shape(pts.reverse());
    }
    case 'hexagon':
      return new THREE.Shape(polygon(6, r * 1.05));
    case 'cross': {
      const a = r * 0.36;
      const b = r;
      const pts = [
        [a, -b],
        [a, -a],
        [b, -a],
        [b, a],
        [a, a],
        [a, b],
        [-a, b],
        [-a, a],
        [-b, a],
        [-b, -a],
        [-a, -a],
        [-a, -b],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.Shape(pts);
    }
    case 'ring': {
      const ring = new THREE.Shape(polygon(28, r));
      ring.holes.push(new THREE.Path(polygon(28, r * 0.55).reverse()));
      return ring;
    }
  }
}

/** Glyphs placed on the table, each in its colour, merged into one geometry with vertex colours at height `h`. */
export function glyphGeometry(glyphs: readonly { glyph: SeatGlyph; size: number; x: number; y: number; rot: number; colour: string }[], h: number): THREE.BufferGeometry | null {
  if (glyphs.length === 0) return null;
  const parts = glyphs.map((g) => {
    const geo = new THREE.ShapeGeometry(glyphShape(g.glyph, g.size), 8);
    geo.rotateZ((-g.rot * Math.PI) / 180);
    geo.translate(g.x, g.y, 0);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h, 0);
    const c = new THREE.Color(g.colour);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    return geo;
  });
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  return merged;
}

/** Merge geometries (all non-indexed with the same attributes) into one, freeing the parts; null for none. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of new Set([...geos, ...flat])) if (g !== merged) g.dispose();
  return merged;
}
