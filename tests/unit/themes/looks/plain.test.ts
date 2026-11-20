// Plain, the fourth look and the default (docs/design/m8/m7-adjustments.md, M7-P1, "The Plain table world"; visual.md
// 2.2: "Unlit materials, no post-processing: Plain must be the cheapest look to draw"; PLAN Milestone 8, M7-P1 Worlds:
// "Plain: halftone texture with a mip chain, zero post passes, a double selection ring"), and what every look's world
// must do now that the landing renders it as a still and tables mount many times a page load: build without a table
// state and without marks, and leave no geometry, material or texture behind on dispose.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectiveQuality } from '../../../../src/scene/quality';
import { createMaterialLibrary } from '../../../../src/scene/materials';
import { ThemeRuntime } from '../../../../src/scene/theme-runtime';
import { LISTED_THEME_IDS, contrastRatio, loadTheme, qualityLevel, type SceneContext, type Theme } from '../../../../src/themes/index';
import type { WorldInstance } from '../../../../src/themes/kit/look';
import { PLAIN_INK, PLAIN_SURFACE, PLAIN_WORLD, SLAB_MM, plain } from '../../../../src/themes/plain/index';
import { DESK_HALFTONE, HALFTONE_DOT_MM, HALFTONE_PITCH_MM, HALFTONE_PX, HALFTONE_TILE_MM, TABLE_HALFTONE } from '../../../../src/themes/plain/textures';
import type { Canvas2D, TextureSource } from '../../../../src/util/texture';
import { fakeRenderer } from '../../render/fakes';
import { installRecordingCanvas, recordingContext } from '../stonetable/helpers';

let restore: () => void;
beforeAll(() => (restore = installRecordingCanvas()));
afterAll(() => restore());

function paint(src: TextureSource): Uint8ClampedArray {
  const { ctx } = recordingContext();
  let data: Uint8ClampedArray = new Uint8ClampedArray(0);
  (ctx as unknown as Record<string, unknown>).putImageData = (img: { data: Uint8ClampedArray }) => {
    data = img.data;
  };
  src.draw(ctx as Canvas2D, src.width, src.height);
  return data;
}

/** Mean red channel over the whole image, then after averaging 2 × 2 blocks k times (a box-filtered mip level). */
function mipMeans(data: Uint8ClampedArray, n: number): number[] {
  let cur = Float64Array.from({ length: n * n }, (_, i) => data[i * 4]!);
  let size = n;
  const means: number[] = [];
  while (size >= 1) {
    means.push(cur.reduce((a, v) => a + v, 0) / cur.length);
    if (size === 1) break;
    const half = size / 2;
    const next = new Float64Array(half * half);
    for (let y = 0; y < half; y++)
      for (let x = 0; x < half; x++) next[y * half + x] = (cur[2 * y * size + 2 * x]! + cur[2 * y * size + 2 * x + 1]! + cur[(2 * y + 1) * size + 2 * x]! + cur[(2 * y + 1) * size + 2 * x + 1]!) / 4;
    cur = next;
    size = half;
  }
  return means;
}

function context(theme: Theme) {
  const renderer = fakeRenderer();
  const scene = new THREE.Scene();
  const materials = createMaterialLibrary(renderer);
  const ctx: SceneContext = { renderer, scene, camera: new THREE.PerspectiveCamera(), table: { w: 1400, d: 1100 }, quality: qualityLevel(theme, 'high'), reducedMotion: false, viewerAngle: 0, materials };
  return { ctx, scene, materials };
}

describe('Plain’s halftone', () => {
  it('paints the same tile every time, white paper with dots at 5 % (table) and 3 % (desk) ink', () => {
    for (const [src, ink] of [
      [TABLE_HALFTONE, 0.05],
      [DESK_HALFTONE, 0.03],
    ] as const) {
      const a = paint(src);
      expect(Buffer.from(a).equals(Buffer.from(paint(src)))).toBe(true);
      expect(a.length).toBe(HALFTONE_PX * HALFTONE_PX * 4);
      const reds = Array.from({ length: a.length / 4 }, (_, i) => a[i * 4]!);
      expect(Math.max(...reds)).toBe(255);
      // A dot's centre is the ink share darker than the paper.
      expect(Math.min(...reds)).toBe(Math.round(255 * (1 - ink)));
      // Dots 0.5 mm across on a 4 mm grid: the darkened area is π (0.25)² per 16 mm² of paper.
      const share = (Math.PI * (HALFTONE_DOT_MM / 2) ** 2) / HALFTONE_PITCH_MM ** 2;
      const mean = reds.reduce((s, v) => s + v, 0) / reds.length;
      expect(255 - mean).toBeCloseTo(255 * ink * share, 1);
    }
    expect(HALFTONE_TILE_MM % HALFTONE_PITCH_MM).toBe(0);
  });

  it('has a full mip chain that fades to one even tone (power-of-two tile, trilinear filter, anisotropy at high quality)', () => {
    expect(Math.log2(HALFTONE_PX) % 1).toBe(0);
    const means = mipMeans(paint(TABLE_HALFTONE), HALFTONE_PX);
    expect(means.length).toBe(Math.log2(HALFTONE_PX) + 1);
    // Every level keeps the same average tone (no shimmer, no darkening at a distance).
    for (const m of means) expect(Math.abs(m - means[0]!)).toBeLessThan(0.01);
    // The material library's textures are three's canvas textures: mip-mapped with a trilinear minification filter.
    const tex = new THREE.CanvasTexture({ width: HALFTONE_PX, height: HALFTONE_PX } as unknown as HTMLCanvasElement);
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(qualityLevel(plain, 'high').anisotropy).toBeGreaterThanOrEqual(4);
  });
});

describe('Plain’s table world', () => {
  it('is the cheapest look: unlit, no lights, no shadow maps, no post-processing at any quality (zero post passes)', () => {
    expect(plain.lighting.lit).toBe(false);
    expect(plain.lighting.lights).toEqual([]);
    expect(plain.post).toEqual({ bloom: null, vignette: null });
    expect(plain.shadows.map).toBeNull();
    for (const l of plain.quality) {
      expect(l.post).toBe(false);
      expect(effectiveQuality(l, plain, { devicePixelRatio: 2, maxAnisotropy: 16, maxSamples: 4 }).post).toBe(false);
    }
    for (const s of PLAIN_WORLD.slabs) {
      expect(s.spec.model).toBe('unlit');
      if (s.side) expect(s.side.model).toBe('unlit');
    }
    expect(plain.cardDressing.sleeveMaterial?.model).toBe('unlit');
    expect(plain.cardDressing.faceShade).toBe(0);
  });

  it('builds a slab 8 mm thick whose top is the table, on a desk that reaches past every view, with a soft shadow on it', () => {
    const { ctx, scene } = context(plain);
    const t = plain.build(ctx) as WorldInstance;
    const slab = t.slabs.slab!;
    slab.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(slab);
    expect(b.max.y).toBeCloseTo(0, 6);
    expect(b.min.y).toBeCloseTo(-SLAB_MM, 3);
    expect(b.max.x).toBeCloseTo(700, 3);
    // The side is its own, darker material (the edge reads in first person).
    expect(Array.isArray(slab.material)).toBe(true);
    const [top, side] = slab.material as THREE.MeshBasicMaterial[];
    expect(top!.color.getHexString()).toBe(PLAIN_SURFACE.slice(1));
    expect(side!.color.getHex()).toBeLessThan(new THREE.Color(PLAIN_WORLD.surround).getHex());
    const desk = new THREE.Box3().setFromObject(t.slabs.desk!);
    expect(desk.max.x).toBeGreaterThan(5000);
    expect(desk.max.y).toBeCloseTo(-SLAB_MM, 3);
    expect(scene.getObjectByName('plain-skirt-0')).toBeDefined();
    expect(scene.getObjectByName('plain-rim')).toBeDefined();
    t.dispose();
  });

  it('selects with a double ring: a gap in the table’s colour, then an ink ring, readable on a black border and on the pale table', () => {
    const s = plain.cardDressing.selected;
    expect(s.gap).toBeGreaterThan(0);
    expect(s.gap!).toBeLessThan(s.width);
    // The gap is drawn in the table surface colour (scene/cards.ts uBg = tokens.colours.surface): 0.6 mm, then 0.9 mm of ink.
    expect(s.gap).toBeCloseTo(0.6, 6);
    expect(s.width - s.gap!).toBeCloseTo(0.9, 6);
    expect(s.colour).toBe(PLAIN_INK);
    expect(contrastRatio(s.colour, plain.tokens.colours.surface)).toBeGreaterThanOrEqual(7);
    // The gap (pale) against a black card border.
    expect(contrastRatio(plain.tokens.colours.surface, '#000000')).toBeGreaterThanOrEqual(7);
    expect(s.glow ?? 0).toBe(0);
  });
});

describe.each(LISTED_THEME_IDS.map((id) => [id] as const))('%s world', (id) => {
  it('builds and draws without a table state and without marks (the landing’s still), and its dispose frees everything', async () => {
    const theme = await loadTheme(id);
    const { ctx, scene, materials } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    // Never told any marks: the world stands, no marks drawn.
    expect(t.group.children.length).toBeGreaterThan(0);
    expect(t.marks.drawn.beds + t.marks.drawn.plaques).toBe(0);
    expect(() => t.update(16)).not.toThrow();
    const geometries = new Set<THREE.BufferGeometry>();
    const owned = new Set<THREE.Material>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geometries.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) owned.add(mat);
    });
    const freedG = new Set<THREE.BufferGeometry>();
    const freedM = new Set<THREE.Material>();
    for (const g of geometries) g.addEventListener('dispose', () => freedG.add(g));
    for (const m of owned) m.addEventListener('dispose', () => freedM.add(m));
    expect(geometries.size).toBeGreaterThan(0);
    t.dispose();
    expect(scene.children).toEqual([]);
    expect(freedG.size).toBe(geometries.size);
    // Materials the world made are disposed; the library's shared ones are released, and with them their textures.
    expect(materials.stats()).toEqual({ materials: 0, textures: 0 });
    materials.dispose();
    expect(freedM.size).toBe(owned.size);
  });

  it('switches in the theme runtime without a table state and leaves nothing behind', async () => {
    const theme = await loadTheme(id);
    const rt = new ThemeRuntime(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), { post: false }, theme, { table: { w: 1400, d: 1100 }, viewerAngle: 0, reducedMotion: true });
    rt.update(16);
    rt.dispose();
    expect(rt.materials.stats()).toEqual({ materials: 0, textures: 0 });
  });
});
