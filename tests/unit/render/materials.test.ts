// DESIGN "Themes and rendering": card faces are never restyled, lit themes render them with a near-unlit material
// while the table and sleeves receive light; themes switch without reload (PLAN M4-P2: no GPU textures leak).
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clampShade, createMaterialLibrary, keyLightUniform, specKey } from '../../../src/scene/materials';
import { paper } from '../../../src/themes/paper';
import { litTestTheme } from '../../../src/themes/test-lit';
import { CARD_FACE_MAX_SHADE, type MaterialSpec } from '../../../src/themes/types';
import { fakeRenderer, installFakeCanvas } from './fakes';

let restore: () => void;
beforeAll(() => (restore = installFakeCanvas()));
afterAll(() => restore());

const source = (id: string) => ({ id, width: 8, height: 8, draw: () => undefined });
const slab = (over: Partial<MaterialSpec> = {}): MaterialSpec => ({ model: 'standard', colour: '#556677', roughness: 0.8, metalness: 0, ...over });
const disposed = (o: { addEventListener(t: 'dispose', f: () => void): void }) => {
  const box = { count: 0 };
  o.addEventListener('dispose', () => box.count++);
  return box;
};

describe('MaterialLibrary.get', () => {
  it('shares one material per spec, whatever the key order, and counts references', () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const a = lib.get(slab());
    const b = lib.get({ metalness: 0, roughness: 0.8, colour: '#556677', model: 'standard' });
    expect(b).toBe(a);
    expect(a).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(lib.stats()).toEqual({ materials: 1, textures: 0 });
    const d = disposed(a);
    lib.release(a);
    expect(d.count).toBe(0);
    lib.release(b);
    expect(d.count).toBe(1);
    expect(lib.stats()).toEqual({ materials: 0, textures: 0 });
    // Releasing again or releasing a foreign material is harmless.
    lib.release(a);
    lib.release(new THREE.MeshBasicMaterial());
    expect(lib.stats()).toEqual({ materials: 0, textures: 0 });
  });

  it('builds unlit, standard and physical materials with maps, emissive and clearcoat', () => {
    const lib = createMaterialLibrary(fakeRenderer());
    expect(lib.get({ model: 'unlit', colour: '#ffffff', roughness: 1, metalness: 0 })).toBeInstanceOf(THREE.MeshBasicMaterial);
    const glow = lib.get(slab({ emissive: { colour: '#ff6600', intensity: 2 } })) as THREE.MeshStandardMaterial;
    expect(glow.emissiveIntensity).toBe(2);
    expect(glow.emissive.getHexString()).toBe('ff6600');
    const sleeve = lib.get({ model: 'physical', colour: '#5a3a22', roughness: 0.4, metalness: 0, clearcoat: 0.6 }) as THREE.MeshPhysicalMaterial;
    expect(sleeve).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(sleeve.clearcoat).toBe(0.6);
    const mapped = lib.get(slab({ tileMm: 250, normalScale: 0.5, maps: { albedo: { kind: 'procedural', source: source('stone') }, normal: { kind: 'procedural', source: source('stone-n') } } })) as THREE.MeshStandardMaterial;
    expect(mapped.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mapped.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(mapped.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(mapped.map!.repeat.x).toBeCloseTo(1 / 250);
    expect(mapped.normalScale.x).toBe(0.5);
  });

  it('shares maps between specs and frees each GPU texture with its last user', () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const albedo = { kind: 'procedural' as const, source: source('felt') };
    const a = lib.get(slab({ maps: { albedo } })) as THREE.MeshStandardMaterial;
    const b = lib.get(slab({ roughness: 0.3, maps: { albedo } })) as THREE.MeshStandardMaterial;
    expect(b.map).toBe(a.map);
    expect(lib.stats()).toEqual({ materials: 2, textures: 1 });
    const d = disposed(a.map!);
    lib.release(a);
    expect(d.count).toBe(0);
    lib.release(b);
    expect(d.count).toBe(1);
    expect(lib.stats()).toEqual({ materials: 0, textures: 0 });
  });

  it('applies anisotropy to its maps, clamped to the GPU', () => {
    const lib = createMaterialLibrary(fakeRenderer({ maxAnisotropy: 4 }));
    const m = lib.get(slab({ maps: { albedo: { kind: 'procedural', source: source('a') } } })) as THREE.MeshStandardMaterial;
    expect(m.map!.anisotropy).toBe(1);
    lib.setAnisotropy(16);
    expect(m.map!.anisotropy).toBe(4);
    lib.setAnisotropy(0);
    expect(m.map!.anisotropy).toBe(1);
  });

  it('identifies a procedural map by its source id and size, not its drawing function', () => {
    const a = specKey(slab({ maps: { albedo: { kind: 'procedural', source: { id: 'x', width: 4, height: 4, draw: () => 1 } } } }));
    const b = specKey(slab({ maps: { albedo: { kind: 'procedural', source: { id: 'x', width: 4, height: 4, draw: () => 2 } } } }));
    const c = specKey(slab({ maps: { albedo: { kind: 'procedural', source: { id: 'x', width: 8, height: 4, draw: () => 2 } } } }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('MaterialLibrary.cardFace (near-unlit, never tinted)', () => {
  it('caps the shade at CARD_FACE_MAX_SHADE and has no colour of its own', () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const map = new THREE.Texture();
    const m = lib.cardFace(map, 0.5) as THREE.ShaderMaterial;
    expect(m.uniforms.uShade!.value).toBe(CARD_FACE_MAX_SHADE);
    expect(Object.keys(m.uniforms).sort()).toEqual(['uKeyLight', 'uMap', 'uShade']);
    expect(m.toneMapped).toBe(false);
    expect(m.lights).toBe(false);
    expect(m.fog).toBe(false);
    expect(m.uniforms.uMap!.value).toBe(map);
    // Raw sRGB bytes stay raw; an sRGB map is decoded and re-encoded (colorspace_fragment), so both come out unchanged.
    expect(m.defines?.SP_SRGB_MAP).toBeUndefined();
    const srgb = Object.assign(new THREE.Texture(), { colorSpace: THREE.SRGBColorSpace });
    expect((lib.cardFace(srgb, 0) as THREE.ShaderMaterial).defines.SP_SRGB_MAP).toBe('');
    // The shader only ever multiplies by 1 - shade * (1 - light), light in [0, 1]: at most `shade` darker.
    expect(m.fragmentShader).toContain('c.rgb *= 1.0 - uShade * (1.0 - vLight);');
    expect(m.fragmentShader.match(/c\.rgb/g)).toHaveLength(1);
  });

  it('clamps any shade into [0, CARD_FACE_MAX_SHADE]', () => {
    expect(clampShade(-1)).toBe(0);
    expect(clampShade(Number.NaN)).toBe(0);
    expect(clampShade(0.01)).toBe(0.01);
    expect(clampShade(1)).toBe(CARD_FACE_MAX_SHADE);
  });

  it('follows the key light through one shared uniform', () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const m = lib.cardFace(new THREE.Texture(), 0.03) as THREE.ShaderMaterial;
    expect((m.uniforms.uKeyLight!.value as THREE.Vector4).w).toBe(-1);
    lib.setKeyLight({ kind: 'position', x: 1, y: 2, z: 3 });
    expect((m.uniforms.uKeyLight!.value as THREE.Vector4).toArray()).toEqual([1, 2, 3, 1]);
    expect(keyLightUniform({ kind: 'direction', x: 0, y: 1, z: 0 }).toArray()).toEqual([0, 1, 0, 0]);
    expect(keyLightUniform(null).w).toBe(-1);
  });
});

describe('MaterialLibrary.cardSides', () => {
  it("renders Paper's bare card unlit in its edge colour", () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const { sleeve, edge } = lib.cardSides(paper.cardDressing);
    expect(sleeve).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(edge).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((sleeve as THREE.MeshBasicMaterial).color.getHexString()).toBe('ffffff');
  });

  it("lights a theme's sleeve material and edges, drawn after the table markings, and frees them on release", () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const dressing = litTestTheme().cardDressing;
    const { sleeve, edge } = lib.cardSides(dressing);
    expect(sleeve).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(edge).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((edge as THREE.MeshStandardMaterial).color.getHexString()).toBe('e8e2d0');
    for (const m of [sleeve, edge]) expect(m).toMatchObject({ transparent: true, depthWrite: true, opacity: 1 });
    // A theme material of the same spec is a different object (the sides' render flags stay theirs).
    expect(lib.get(dressing.sleeveMaterial!)).not.toBe(sleeve);
    lib.release(sleeve);
    lib.release(edge);
    expect(lib.stats().materials).toBe(1);
  });

  it('dispose frees every material and map', () => {
    const lib = createMaterialLibrary(fakeRenderer());
    const m = lib.get(slab({ maps: { albedo: { kind: 'procedural', source: source('z') } } })) as THREE.MeshStandardMaterial;
    const dm = disposed(m);
    const dt = disposed(m.map!);
    lib.dispose();
    expect([dm.count, dt.count]).toEqual([1, 1]);
    expect(lib.stats()).toEqual({ materials: 0, textures: 0 });
  });
});
