// DESIGN "Themes and rendering": a theme is data plus one build; themes switch mid-game without reloading; a quality
// setting drops shadows and post-processing first. scene/theme-runtime.ts carries a theme in a surface.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ThemeRuntime } from '../../../src/scene/theme-runtime';
import { paper } from '../../../src/themes/paper';
import { litTestTheme } from '../../../src/themes/test-lit';
import type { QualityLevel, SceneContext, Theme, ThemeInstance } from '../../../src/themes/types';
import { fakeRenderer, installFakeCanvas } from './fakes';

let restore: () => void;
beforeAll(() => (restore = installFakeCanvas()));
afterAll(() => restore());

const placement = { table: { w: 1400, d: 1100 }, viewerAngle: 0, reducedMotion: false };

function spyTheme(base: Theme, withSetQuality: boolean) {
  const log: string[] = [];
  const contexts: SceneContext[] = [];
  const theme: Theme = {
    ...base,
    build(ctx) {
      contexts.push(ctx);
      log.push(`build:${ctx.quality.id}`);
      const inner = base.build(ctx);
      const inst: ThemeInstance = {
        update: (dt) => inner.update(dt),
        dispose: () => {
          log.push('dispose');
          inner.dispose();
        },
      };
      if (withSetQuality) inst.setQuality = (q: QualityLevel) => log.push(`setQuality:${q.id}`);
      return inst;
    },
  };
  return { theme, log, contexts };
}

const lights = (scene: THREE.Scene) => {
  const out: THREE.Light[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight) out.push(o as THREE.Light);
  });
  return out;
};

describe('ThemeRuntime', () => {
  it('builds a lit theme with its light rig, tone mapping, materials and post pipeline, and Paper with none', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const lit = spyTheme(litTestTheme(), false);
    const rt = new ThemeRuntime(renderer, scene, new THREE.PerspectiveCamera(), { post: true, overlay: new THREE.Scene() }, lit.theme, placement, 'high');
    expect(lights(scene).map((l) => l.type)).toEqual(['AmbientLight', 'HemisphereLight', 'DirectionalLight', 'SpotLight']);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(1.4);
    expect(renderer.shadowMap.enabled).toBe(true);
    // The shadow-casting key light casts at the level's map size.
    const key = lights(scene).find((l) => l.type === 'DirectionalLight') as THREE.DirectionalLight;
    expect(key.castShadow).toBe(true);
    expect(key.shadow.mapSize.x).toBe(2048);
    expect(rt.post.passes()).toEqual(['render', 'bloom', 'test-copy', 'vignette', 'output']);
    expect(lit.contexts[0]).toMatchObject({ viewerAngle: 0, reducedMotion: false, table: placement.table });
    expect(lit.contexts[0]!.post).toBe(rt.post);
    expect(lit.contexts[0]!.materials).toBe(rt.materials);
    expect(rt.keyLight.w).toBe(0);

    rt.setTheme(paper);
    expect(lit.log).toEqual(['build:high', 'dispose']);
    expect(lights(scene)).toEqual([]);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(rt.post.passes()).toEqual([]);
    expect(rt.materials.stats()).toEqual({ materials: 0, textures: 0 });
    expect(rt.keyLight.w).toBe(-1);
    rt.dispose();
  });

  it('applies a quality level through the theme when it can, else rebuilds it; shadows go first', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const own = spyTheme(litTestTheme(), true);
    const rt = new ThemeRuntime(renderer, scene, new THREE.PerspectiveCamera(), { post: true }, own.theme, placement, 'high');
    rt.setQuality('medium');
    expect(own.log).toEqual(['build:high', 'setQuality:medium']);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(lights(scene).some((l) => l.castShadow)).toBe(false);
    expect(rt.post.passes()).toContain('bloom');
    rt.setQuality('low');
    expect(rt.post.passes()).toEqual([]);

    const plain = spyTheme(litTestTheme(), false);
    rt.setTheme(plain.theme);
    expect(own.log.at(-1)).toBe('dispose');
    expect(plain.log).toEqual(['build:low']);
    rt.setQuality('high');
    expect(plain.log).toEqual(['build:low', 'dispose', 'build:high']);
    expect(renderer.shadowMap.enabled).toBe(true);
    rt.dispose();
    expect(plain.log.at(-1)).toBe('dispose');
  });

  it('places lights for the viewer and rebuilds for another seat; pre-game surfaces get no post pipeline', () => {
    const scene = new THREE.Scene();
    const lit = spyTheme(litTestTheme(), false);
    const rt = new ThemeRuntime(fakeRenderer(), scene, new THREE.PerspectiveCamera(), { post: false }, lit.theme, { ...placement, viewerAngle: 180 }, 'high');
    const key = lights(scene).find((l) => l.type === 'DirectionalLight')!;
    // [-300, -900, 1400] in the viewer's frame: behind the far edge seen from seat 0, i.e. table y > 0 (world z < 0).
    expect(key.position.z).toBeLessThan(0);
    expect(lit.contexts[0]!.post).toBeUndefined();
    expect(rt.post.passes()).toEqual([]);
    rt.rebuild(placement);
    expect(lights(scene).find((l) => l.type === 'DirectionalLight')!.position.z).toBeGreaterThan(0);
    expect(lights(scene)).toHaveLength(4);
    rt.update(16);
    rt.dispose();
    expect(lights(scene)).toEqual([]);
  });
});
