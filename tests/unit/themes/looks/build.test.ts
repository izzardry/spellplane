// The looks' table worlds built in a scene (PLAN Milestone 7, Owner decisions: "each look is built as a 3D table world
// (surface, frame, lighting, card shadows, pile and zone marks) that reads well at every camera tilt"; PLAN M7-P1:
// "Each: surface, table frame/edge visible in first person, lighting, card shadows that help depth, pile and zone marks
// (library, graveyard, exile, command) in the look's style, seat colours with shapes"; DESIGN "Specification: geometry,
// layout and motion": the table plane is height 0 and cards lie on it; DESIGN "Themes and rendering": themes switch
// mid-game without reloading, PLAN M4-P2: no texture leaks). Built in Node with three's scene graph, a renderer stand-in
// and the real material library and theme runtime.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harnessGame, harnessLayout } from '../../../../src/scene/harness-fixture';
import { createMaterialLibrary } from '../../../../src/scene/materials';
import { tableMarks } from '../../../../src/scene/table-marks';
import { ThemeRuntime, turnMarks } from '../../../../src/scene/theme-runtime';
import { CODEX_WORLD, DESK_MM, DIAMOND_MM, LEATHER_MARGIN_MM } from '../../../../src/themes/codex/index';
import { GRAPHITE_WORLD, PLINTH_DROP_MM, PLINTH_MM } from '../../../../src/themes/graphite/index';
import { LOOK_IDS, LOOK_THEME, loadTheme, qualityLevel, type SceneContext, type TableMarks, type Theme } from '../../../../src/themes/index';
import type { WorldInstance } from '../../../../src/themes/kit/look';
import { BOARD_MM, KITCHEN_WORLD } from '../../../../src/themes/kitchen/index';
import { DESK_MM as PLAIN_DESK_MM, PLAIN_WORLD, SLAB_MM } from '../../../../src/themes/plain/index';
import { fakeRenderer } from '../../render/fakes';
import { installRecordingCanvas } from '../stonetable/helpers';

let restore: () => void;
beforeAll(() => (restore = installRecordingCanvas()));
afterAll(() => restore());

const looks: Theme[] = await Promise.all(LOOK_IDS.map((id) => loadTheme(LOOK_THEME[id])));
const WORLDS = { plain: PLAIN_WORLD, kitchen: KITCHEN_WORLD, graphite: GRAPHITE_WORLD, codex: CODEX_WORLD } as const;
/** How far each look's frame reaches beyond the layout's table, mm. */
const FRAME = { plain: PLAIN_DESK_MM, kitchen: BOARD_MM, graphite: PLINTH_MM, codex: DESK_MM } as const;
/** How deep each look's world reaches below the table plane at least, mm (Plain: its 8 mm slab on the desk). */
const DEPTH = { plain: SLAB_MM, kitchen: 25, graphite: 25, codex: 25 } as const;

const TABLES = [
  { w: 1400, d: 1100 },
  { w: 2000, d: 1300 },
  { w: 1800, d: 1800 },
  { w: 2200, d: 1100 },
];

function context(theme: Theme, table = TABLES[0]!) {
  const renderer = fakeRenderer();
  const scene = new THREE.Scene();
  const materials = createMaterialLibrary(renderer);
  const ctx: SceneContext = { renderer, scene, camera: new THREE.PerspectiveCamera(), table, quality: qualityLevel(theme, 'high'), reducedMotion: false, viewerAngle: 0, materials };
  return { ctx, scene, materials };
}

const box = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(o);
};

/** The harness table's marks (1v1, two named chairs: Ada in seat colour 0, Bo in seat colour 1). */
const harnessMarks = (named = true): TableMarks =>
  tableMarks(harnessLayout(), harnessGame, 0, [
    { index: 0, colour: 0, named },
    { index: 1, colour: 1, named },
  ]);

describe.each(looks.map((t) => [t.id, t] as const))('%s', (id, theme) => {
  const world = WORLDS[id as keyof typeof WORLDS];
  const frame = FRAME[id as keyof typeof FRAME];
  const depth = DEPTH[id as keyof typeof DEPTH];

  it.each(TABLES)('covers the %o table with a surface whose top is height 0, framed beyond every edge with a visible depth', (table) => {
    const { ctx, scene } = context(theme, table);
    const t = theme.build(ctx) as WorldInstance;
    expect(t.group.parent).toBe(scene);
    const slabs = world.slabs.map((s) => t.slabs[s.name]!);
    const top = box(slabs.at(-1)!);
    // The surface: its top is the table plane, it covers the whole layout table (cards are never off the surface).
    expect(top.max.y).toBeCloseTo(0, 6);
    expect(top.max.x).toBeGreaterThanOrEqual(table.w / 2 - 1e-6);
    expect(top.min.x).toBeLessThanOrEqual(-table.w / 2 + 1e-6);
    expect(top.max.z).toBeGreaterThanOrEqual(table.d / 2 - 1e-6);
    expect(top.min.z).toBeLessThanOrEqual(-table.d / 2 + 1e-6);
    // The frame: beyond every edge by the look's width, and deep enough to show its edge in first person.
    const all = box(t.group);
    expect(all.max.x).toBeCloseTo(table.w / 2 + frame, 3);
    expect(all.min.x).toBeCloseTo(-table.w / 2 - frame, 3);
    expect(all.max.z).toBeCloseTo(table.d / 2 + frame, 3);
    expect(all.min.z).toBeCloseTo(-table.d / 2 - frame, 3);
    expect(all.min.y).toBeLessThan(-depth);
    // Nothing stands above the table plane, so no card is ever hidden by the world (overlays lie within 0.1 mm).
    expect(all.max.y).toBeLessThanOrEqual(0.1);
    t.dispose();
  });

  it('frames the table at least as far as the avatar spots outside each edge, so a plaque under them sits on the frame', () => {
    // DESIGN geometry: the avatar sits outside the near edge (scene/harness-fixture.ts: 30 mm out, a 30 mm ring).
    expect(frame).toBeGreaterThanOrEqual(60 + 12);
  });

  it('builds its surfaces from procedural maps (no files): physically based in the lit looks, unlit in Plain', () => {
    const { ctx } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    for (const s of world.slabs) {
      const raw = t.slabs[s.name]!.material;
      const m = (Array.isArray(raw) ? raw[0] : raw) as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      if (theme.lighting.lit) {
        expect(m.isMeshStandardMaterial, s.name).toBe(true);
        expect(t.slabs[s.name]!.receiveShadow).toBe(true);
      } else expect(m.isMeshBasicMaterial, s.name).toBe(true);
      expect(m.map, s.name).not.toBeNull();
      for (const map of Object.values(s.spec.maps ?? {})) expect(map.kind).toBe('procedural');
    }
    t.dispose();
  });

  it('lies still: nothing animates, so a still table draws no frames', () => {
    const { ctx } = context(theme);
    const t = theme.build(ctx);
    expect(t.animating?.()).toBe(false);
    const before = JSON.stringify(box((t as WorldInstance).group));
    t.update(16);
    t.update(1000);
    expect(JSON.stringify(box((t as WorldInstance).group))).toBe(before);
    t.dispose();
  });

  it('marks every pile slot and command area with a bed, and every named chair with a plaque and its seat glyph in its colour', () => {
    const { ctx } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    const marks = harnessMarks();
    t.setMarks!(marks);
    const d = t.marks.drawn;
    expect(marks.piles.map((p) => p.zone)).toEqual(['library', 'graveyard', 'exile', 'library', 'graveyard', 'exile']);
    expect(d.beds).toBe(6);
    expect(d.areas).toBe(2);
    expect(d.plaques).toBe(2);
    expect(d.territories).toBe(world.marks.territory ? 2 : 0);
    const seats = theme.tokens.colours.seats;
    expect(d.glyphs.map((g) => [g.seat, g.glyph, g.colour])).toEqual([
      [0, seats[0]!.glyph, seats[0]!.colour],
      [1, seats[1]!.glyph, seats[1]!.colour],
    ]);
    // The glyph sits beside the avatar spot, on the plaque, outside the table (never under a card).
    for (const g of d.glyphs) expect(Math.abs(g.y)).toBeGreaterThan(1100 / 2);
    // Beds lie on the table under the scene's hairlines (height 0.05) and labels; plaques reach the table's height.
    const marksBox = box(t.marks.object);
    expect(marksBox.max.y).toBeLessThanOrEqual(0.05);
    // The beds sit on the slots: each bed's mesh covers the library slot of seat 0.
    const lib = marks.piles[0]!;
    const beds = t.marks.object.getObjectByName(`${id}-beds`) as THREE.Mesh;
    const bb = box(beds);
    expect(bb.containsPoint(new THREE.Vector3(lib.x, bb.max.y, -lib.y))).toBe(true);
    t.dispose();
  });

  it('draws no plaque or glyph for an empty chair', () => {
    const { ctx } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    t.setMarks!(harnessMarks(false));
    expect(t.marks.drawn.plaques).toBe(0);
    expect(t.marks.drawn.glyphs).toEqual([]);
    expect(t.marks.drawn.beds).toBe(6);
    t.dispose();
  });

  it('redraws marks without piling up geometry or materials, and frees everything on dispose', () => {
    const { ctx, scene, materials } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    t.setMarks!(harnessMarks());
    const children = t.marks.object.children.length;
    const disposed: THREE.BufferGeometry[] = [];
    t.marks.object.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) g.addEventListener('dispose', () => disposed.push(g));
    });
    for (let i = 0; i < 5; i++) t.setMarks!(harnessMarks(i % 2 === 0));
    t.setMarks!(harnessMarks());
    expect(t.marks.object.children.length).toBe(children);
    expect(disposed.length).toBe(children);
    const stats = materials.stats();
    expect(stats.materials).toBeGreaterThan(0);
    t.dispose();
    expect(t.group.parent).toBeNull();
    expect(scene.children).toEqual([]);
    // Every material the look borrowed from the library is released (and with them their textures).
    expect(materials.stats()).toEqual({ materials: 0, textures: 0 });
    // A second dispose and a late setMarks are harmless.
    t.dispose();
    t.setMarks!(harnessMarks());
    expect(t.marks.object.children.length).toBe(0);
  });

  it('switches back and forth in the theme runtime without leaking materials, and gets its marks after every rebuild', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const other = looks.find((l) => l.id !== id)!;
    const rt = new ThemeRuntime(renderer, scene, camera, { post: false }, theme, { table: TABLES[0]!, viewerAngle: 0, reducedMotion: false });
    rt.setMarks(harnessMarks());
    const baseline = rt.materials.stats();
    for (let i = 0; i < 4; i++) {
      rt.setTheme(i % 2 === 0 ? other : theme);
      const plaques = scene.getObjectByName(`${i % 2 === 0 ? other.id : id}-plaques`);
      expect(plaques, `marks after switch ${i}`).toBeDefined();
    }
    expect(rt.materials.stats()).toEqual(baseline);
    rt.dispose();
    expect(rt.materials.stats()).toEqual({ materials: 0, textures: 0 });
  });
});

describe('Graphite’s depth', () => {
  it('stands the slab proud of a darker plinth, with a soft shadow of the slab on the plinth and lighter territory layers', () => {
    const theme = looks.find((t) => t.id === 'graphite')!;
    const { ctx } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    expect(box(t.slabs.plinth!).max.y).toBeCloseTo(-PLINTH_DROP_MM, 6);
    const skirt = t.group.getObjectByName('graphite-skirt-0') as THREE.Mesh;
    const alpha = skirt.geometry.getAttribute('color');
    expect(alpha.itemSize).toBe(4);
    const values = Array.from({ length: alpha.count }, (_, i) => alpha.getW(i));
    expect(Math.max(...values)).toBeGreaterThan(0.4);
    expect(Math.min(...values)).toBe(0);
    expect(box(skirt).max.y).toBeCloseTo(-PLINTH_DROP_MM + 0.02, 3);
    const slab = GRAPHITE_WORLD.slabs[1]!.spec.colour;
    expect(GRAPHITE_WORLD.marks.territory!.spec.colour > slab).toBe(true);
    t.dispose();
  });
});

describe('Codex’s gilt', () => {
  it('rules the leather’s edge in gilt and sets a gilt diamond at each corner of the table', () => {
    const theme = looks.find((t) => t.id === 'codex')!;
    const { ctx } = context(theme);
    const t = theme.build(ctx) as WorldInstance;
    const rule = t.group.getObjectByName('codex-rule') as THREE.LineSegments;
    expect((rule.material as THREE.LineBasicMaterial).color.getHexString()).toBe('c8a75e');
    const rb = box(rule);
    expect(rb.max.x).toBeCloseTo(1400 / 2 + LEATHER_MARGIN_MM - 1, 3);
    const diamonds = t.group.getObjectByName('codex-diamonds') as THREE.Mesh;
    const db = box(diamonds);
    expect(db.max.x).toBeCloseTo(1400 / 2 + DIAMOND_MM / 2, 3);
    expect(db.max.z).toBeCloseTo(1100 / 2 + DIAMOND_MM / 2, 3);
    t.dispose();
  });
});

describe('marks in a turned table (the three-player table turns the theme to each viewer)', () => {
  it('turns every point, rectangle and angle, and turning back restores them', () => {
    const m = harnessMarks();
    const turned = turnMarks(m, 90);
    expect(turned.piles[0]!.x).toBeCloseTo(m.piles[0]!.y, 6);
    expect(turned.piles[0]!.y).toBeCloseTo(-m.piles[0]!.x, 6);
    expect(turned.seats[1]!.angle).toBe(270);
    const back = turnMarks(turned, -90);
    expect(back.piles[0]!.x).toBeCloseTo(m.piles[0]!.x, 6);
    expect(back.seats[0]!.territory.rot).toBeCloseTo(m.seats[0]!.territory.rot, 6);
    expect(turnMarks(m, 0)).toBe(m);
  });
});
