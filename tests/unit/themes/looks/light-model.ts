/**
 * A model of how a look's table top appears from straight above (bird's-eye), from its light rig and its surface
 * material: three's physically based diffuse (lights_physical_pars_fragment: Lambert ÷ π, the hemisphere's sky for an
 * upward surface, a spot's smoothstep penumbra, (1 − Fresnel) on the diffuse layer), no tone mapping (every look sets
 * 'none'). Specular is left out: the surfaces are rough, so it adds little seen from above. The browser spec
 * (tests/e2e/themes/looks/looks.spec.ts) measures the real thing; this keeps the tokens honest without a browser.
 */
import * as THREE from 'three';
import type { LightSpec, MaterialSpec } from '../../../../src/themes/types';
import type { Canvas2D } from '../../../../src/util/texture';
import { recordingContext } from '../stonetable/helpers';

const lin = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** The linear average of a procedural albedo map, per channel (1 for none). */
export function mapAverage(spec: MaterialSpec): [number, number, number] {
  const albedo = spec.maps?.albedo;
  if (!albedo || albedo.kind !== 'procedural') return [1, 1, 1];
  const { ctx } = recordingContext();
  let data: Uint8ClampedArray = new Uint8ClampedArray(0);
  (ctx as unknown as Record<string, unknown>).putImageData = (img: { data: Uint8ClampedArray }) => (data = img.data);
  albedo.source.draw(ctx as Canvas2D, albedo.source.width, albedo.source.height);
  const s = [0, 0, 0];
  const toLin = (v: number) => {
    const c = v / 255;
    return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
  };
  for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) s[k]! += toLin(data[i + k]!);
  const n = data.length / 4;
  return [s[0]! / n, s[1]! / n, s[2]! / n];
}

/** Irradiance ÷ π (linear RGB) reaching an upward surface at table point (x, y) for a viewer at seat angle 0. */
export function lightAt(lights: readonly LightSpec[], x: number, y: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const add = (c: [number, number, number], k: number) => {
    for (let i = 0; i < 3; i++) out[i]! += (c[i]! * k) / Math.PI;
  };
  const fresnel = (l: THREE.Vector3) => {
    const h = l.clone().add(new THREE.Vector3(0, 0, 1)).normalize();
    return 0.04 + 0.96 * (1 - Math.max(0, h.z)) ** 5;
  };
  for (const l of lights) {
    if (l.kind === 'ambient') add(lin(l.colour), l.intensity * 0.96);
    else if (l.kind === 'hemisphere') add(lin(l.sky), l.intensity * 0.96);
    else if (l.kind === 'directional') {
      const d = new THREE.Vector3(...l.position).sub(new THREE.Vector3(...(l.target ?? [0, 0, 0]))).normalize();
      add(lin(l.colour), l.intensity * Math.max(0, d.z) * (1 - fresnel(d)));
    } else if (l.kind === 'spot') {
      const p = new THREE.Vector3(...l.position);
      const toPoint = new THREE.Vector3(x, y, 0).sub(p);
      const axis = new THREE.Vector3(...(l.target ?? [0, 0, 0])).sub(p).normalize();
      const cos = toPoint.clone().normalize().dot(axis);
      const cone = Math.cos((l.angleDeg * Math.PI) / 180);
      const pen = Math.cos((l.angleDeg * (1 - l.penumbra) * Math.PI) / 180);
      const t = Math.min(1, Math.max(0, (cos - cone) / (pen - cone)));
      const att = t * t * (3 - 2 * t);
      const dir = toPoint.clone().negate().normalize();
      add(lin(l.colour), l.intensity * att * Math.max(0, dir.z) * (1 - fresnel(dir)));
    }
  }
  return out;
}

/** The sRGB hex a surface of `spec` shows at table point (x, y) from above. */
export function surfaceAt(spec: MaterialSpec, lights: readonly LightSpec[], x: number, y: number): string {
  const c = lin(spec.colour);
  const m = mapAverage(spec);
  const l = lightAt(lights, x, y);
  return `#${new THREE.Color(c[0] * m[0] * l[0], c[1] * m[1] * l[1], c[2] * m[2] * l[2]).getHexString()}`;
}
