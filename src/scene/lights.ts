/**
 * A theme's light rig from its LightSpecs (DESIGN "Themes and rendering", Lighting and post-processing: "light rig";
 * themes/types.ts LightSpec: positions in the viewer's frame, x right, y away from the viewer, z up, mm, origin at the
 * table centre, rotated by SceneContext.viewerAngle so a lamp stays behind the viewer's own edge whichever seat they
 * hold). A theme's `build` calls `createLightRig` and disposes it with the theme. Added by M4-P2.
 *
 * Shadow settings (map size, bias, radius) are applied by the scene from ShadowSettings and the quality level to every
 * light that asks for shadows (`userData.spCastShadow`), so a quality change turns them on and off without a rebuild.
 * Torch-like flicker is a deterministic sum of sines of the time the scene passes in; reduced motion turns it off.
 */
import * as THREE from 'three';
import type { LightSpec, ShadowSettings } from '../themes/types';
import type { KeyLight } from './materials';
import { rot2 } from './math';

/** A viewer-frame point (mm) in three's world (x = table x, y = up, z = -table y) for a viewer at `viewerAngle`. */
export function viewerToWorld(p: readonly [number, number, number], viewerAngle: number): THREE.Vector3 {
  const [x, y] = rot2(p[0], p[1], viewerAngle);
  return new THREE.Vector3(x, p[2], -y);
}

/** A built light rig. */
export interface LightRig {
  /** Holds the lights and their targets; the theme adds it to the scene. */
  readonly object: THREE.Group;
  readonly lights: THREE.Light[];
  /** The light that may shade card faces (scene/materials.ts KeyLight), or null. */
  readonly key: KeyLight | null;
  /** Advance flicker to `timeMs` (no-op with reduced motion or without flicker). */
  update(timeMs: number): void;
  dispose(): void;
}

/** Marks a light that should cast shadows when shadows are on (scene/theme-runtime.ts applies the settings). */
export const CAST_SHADOW = 'spCastShadow';

/** The key light of a rig: the first shadow-casting directional, spot or point light, else the first of those. */
export function keyLightOf(specs: readonly LightSpec[], viewerAngle: number): KeyLight | null {
  const placed = specs.filter((s): s is Extract<LightSpec, { position: [number, number, number] }> => s.kind === 'directional' || s.kind === 'spot' || s.kind === 'point');
  const s = placed.find((x) => x.castShadow) ?? placed[0];
  if (!s) return null;
  const p = viewerToWorld(s.position, viewerAngle);
  if (s.kind === 'directional') {
    const t = viewerToWorld(s.target ?? [0, 0, 0], viewerAngle);
    const d = p.sub(t).normalize();
    return { kind: 'direction', x: d.x, y: d.y, z: d.z };
  }
  return { kind: 'position', x: p.x, y: p.y, z: p.z };
}

/** Build the lights of `specs` for a viewer at `viewerAngle` over a table of `table` mm. */
export function createLightRig(specs: readonly LightSpec[], opts: { viewerAngle: number; table: { w: number; d: number }; reducedMotion: boolean }): LightRig {
  const group = new THREE.Group();
  group.name = 'light-rig';
  const lights: THREE.Light[] = [];
  const flickers: { light: THREE.Light; base: number; amplitude: number; hz: number; phase: number }[] = [];
  const reach = Math.hypot(opts.table.w, opts.table.d) / 2;
  specs.forEach((s, i) => {
    let light: THREE.Light;
    switch (s.kind) {
      case 'ambient':
        light = new THREE.AmbientLight(s.colour, s.intensity);
        break;
      case 'hemisphere':
        light = new THREE.HemisphereLight(s.sky, s.ground, s.intensity);
        break;
      case 'directional': {
        const l = new THREE.DirectionalLight(s.colour, s.intensity);
        l.position.copy(viewerToWorld(s.position, opts.viewerAngle));
        l.target.position.copy(viewerToWorld(s.target ?? [0, 0, 0], opts.viewerAngle));
        group.add(l.target);
        // The shadow camera covers the whole table, seen from the light.
        const cam = l.shadow.camera;
        cam.left = cam.bottom = -reach * 1.1;
        cam.right = cam.top = reach * 1.1;
        cam.near = 1;
        cam.far = l.position.distanceTo(l.target.position) + reach * 2;
        cam.updateProjectionMatrix();
        light = l;
        break;
      }
      case 'spot': {
        const l = new THREE.SpotLight(s.colour, s.intensity, s.distance, s.angleDeg * (Math.PI / 180), s.penumbra, s.decay);
        l.position.copy(viewerToWorld(s.position, opts.viewerAngle));
        l.target.position.copy(viewerToWorld(s.target ?? [0, 0, 0], opts.viewerAngle));
        group.add(l.target);
        l.shadow.camera.near = 10;
        l.shadow.camera.far = (s.distance || l.position.length() + reach * 2) * 1.2;
        light = l;
        if (s.flicker) flickers.push({ light: l, base: s.intensity, amplitude: s.flicker.amplitude, hz: s.flicker.hz, phase: i * 1.7 });
        break;
      }
      case 'point': {
        const l = new THREE.PointLight(s.colour, s.intensity, s.distance, s.decay);
        l.position.copy(viewerToWorld(s.position, opts.viewerAngle));
        l.shadow.camera.near = 10;
        l.shadow.camera.far = (s.distance || l.position.length() + reach * 2) * 1.2;
        light = l;
        if (s.flicker) flickers.push({ light: l, base: s.intensity, amplitude: s.flicker.amplitude, hz: s.flicker.hz, phase: i * 1.7 });
        break;
      }
    }
    light.name = `light:${i}:${s.kind}`;
    light.userData[CAST_SHADOW] = 'castShadow' in s && s.castShadow;
    light.castShadow = false;
    group.add(light);
    lights.push(light);
  });
  return {
    object: group,
    lights,
    key: keyLightOf(specs, opts.viewerAngle),
    update(timeMs) {
      if (opts.reducedMotion) return;
      const t = timeMs / 1000;
      for (const f of flickers) {
        const w = 2 * Math.PI * f.hz;
        const n = 0.6 * Math.sin(w * t + f.phase) + 0.3 * Math.sin(2.3 * w * t + 2 * f.phase) + 0.1 * Math.sin(5.1 * w * t);
        f.light.intensity = Math.max(0, f.base * (1 + f.amplitude * n));
      }
    },
    dispose() {
      for (const l of lights) l.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}

/**
 * Apply shadow settings to every light under `root` that asks for shadows: cast while `on`, with the theme's bias,
 * normal bias, blur radius and the level's map size. A changed map size frees the old shadow map.
 */
export function applyLightShadows(root: THREE.Object3D, on: boolean, map: ShadowSettings['map'], mapSize: number): void {
  root.traverse((o) => {
    const light = o as THREE.Light & { shadow?: THREE.LightShadow };
    if (!light.isLight || !light.shadow || !light.userData[CAST_SHADOW]) return;
    const cast = on && map !== null;
    light.castShadow = cast;
    if (!map) return;
    const shadow = light.shadow;
    shadow.bias = map.bias;
    shadow.normalBias = map.normalBias;
    shadow.radius = map.radius;
    if (shadow.mapSize.x !== mapSize || shadow.mapSize.y !== mapSize) {
      shadow.mapSize.set(mapSize, mapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    if (!cast && shadow.map) {
      // Shadows off: free the shadow map's GPU texture until they come back.
      shadow.map.dispose();
      shadow.map = null;
    }
  });
}
