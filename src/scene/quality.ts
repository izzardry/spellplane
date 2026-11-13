/**
 * Quality levels (DESIGN "Themes and rendering", Renderer: "a per-theme quality setting drops shadows and
 * post-processing first"). The level for a setting is themes/types.ts `qualityLevel`; applying it to the renderer is
 * here. Stub by M4-C; implemented by M4-P2 (scene/quality.ts).
 */
import type { WebGLRenderer } from 'three';
import type { QualityLevel, ShadowSettings } from '../themes/types';

/** Apply pixel ratio, shadow maps and anisotropy limits of `level` to the renderer, within the theme's shadow settings. Stub: M4-P2. */
export function applyQuality(_renderer: WebGLRenderer, _level: QualityLevel, _shadows: ShadowSettings): void {
  throw new Error('not implemented: M4-P2 (quality)');
}
