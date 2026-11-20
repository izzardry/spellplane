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
import { qualityLevel, type MarkRect, type QualityId, type QualityLevel, type SceneContext, type TableMarks, type Theme, type ThemeInstance } from '../themes/types';
import { applyLightShadows, CAST_SHADOW, createLightRig, keyLightOf, type LightRig } from './lights';
import { createMaterialLibrary, keyLightUniform, type MaterialLibraryImpl } from './materials';
import { createPostPipeline, type PostPipelineImpl } from './post';
import { normDeg, rot2 } from './math';
import { applyQuality, deviceLimits, effectiveQuality, type EffectiveQuality } from './quality';

const TONE_MAPPING: Record<Theme['lighting']['toneMapping'], THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

/**
 * An optional member of a theme's instance (M7-A0): whether anything of the theme moves by itself (particles, a breathing
 * glow, a time uniform). A still lit theme draws only when something changes; without the member a lit theme counts as
 * animated, as before. It belongs in themes/types.ts ThemeInstance; until a contracts package adds it there, a theme
 * returns `ThemeInstance & StillAware`.
 */
export interface StillAware {
  animating?(): boolean;
}

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
  /**
   * Degrees clockwise the theme's table is turned about the table centre (absent: 0). The three-player table turns the
   * camera's table to each viewer (scene/layout.ts cameraTable; M5-P7); the theme is then built as for a viewer at
   * `viewerAngle - tableRot` and its objects turned by `tableRot`, so every viewer sees the same upright table. The
   * light rig and the key light stand at `viewerAngle` as before, which is where the turned theme expects them.
   */
  tableRot?: number;
}

/** The turn of three's world (x = table x, y = up, z = -table y) that turns table points by `deg` clockwise (rot2). */
export function tableTurnMatrix(deg: number): THREE.Matrix4 {
  const [ax, ay] = rot2(1, 0, deg);
  const [bx, by] = rot2(0, -1, deg);
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(ax, 0, -ay), new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx, 0, -by));
}

/** Marks turned `deg` clockwise about the table centre (scene/math.ts rot2). Added by M7-P1. */
export function turnMarks(m: TableMarks, deg: number): TableMarks {
  if (!deg) return m;
  const pt = (x: number, y: number) => {
    const [a, b] = rot2(x, y, deg);
    return { x: a, y: b };
  };
  const rect = (r: MarkRect): MarkRect => ({ ...r, ...pt(r.x, r.y), rot: normDeg(r.rot + deg) });
  return {
    viewerAngle: normDeg(m.viewerAngle + deg),
    seats: m.seats.map((s) => ({ ...s, territory: rect(s.territory), avatar: s.avatar ? pt(s.avatar.x, s.avatar.y) : null, angle: normDeg(s.angle + deg) })),
    piles: m.piles.map((p) => ({ ...p, ...pt(p.x, p.y), rot: normDeg(p.rot + deg) })),
    areas: m.areas.map((a) => ({ ...a, rect: rect(a.rect) })),
  };
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
  /** The adaptive render scale on the pixel ratio (scene/resolution.ts), 1 = the level's. */
  private scale = 1;
  /** A cap on the pixel ratio (scene/switches.ts `pr=`), or null. */
  private pixelRatioCap: number | null = null;
  /** The table's marks in the canonical frame (M7-P1), handed to every build of a theme that draws them. */
  private marks: TableMarks | null = null;

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

  /** The level's pixel ratio within the cap: what the scene draws at rest. */
  get fullPixelRatio(): number {
    const pr = this.effective.pixelRatio;
    return this.pixelRatioCap !== null ? Math.min(pr, this.pixelRatioCap) : pr;
  }

  /** The adaptive render scale in effect. */
  get renderScale(): number {
    return this.scale;
  }

  /** Cap the pixel ratio (null: the level's). */
  setPixelRatioCap(cap: number | null): void {
    this.pixelRatioCap = cap !== null && cap > 0 ? cap : null;
    this.applyPixelRatio();
  }

  /**
   * Draw at `scale` times the full pixel ratio (scene/resolution.ts). Resizes the canvas and the post targets (without
   * rebuilding the chain); returns whether anything changed.
   */
  setRenderScale(scale: number): boolean {
    const s = scale > 0 ? Math.min(1, scale) : 1;
    if (s === this.scale) return false;
    this.scale = s;
    return this.applyPixelRatio();
  }

  /** The pixel ratio for the level, cap and scale on the renderer and the post targets; whether it changed. */
  private applyPixelRatio(): boolean {
    const pr = this.fullPixelRatio * this.scale;
    const changed = this.renderer.getPixelRatio() !== pr;
    if (changed) {
      this.renderer.setPixelRatio(pr);
      if (this.sized) this.renderer.setSize(this.size.w, this.size.h, false);
    }
    this.post.setSamplesBasis(this.fullPixelRatio);
    this.post.setSize(this.size.w, this.size.h, this.renderer.getPixelRatio());
    return changed;
  }

  /** What the quality level sets: pixel ratio, shadow maps, the post chain and anisotropy. */
  private applyLevel(): void {
    const t = this.theme;
    const before = this.renderer.getPixelRatio();
    applyQuality(this.renderer, this.level, t.shadows, this.fullPixelRatio * this.scale);
    if (this.sized && this.renderer.getPixelRatio() !== before) this.renderer.setSize(this.size.w, this.size.h, false);
    this.post.setSamplesBasis(this.fullPixelRatio);
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
    const turn = normDeg(p.tableRot ?? 0);
    const ctx: SceneContext = {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      table: p.table,
      quality: this.level,
      reducedMotion: p.reducedMotion,
      materials: this.materials,
      viewerAngle: normDeg(p.viewerAngle - turn),
      ...(this.opts.post ? { post: this.post } : {}),
    };
    const before = new Set(this.scene.children);
    this.instance = t.build(ctx);
    if (turn) {
      // Turn what the theme added about the table centre (its top-level objects stay the scene's children, so its own
      // dispose still removes them); a light's target outside the scene graph turns with it.
      const m = tableTurnMatrix(turn);
      for (const o of this.scene.children) {
        if (before.has(o)) continue;
        o.applyMatrix4(m);
        o.traverse((x) => {
          const target = (x as THREE.Object3D & { target?: THREE.Object3D }).target;
          if (target instanceof THREE.Object3D && !target.parent) target.applyMatrix4(m);
        });
      }
    }
    this.applyShadows();
    this.forwardMarks();
    const key = t.lighting.lit ? keyLightOf(t.lighting.lights, p.viewerAngle) : null;
    keyLightUniform(key, this.keyLight);
    this.materials.setKeyLight(key);
  }

  /**
   * The zones of the current table for the theme's own pile and zone marks (themes/types.ts ThemeInstance.setMarks;
   * M7-P1). Kept and handed to every later build; given in the canonical table frame, passed on in the frame the theme
   * was built in (turned back by `tableRot`, which the runtime then applies to the theme's objects).
   */
  setMarks(marks: TableMarks | null): void {
    this.marks = marks;
    this.forwardMarks();
  }

  private forwardMarks(): void {
    if (!this.marks || !this.instance?.setMarks) return;
    this.instance.setMarks(turnMarks(this.marks, -normDeg(this.placement.tableRot ?? 0)));
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

  /**
   * Whether the theme changes with time with nothing else changing (scene/table-scene.ts draws ambient frames for it):
   * a lit theme does unless its instance says it is still and no light flickers. Paper (unlit) never does.
   */
  animating(): boolean {
    if (!this.theme.lighting.lit) return false;
    if (this.rig?.flickers) return true;
    const still = this.instance as (ThemeInstance & StillAware) | null;
    return still?.animating ? still.animating() : true;
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
