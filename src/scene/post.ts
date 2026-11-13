/**
 * Post-processing (DESIGN "Themes and rendering", Lighting and post-processing: bloom, vignette, tone mapping), built
 * from three's examples/jsm passes (EffectComposer, RenderPass, UnrealBloomPass, ShaderPass with VignetteShader,
 * OutputPass). Stub by M4-C; implemented by M4-P2 (scene/post.ts).
 */
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { PostPipeline } from './types';

/** The scene's post-processing pipeline; with post off it renders directly. Stub: M4-P2. */
export function createPostPipeline(_renderer: WebGLRenderer, _scene: Scene, _camera: PerspectiveCamera): PostPipeline {
  throw new Error('not implemented: M4-P2 (post-processing)');
}
