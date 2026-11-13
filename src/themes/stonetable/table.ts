/**
 * Stonetable's table (DESIGN "Themes and rendering", Stonetable: "Carved stone slab with PBR materials … Glowing
 * runes … dust motes in the light"). Three draw calls whatever the card count:
 *
 * - the slab: one box of procedural PBR stone (stone.ts), its top flush with the table plane (cards rest at height 0),
 *   reaching SLAB_RIM_MM beyond the table on every side, SLAB_DEPTH_MM thick; it receives the torch's shadows;
 * - the rune band: a glowing strip of carved runes (runes.ts) running around the play area on the rim, slowly
 *   breathing (reduced motion holds it still); bright enough that the bloom pass picks it up;
 * - the dust motes (motes.ts), only at quality levels with particles.
 *
 * UVs are millimetres, so the stone keeps its grain size on every table and the runes their size on every edge.
 */
import * as THREE from 'three';
import { viewerToWorld } from '../../scene/lights';
import type { MaterialSpec, QualityLevel, SceneContext, ThemeInstance } from '../types';
import { DustMotes } from './motes';
import { TORCH } from './rig';
import { BAND_ASPECT, RUNE_BAND } from './runes';
import { STONE_MAPS, STONE_TILE_MM } from './stone';

/** How far the slab reaches beyond the table on every side, mm. */
export const SLAB_RIM_MM = 80;
/** Slab thickness, mm. */
export const SLAB_DEPTH_MM = 70;
/** The rune band: its inner edge this far outside the table edge, and its width, mm. */
export const BAND_INSET_MM = 10;
export const BAND_WIDTH_MM = 46;
/** Height of the band above the slab top, mm (above it, never z-fighting; far below a card's 0.6 mm box). */
export const BAND_LIFT_MM = 0.3;
/** Rune glow multiplier (above 1 so the bloom catches it) and how much it breathes, relative. */
export const RUNE_GLOW = 2.1;
export const RUNE_BREATH = 0.14;
/** Breaths per second. */
export const RUNE_BREATH_HZ = 0.22;

/** The slab's stone (procedural PBR maps; docs/ASSETS.md Stonetable). */
export const SLAB_SPEC: MaterialSpec = {
  model: 'standard',
  colour: '#ffffff',
  roughness: 1,
  metalness: 0,
  maps: {
    albedo: { kind: 'procedural', source: STONE_MAPS.albedo },
    normal: { kind: 'procedural', source: STONE_MAPS.normal },
    roughness: { kind: 'procedural', source: STONE_MAPS.roughness },
  },
  normalScale: 1.1,
  tileMm: STONE_TILE_MM,
};

/** Dust colour: warm, like the torch. */
export const MOTE_COLOUR = '#ffcf94';

/**
 * The slab box: top at height 0, UVs in mm projected along each face's axis (top: table x and y; sides: along the edge
 * and down), so the library's tileMm repeat applies to every face.
 */
export function slabGeometry(table: { w: number; d: number }): THREE.BufferGeometry {
  const w = table.w + 2 * SLAB_RIM_MM;
  const d = table.d + 2 * SLAB_RIM_MM;
  const g = new THREE.BoxGeometry(w, SLAB_DEPTH_MM, d);
  g.translate(0, -SLAB_DEPTH_MM / 2, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, x, -z);
    else if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, -z * Math.sign(nor.getX(i)), y);
    else uv.setXY(i, x * Math.sign(nor.getZ(i)), y);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * The rune band around the table: four strips on the rim (far and near span the corners), at BAND_LIFT_MM. u runs
 * along the strip in band tiles (one tile = BAND_ASPECT band widths), v across it (0 inner edge, 1 outer edge).
 */
export function runeBandGeometry(table: { w: number; d: number }): THREE.BufferGeometry {
  const hw = table.w / 2 + BAND_INSET_MM;
  const hd = table.d / 2 + BAND_INSET_MM;
  const bw = BAND_WIDTH_MM;
  const tile = bw * BAND_ASPECT;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  /** A strip from table point a to b (along its inner edge), growing outward by `out` (unit table vector). */
  const strip = (ax: number, ay: number, bx: number, by: number, ox: number, oy: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const base = positions.length / 3;
    const corners: [number, number, number, number][] = [
      [ax, ay, 0, 0],
      [bx, by, len / tile, 0],
      [bx + ox * bw, by + oy * bw, len / tile, 1],
      [ax + ox * bw, ay + oy * bw, 0, 1],
    ];
    for (const [x, y, u, v] of corners) {
      positions.push(x, BAND_LIFT_MM, -y);
      uvs.push(u, v);
    }
    // Facing up (+y in three's world) whatever the winding of the table points.
    const cross = (bx - ax) * oy - (by - ay) * ox;
    if (cross > 0) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // Far and near strips span the corners; the side strips fit between them.
  strip(-hw - bw, hd, hw + bw, hd, 0, 1);
  strip(hw + bw, -hd, -hw - bw, -hd, 0, -1);
  strip(hw, -hd, hw, hd, 1, 0);
  strip(-hw, hd, -hw, -hd, -1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array<number>(positions.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  return g;
}

/** A canvas texture of a procedural source (DOM canvas or OffscreenCanvas). */
function canvasTexture(src: typeof RUNE_BAND): THREE.CanvasTexture {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(src.width, src.height) : Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) src.draw(ctx, src.width, src.height);
  const t = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.name = src.id;
  return t;
}

/** What a built Stonetable exposes to its own tests (the scene sees only ThemeInstance). */
export interface StonetableInstance extends ThemeInstance {
  readonly slab: THREE.Mesh;
  readonly band: THREE.Mesh;
  readonly motes: DustMotes;
  /** The rune glow multiplier drawn now. */
  runeGlow(): number;
}

/** Build Stonetable into a scene (themes/types.ts Theme.build). */
export function buildStonetable(ctx: SceneContext): StonetableInstance {
  const angle = ctx.viewerAngle ?? 0;
  const table = { w: Math.max(1, ctx.table.w), d: Math.max(1, ctx.table.d) };
  const group = new THREE.Group();
  group.name = 'stonetable';

  // The slab.
  const slabGeo = slabGeometry(table);
  const slabMat = ctx.materials ? ctx.materials.get(SLAB_SPEC) : new THREE.MeshStandardMaterial({ color: '#57524a', roughness: 0.9, metalness: 0 });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.name = 'stonetable-slab';
  slab.receiveShadow = true;
  slab.castShadow = false;
  slab.renderOrder = 0;
  group.add(slab);

  // The rune band.
  const bandGeo = runeBandGeometry(table);
  const bandTex = canvasTexture(RUNE_BAND);
  bandTex.wrapS = THREE.RepeatWrapping;
  bandTex.wrapT = THREE.ClampToEdgeWrapping;
  const maxAniso = Math.max(1, ctx.renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
  const anisotropyFor = (q: QualityLevel) => Math.max(1, Math.min(maxAniso, q.anisotropy ?? 1));
  bandTex.anisotropy = anisotropyFor(ctx.quality);
  const bandMat = new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, depthWrite: false, fog: false });
  bandMat.name = 'stonetable-runes';
  bandMat.color.setScalar(RUNE_GLOW);
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.name = 'stonetable-rune-band';
  band.renderOrder = 1;
  group.add(band);

  // Dust in the torch's cone.
  const torchPos = viewerToWorld(TORCH.position, angle);
  const torchTarget = viewerToWorld(TORCH.target ?? [0, 0, 0], angle);
  const motes = new DustMotes(table, { position: torchPos, target: torchTarget, angleDeg: TORCH.angleDeg }, MOTE_COLOUR, ctx.reducedMotion);
  motes.points.visible = ctx.quality.particles;
  group.add(motes.points);

  ctx.scene.add(group);

  let seconds = 0;
  let glow = RUNE_GLOW;
  return {
    slab,
    band,
    motes,
    runeGlow: () => glow,
    update(dt) {
      if (!ctx.reducedMotion && Number.isFinite(dt) && dt > 0) seconds += Math.min(dt, 250) / 1000;
      glow = RUNE_GLOW * (1 + RUNE_BREATH * Math.sin(2 * Math.PI * RUNE_BREATH_HZ * seconds));
      bandMat.color.setScalar(glow);
      if (motes.points.visible) motes.update(dt, ctx.renderer);
    },
    setQuality(q) {
      motes.points.visible = q.particles;
      const a = anisotropyFor(q);
      if (bandTex.anisotropy !== a) {
        bandTex.anisotropy = a;
        bandTex.needsUpdate = true;
      }
    },
    dispose() {
      group.removeFromParent();
      group.clear();
      slabGeo.dispose();
      if (ctx.materials) ctx.materials.release(slabMat);
      else slabMat.dispose();
      bandGeo.dispose();
      bandMat.dispose();
      bandTex.dispose();
      motes.dispose();
    },
  };
}
