/**
 * A theme living in a surface (DESIGN "Themes and rendering": one scene renders every theme; themes switch mid-game
 * without reloading). Owns the material library and the post-processing pipeline of one renderer, applies a theme's
 * lighting, tone mapping, shadow and post settings within the viewer's quality level, builds the light rig from
 * `lighting.lights`, and builds and disposes the theme. Used by the table scene (with post-processing and the overlay)
 * and the draft and builder surfaces (without post-processing). Added by M4-P2.
 *
 * Hot-swap: `setTheme` disposes the old theme (its objects, passes and released materials, its lights and shadow
 * maps) before building the new one, so GPU textures do not pile up across switches (PLAN M4-P2).
 */
import * as THREE from 'three';
import { qualityLevel, type QualityId, type QualityLevel, type SceneContext, type Theme, type ThemeInstance } from '../themes/types';
import { applyLightShadows, CAST_SHADOW, createLightRig, keyLightOf, type LightRig } from './lights';
import { createMaterialLibrary, keyLightUniform, type MaterialLibraryImpl } from './materials';
import { createPostPipeline, type PostPipelineImpl } from './post';
import { applyQuality, deviceLimits, effectiveQuality, type EffectiveQuality } from './quality';

const TONE_MAPPING: Record<Theme['lighting']['toneMapping'], THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

export interface ThemeRuntimeOptions {
  /** Post-processing on this surface (the table); the pre-game surfaces render without it. */
  post: boolean;
  /** Drawn after post-processing without tone mapping (scene/post.ts): card faces, text and lines over the cards. */
  overlay?: THREE.Object3D;
  /** Objects that glow under bloom (scene/post.ts). */
  glow?: () => THREE.Object3D[];
}

/** Where the theme is built: table size, the viewer's seat angle and reduced motion. */
export interface ThemePlacement {
  table: { w: number; d: number };
  viewerAngle: number;
  reducedMotion: boolean;
}

export class ThemeRuntime {
  readonly materials: MaterialLibraryImpl;
  readonly post: PostPipelineImpl;
  /** The key light as the card shader's uniform (scene/materials.ts keyLightUniform). */
  readonly keyLight = new THREE.Vector4(0, 1, 0, -1);
  theme: Theme;
  level: QualityLevel;
  effective: EffectiveQuality;
  private instance: ThemeInstance | null = null;
  private rig: LightRig | null = null;
  private placement: ThemePlacement;
  private qualityId: QualityId;
  private time = 0;
  private size = { w: 1, h: 1 };
  private sized = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private opts: ThemeRuntimeOptions,
    theme: Theme,
    placement: ThemePlacement,
    qualityId: QualityId = 'high',
  ) {
    this.materials = createMaterialLibrary(renderer);
    this.post = createPostPipeline(renderer, scene, camera, { ...(opts.overlay ? { overlay: opts.overlay } : {}), ...(opts.glow ? { glow: opts.glow } : {}) });
    this.theme = theme;
    this.placement = placement;
    this.qualityId = qualityId;
    this.level = qualityLevel(theme, qualityId);
    this.effective = this.resolve();
    this.build();
  }

  /** The quality setting the viewer chose (the theme's level for it is `level`). */
  get qualityChoice(): QualityId {
    return this.qualityId;
  }

  private resolve(): EffectiveQuality {
    const eff = effectiveQuality(this.level, this.theme, deviceLimits(this.renderer));
    return this.opts.post ? eff : { ...eff, post: false, msaa: 0 };
  }

  /** Lighting, tone mapping, pixel ratio, shadow maps, post chain and anisotropy for the current theme and level. */
  /** Tone mapping, exposure, background and fog of the theme (before its build, which may change the background). */
  private applyLighting(): void {
    const t = this.theme;
    const lit = t.lighting.lit;
    this.renderer.toneMapping = lit ? TONE_MAPPING[t.lighting.toneMapping] : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = lit ? t.lighting.exposure : 1;
    this.scene.background = new THREE.Color(t.lighting.background);
    this.scene.fog = lit && t.lighting.fog ? new THREE.Fog(t.lighting.fog.colour, t.lighting.fog.near, t.lighting.fog.far) : null;
  }

  /** What the quality level sets: pixel ratio, shadow maps, the post chain and anisotropy. */
  private applyLevel(): void {
    const t = this.theme;
    const before = this.renderer.getPixelRatio();
    applyQuality(this.renderer, this.level, t.shadows);
    if (this.sized && this.renderer.getPixelRatio() !== before) this.renderer.setSize(this.size.w, this.size.h, false);
    this.post.setSize(this.size.w, this.size.h, this.renderer.getPixelRatio());
    const postLevel: QualityLevel = { ...this.level, post: this.opts.post && this.level.post };
    this.post.configure(this.opts.post ? t.post : { bloom: null, vignette: null }, postLevel);
    this.materials.setAnisotropy(this.effective.anisotropy);
  }

  private build(): void {
    this.applyLighting();
    this.applyLevel();
    const t = this.theme;
    const p = this.placement;
    if (t.lighting.lit && t.lighting.lights.length) {
      this.rig = createLightRig(t.lighting.lights, { viewerAngle: p.viewerAngle, table: p.table, reducedMotion: p.reducedMotion });
      this.scene.add(this.rig.object);
    }
    const ctx: SceneContext = {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      table: p.table,
      quality: this.level,
      reducedMotion: p.reducedMotion,
      materials: this.materials,
      viewerAngle: p.viewerAngle,
      ...(this.opts.post ? { post: this.post } : {}),
    };
    this.instance = t.build(ctx);
    this.applyShadows();
    const key = t.lighting.lit ? keyLightOf(t.lighting.lights, p.viewerAngle) : null;
    keyLightUniform(key, this.keyLight);
    this.materials.setKeyLight(key);
  }

  /** Shadow maps on the lights that ask for them (the rig's and the theme's own). */
  private applyShadows(): void {
    this.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && l.castShadow && l.userData[CAST_SHADOW] === undefined) l.userData[CAST_SHADOW] = true;
    });
    const map = this.theme.shadows.map;
    applyLightShadows(this.scene, this.effective.shadowMap, map, this.effective.shadowMapSize);
  }

  private teardown(): void {
    this.instance?.dispose();
    this.instance = null;
    this.rig?.dispose();
    this.rig = null;
  }

  /** Swap to `theme` (hot-swap): the old theme and its GPU resources go first. */
  setTheme(theme: Theme, placement: ThemePlacement = this.placement): void {
    this.teardown();
    this.theme = theme;
    this.placement = placement;
    this.level = qualityLevel(theme, this.qualityId);
    this.effective = this.resolve();
    this.build();
  }

  /** Rebuild the current theme for another table, seat or reduced-motion setting. */
  rebuild(placement: ThemePlacement = this.placement): void {
    this.setTheme(this.theme, placement);
  }

  /** Apply another quality setting without reload; the theme rebuilds unless it applies the level itself. */
  setQuality(id: QualityId): void {
    this.qualityId = id;
    const prev = this.effective;
    this.level = qualityLevel(this.theme, id);
    this.effective = this.resolve();
    const shadowsChanged = prev.shadowMap !== this.effective.shadowMap || prev.shadowMapSize !== this.effective.shadowMapSize;
    if (this.instance?.setQuality) {
      this.applyLevel();
      this.instance.setQuality(this.level);
      this.applyShadows();
    } else {
      this.teardown();
      this.build();
    }
    if (shadowsChanged) {
      // Shadow receivers compile with or without shadow code: recompile what stays alive.
      this.materials.invalidate();
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
      });
    }
  }

  setSize(width: number, height: number): void {
    this.size = { w: Math.max(1, width), h: Math.max(1, height) };
    this.sized = true;
    this.post.setSize(this.size.w, this.size.h, this.renderer.getPixelRatio());
  }

  /** Advance the theme (particles, flicker) by `dtMs`. */
  update(dtMs: number): void {
    this.time += dtMs;
    this.rig?.update(this.time);
    this.instance?.update(dtMs);
  }

  setStackFocus(at: { x: number; y: number } | null): void {
    this.instance?.setStackFocus?.(at);
  }

  /** Draw a frame: the world through the post chain (or directly), then the overlay. */
  render(dtMs: number): void {
    this.post.render(dtMs);
  }

  /** Approximate bytes of GPU textures the pipeline owns: post render targets and shadow maps. */
  textureBytes(): number {
    let bytes = this.post.textureBytes();
    this.scene.traverse((o) => {
      const l = o as THREE.Light & { shadow?: THREE.LightShadow };
      if (l.isLight && l.castShadow && l.shadow?.map) {
        const faces = (l as THREE.PointLight).isPointLight ? 6 : 1;
        bytes += l.shadow.mapSize.x * l.shadow.mapSize.y * 4 * faces;
      }
    });
    return bytes;
  }

  dispose(): void {
    this.teardown();
    this.post.dispose();
    this.materials.dispose();
    this.scene.fog = null;
  }
}
