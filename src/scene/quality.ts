/**
 * Quality levels (DESIGN "Themes and rendering", Renderer: "a per-theme quality setting drops shadows and
 * post-processing first"). The level for a setting is themes/types.ts `qualityLevel`; what a level means for one
 * theme is `effectiveQuality` (pure), and applying it to the renderer is `applyQuality`. Implemented by M4-P2.
 *
 * What a level controls: shadow maps and contact shadows (`shadows`), the post-processing chain (`post`, which also
 * carries the MSAA samples of its render target), theme particles (`particles`, read by the theme), the device pixel
 * ratio cap and the anisotropic filtering of card textures (clamped to the GPU's maximum).
 */
import * as THREE from 'three';
import { QUALITY_DROP_ORDER, type PostSettings, type QualityId, type QualityLevel, type ShadowSettings } from '../themes/types';

/** What one quality level turns on for one theme, after the theme's own settings and the device's limits. */
export interface EffectiveQuality {
  id: QualityId;
  /** Shadow-map shadows: the level allows shadows, the theme has them on by default and gives a shadow map. */
  shadowMap: boolean;
  /** Soft contact shadows under cards: the level allows shadows and the theme gives contact shadows. */
  contactShadows: boolean;
  /** The post-processing chain runs (bloom, vignette, theme passes): the level allows post and the theme has a pass. */
  post: boolean;
  particles: boolean;
  /** Device pixel ratio used: min(device, level cap). */
  pixelRatio: number;
  /** Anisotropic filtering samples of card textures, 1 = off. */
  anisotropy: number;
  /** MSAA samples of the post-processing render target (0 with post off). */
  msaa: number;
  /** Shadow map size in px. */
  shadowMapSize: number;
}

/** Device limits the effective level is clamped to. */
export interface DeviceLimits {
  devicePixelRatio: number;
  maxAnisotropy: number;
  /** Largest MSAA sample count of a render target (WebGL2 MAX_SAMPLES). */
  maxSamples: number;
}

/**
 * What `level` turns on under `theme` on a device (DESIGN "Themes and rendering", Renderer and Defaults: "whether
 * shadows are on"). `hasThemePasses` counts theme-specific passes (Wyrm's shimmer), which also need post on.
 */
export function effectiveQuality(level: QualityLevel, theme: { shadows: ShadowSettings; post: PostSettings }, device: DeviceLimits, hasThemePasses = false): EffectiveQuality {
  const shadowsOn = level.shadows && theme.shadows.enabled;
  const anyPass = theme.post.bloom !== null || theme.post.vignette !== null || hasThemePasses;
  const post = level.post && anyPass;
  return {
    id: level.id,
    shadowMap: shadowsOn && theme.shadows.map !== null,
    contactShadows: shadowsOn && theme.shadows.contact !== null,
    post,
    particles: level.particles,
    pixelRatio: Math.max(0.5, Math.min(device.devicePixelRatio || 1, level.pixelRatio)),
    anisotropy: Math.max(1, Math.min(Math.floor(level.anisotropy ?? 1), Math.max(1, device.maxAnisotropy))),
    msaa: post ? Math.max(0, Math.min(Math.floor(level.msaa ?? 0), device.maxSamples)) : 0,
    shadowMapSize: Math.max(64, level.shadowMapSize ?? theme.shadows.map?.mapSize ?? 1024),
  };
}

/** The renderer's limits for effectiveQuality. */
export function deviceLimits(renderer: THREE.WebGLRenderer): DeviceLimits {
  return {
    devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    maxSamples: renderer.capabilities.maxSamples,
  };
}

const SHADOW_TYPES: Record<NonNullable<ShadowSettings['map']>['type'], THREE.ShadowMapType> = {
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  // three r18x removed PCFSoftShadowMap (it warns and falls back to PCF); PCF with the theme's `radius` is the soft look.
  pcfSoft: THREE.PCFShadowMap,
  vsm: THREE.VSMShadowMap,
};

/** Apply pixel ratio, shadow maps and anisotropy limits of `level` to the renderer, within the theme's shadow settings. */
export function applyQuality(renderer: THREE.WebGLRenderer, level: QualityLevel, shadows: ShadowSettings): void {
  const eff = effectiveQuality(level, { shadows, post: { bloom: null, vignette: null } }, deviceLimits(renderer));
  if (renderer.getPixelRatio() !== eff.pixelRatio) renderer.setPixelRatio(eff.pixelRatio);
  const type = shadows.map ? SHADOW_TYPES[shadows.map.type] : THREE.PCFShadowMap;
  if (renderer.shadowMap.enabled !== eff.shadowMap || renderer.shadowMap.type !== type) {
    renderer.shadowMap.enabled = eff.shadowMap;
    renderer.shadowMap.type = type;
    renderer.shadowMap.needsUpdate = true;
  }
}

/**
 * Problems with a theme's quality ladder (DESIGN "Themes and rendering", Renderer: a lower level "drops shadows and
 * post-processing first"); [] when it is sound. Levels are ordered best first with distinct ids in rank order; no
 * level turns on what a better one has off or raises a number a better one caps; and a feature in QUALITY_DROP_ORDER
 * (shadows, post, particles, pixel ratio) is only reduced once every feature before it is off.
 */
export function qualityLadderProblems(levels: readonly QualityLevel[]): string[] {
  const problems: string[] = [];
  if (levels.length === 0) return ['no quality levels'];
  const rank: Record<QualityId, number> = { high: 0, medium: 1, low: 2 };
  const best = levels[0]!;
  levels.forEach((l, i) => {
    if (l.pixelRatio <= 0) problems.push(`${l.id}: pixelRatio must be positive`);
    if (i === 0) return;
    const a = levels[i - 1]!;
    if (rank[l.id] <= rank[a.id]) problems.push(`${l.id} is listed after ${a.id}: levels go best first`);
    for (const f of ['shadows', 'post', 'particles'] as const) if (l[f] && !a[f]) problems.push(`${l.id} turns ${f} back on`);
    if (l.pixelRatio > a.pixelRatio) problems.push(`${l.id} raises the pixel ratio`);
    if ((l.anisotropy ?? 1) > (a.anisotropy ?? 1)) problems.push(`${l.id} raises anisotropy`);
    if ((l.msaa ?? 0) > (a.msaa ?? 0)) problems.push(`${l.id} raises msaa`);
    if (l.shadowMapSize !== undefined && a.shadowMapSize !== undefined && l.shadowMapSize > a.shadowMapSize) problems.push(`${l.id} raises the shadow map size`);
    // Drop order: reducing feature k needs every feature before it already off.
    const reduced = (f: (typeof QUALITY_DROP_ORDER)[number]): boolean => (f === 'pixelRatio' ? l.pixelRatio < best.pixelRatio : !l[f] && best[f]);
    const off = (f: (typeof QUALITY_DROP_ORDER)[number]): boolean => (f === 'pixelRatio' ? false : !l[f]);
    QUALITY_DROP_ORDER.forEach((f, k) => {
      if (!reduced(f)) return;
      for (const before of QUALITY_DROP_ORDER.slice(0, k)) if (!off(before)) problems.push(`${l.id} drops ${f} before ${before}`);
    });
  });
  return problems;
}

const appliedAnisotropy = new WeakMap<THREE.Texture, number>();

/**
 * Set the anisotropic filtering of an uploaded texture in place (quality level), without re-uploading it: card face
 * arrays are filled by GPU copies, so a re-upload would wipe them. Returns whether the GL parameter changed.
 */
export function setTextureAnisotropy(renderer: THREE.WebGLRenderer, texture: THREE.Texture, samples: number): boolean {
  const n = Math.max(1, Math.min(Math.floor(samples), renderer.capabilities.getMaxAnisotropy() || 1));
  if (appliedAnisotropy.get(texture) === n) return false;
  const props = renderer.properties.get(texture) as { __webglTexture?: WebGLTexture; __currentAnisotropy?: number };
  if (!props.__webglTexture || !renderer.extensions.has('EXT_texture_filter_anisotropic')) return false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = renderer.extensions.get('EXT_texture_filter_anisotropic') as { TEXTURE_MAX_ANISOTROPY_EXT: number };
  const target = (texture as THREE.DataArrayTexture).isDataArrayTexture ? gl.TEXTURE_2D_ARRAY : (texture as THREE.Data3DTexture).isData3DTexture ? gl.TEXTURE_3D : gl.TEXTURE_2D;
  renderer.state.bindTexture(target, props.__webglTexture);
  gl.texParameterf(target, ext.TEXTURE_MAX_ANISOTROPY_EXT, n);
  renderer.state.unbindTexture();
  texture.anisotropy = n;
  props.__currentAnisotropy = n;
  appliedAnisotropy.set(texture, n);
  return true;
}
