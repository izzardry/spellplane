// themes/types.ts LightSpec: positions in the viewer's frame (x right, y away from the viewer, z up), rotated by the
// viewer's seat angle, so a lamp stays behind the viewer's own edge whichever seat they hold (DESIGN "Themes and
// rendering", light rig; two players at one table may use different themes and seats).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyLightShadows, CAST_SHADOW, createLightRig, keyLightOf, viewerToWorld } from '../../../src/scene/lights';
import type { LightSpec } from '../../../src/themes/types';

const lamp: LightSpec = { kind: 'directional', colour: '#ffffff', intensity: 2, position: [0, -900, 1400], castShadow: true };
const torch: LightSpec = { kind: 'spot', colour: '#ff9a50', intensity: 2, position: [500, -700, 900], angleDeg: 40, penumbra: 0.5, decay: 0, distance: 0, castShadow: false, flicker: { amplitude: 0.2, hz: 2 } };
const table = { w: 1400, d: 1100 };

describe('viewer frame', () => {
  it("puts a lamp behind the viewer's own edge for every seat", () => {
    // three's world: x = table x, y = up, z = -table y.
    const near = viewerToWorld([0, -900, 1400], 0);
    expect(near.toArray().map((v) => Math.round(v) + 0)).toEqual([0, 1400, 900]);
    const far = viewerToWorld([0, -900, 1400], 180);
    expect(far.toArray().map((v) => Math.round(v) + 0)).toEqual([0, 1400, -900]);
    const side = viewerToWorld([0, -900, 1400], 90);
    expect(Math.round(side.x)).toBe(-900);
    expect(Math.round(side.z)).toBe(0);
    // "Right" turns with the viewer too.
    expect(Math.round(viewerToWorld([500, 0, 0], 180).x)).toBe(-500);
  });

  it('picks the shadow-casting placed light as the key light (direction toward it, or its position)', () => {
    const key = keyLightOf([{ kind: 'ambient', colour: '#fff', intensity: 1 }, torch, lamp], 0)!;
    expect(key.kind).toBe('direction');
    expect(Math.hypot(key.x, key.y, key.z)).toBeCloseTo(1);
    expect(key.y).toBeGreaterThan(0);
    const spot = keyLightOf([torch], 0)!;
    expect(spot).toMatchObject({ kind: 'position', x: 500, y: 900 });
    expect(keyLightOf([{ kind: 'hemisphere', sky: '#fff', ground: '#000', intensity: 1 }], 0)).toBeNull();
  });
});

describe('createLightRig', () => {
  it('builds every kind with its target, marks shadow casters and starts with shadows off', () => {
    const rig = createLightRig(
      [{ kind: 'ambient', colour: '#fff', intensity: 0.3 }, { kind: 'hemisphere', sky: '#fff', ground: '#000', intensity: 0.4 }, lamp, torch, { kind: 'point', colour: '#fff', intensity: 1, position: [0, 0, 500], decay: 2, distance: 3000, castShadow: true }],
      { viewerAngle: 0, table, reducedMotion: false },
    );
    expect(rig.lights.map((l) => l.type)).toEqual(['AmbientLight', 'HemisphereLight', 'DirectionalLight', 'SpotLight', 'PointLight']);
    expect(rig.lights.map((l) => l.userData[CAST_SHADOW])).toEqual([false, false, true, false, true]);
    expect(rig.lights.every((l) => !l.castShadow)).toBe(true);
    const dir = rig.lights[2] as THREE.DirectionalLight;
    expect(dir.target.parent).toBe(rig.object);
    // The directional shadow camera covers the whole table.
    expect(dir.shadow.camera.right).toBeGreaterThanOrEqual(Math.hypot(table.w, table.d) / 2);
    const scene = new THREE.Scene();
    scene.add(rig.object);
    rig.dispose();
    expect(rig.object.parent).toBeNull();
  });

  it('flickers a torch within its amplitude, deterministically, and not at all with reduced motion', () => {
    const rig = createLightRig([torch], { viewerAngle: 0, table, reducedMotion: false });
    const light = rig.lights[0]!;
    const seen: number[] = [];
    for (let t = 0; t < 3000; t += 37) {
      rig.update(t);
      seen.push(light.intensity);
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(2 * (1 - 0.2) - 1e-9);
    expect(Math.max(...seen)).toBeLessThanOrEqual(2 * (1 + 0.2) + 1e-9);
    expect(new Set(seen.map((v) => v.toFixed(4))).size).toBeGreaterThan(10);
    const again = createLightRig([torch], { viewerAngle: 0, table, reducedMotion: false });
    again.update(1234);
    rig.update(1234);
    expect(again.lights[0]!.intensity).toBe(light.intensity);
    const still = createLightRig([torch], { viewerAngle: 0, table, reducedMotion: true });
    still.update(777);
    expect(still.lights[0]!.intensity).toBe(2);
  });
});

describe('applyLightShadows', () => {
  it('turns shadows on and off on the lights that ask for them, with the theme settings and the level map size', () => {
    const rig = createLightRig([lamp, torch], { viewerAngle: 0, table, reducedMotion: false });
    const map = { type: 'pcf' as const, mapSize: 2048, bias: -0.001, normalBias: 0.4, radius: 3 };
    applyLightShadows(rig.object, true, map, 1024);
    const [dir, spot] = rig.lights as [THREE.DirectionalLight, THREE.SpotLight];
    expect(dir.castShadow).toBe(true);
    expect(spot.castShadow).toBe(false);
    expect(dir.shadow).toMatchObject({ bias: -0.001, normalBias: 0.4, radius: 3 });
    expect(dir.shadow.mapSize.toArray()).toEqual([1024, 1024]);
    applyLightShadows(rig.object, false, map, 1024);
    expect(dir.castShadow).toBe(false);
    applyLightShadows(rig.object, true, null, 1024);
    expect(dir.castShadow).toBe(false);
  });
});
