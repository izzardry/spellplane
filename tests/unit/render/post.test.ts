// DESIGN "Themes and rendering", Lighting and post-processing: bloom, vignette, tone mapping; theme-specific passes
// (Wyrm's shimmer) through SceneContext.post; a quality level drops post-processing. scene/types.ts PostPipeline.
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { describe, expect, it, vi } from 'vitest';
import { createPostPipeline } from '../../../src/scene/post';
import type { PostSettings, QualityLevel } from '../../../src/themes/types';
import { fakeRenderer } from './fakes';

const on: QualityLevel = { id: 'high', shadows: true, post: true, particles: true, pixelRatio: 2, msaa: 0 };
const off: QualityLevel = { ...on, id: 'low', shadows: false, post: false };
const full: PostSettings = { bloom: { strength: 1, radius: 0.5, threshold: 0.8 }, vignette: { darkness: 0.5, offset: 1 } };
const none: PostSettings = { bloom: null, vignette: null };

class Marker extends Pass {
  override render(): void {}
}

function pipeline(glow = false) {
  const p = createPostPipeline(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), glow ? { glow: () => [], overlay: new THREE.Scene() } : {});
  p.setSize(800, 600, 1);
  return p;
}

describe('PostPipeline', () => {
  it('runs render, bloom, vignette and output in that order while the level allows post', () => {
    const p = pipeline();
    p.configure(full, on);
    expect(p.active).toBe(true);
    expect(p.passes()).toEqual(['render', 'bloom', 'vignette', 'output']);
    expect(p.textureBytes()).toBeGreaterThan(0);
  });

  it('draws the glow sources into the bloomed image only while bloom is on', () => {
    const p = pipeline(true);
    p.configure(full, on);
    expect(p.passes()).toEqual(['render', 'glow', 'bloom', 'vignette', 'output']);
    p.configure({ ...full, bloom: null }, on);
    expect(p.passes()).toEqual(['render', 'vignette', 'output']);
  });

  it('is a plain render with post off by the level, even with bloom, vignette or theme passes', () => {
    const p = pipeline();
    p.addPass('shimmer', new Marker());
    p.configure(full, off);
    expect(p.active).toBe(false);
    expect(p.passes()).toEqual([]);
    expect(p.textureBytes()).toBe(0);
  });

  it('is a plain render when the theme has no pass at all', () => {
    const p = pipeline();
    p.configure(none, on);
    expect(p.active).toBe(false);
    expect(p.passes()).toEqual([]);
  });

  it('inserts theme passes before the output pass in ascending order, ties in insertion order', () => {
    const p = pipeline();
    p.configure(full, on);
    p.addPass('shimmer', new Marker());
    p.addPass('late', new Marker(), 950);
    p.addPass('early', new Marker(), 50);
    p.addPass('shimmer-2', new Marker());
    expect(p.passes()).toEqual(['render', 'early', 'bloom', 'shimmer', 'shimmer-2', 'vignette', 'late', 'output']);
    p.removePass('shimmer');
    p.removePass('nope');
    expect(p.passes()).toEqual(['render', 'early', 'bloom', 'shimmer-2', 'vignette', 'late', 'output']);
  });

  it('a theme pass alone turns the chain on, and removing it turns it off again', () => {
    const p = pipeline();
    p.configure(none, on);
    const pass = new Marker();
    const dispose = vi.spyOn(pass, 'dispose');
    p.addPass('shimmer', pass);
    expect(p.passes()).toEqual(['render', 'shimmer', 'output']);
    p.removePass('shimmer');
    expect(p.active).toBe(false);
    // The theme owns its pass: the pipeline never disposes it.
    expect(dispose).not.toHaveBeenCalled();
  });

  it('keeps theme passes across a reconfiguration (quality change) and frees its own passes', () => {
    const p = pipeline();
    p.configure(full, on);
    p.addPass('shimmer', new Marker());
    const composer = p.composer!;
    const bloom = composer.passes.find((x) => x.constructor.name === 'UnrealBloomPass')!;
    const freed = vi.spyOn(bloom, 'dispose');
    const rt = vi.spyOn(composer, 'dispose');
    p.configure(full, off);
    expect(freed).toHaveBeenCalledTimes(1);
    expect(rt).toHaveBeenCalledTimes(1);
    expect(p.passes()).toEqual([]);
    p.configure(full, on);
    expect(p.passes()).toEqual(['render', 'bloom', 'shimmer', 'vignette', 'output']);
    p.dispose();
    expect(p.passes()).toEqual([]);
    expect(p.active).toBe(false);
  });

  it('applies the theme settings to bloom and vignette', () => {
    const p = pipeline();
    p.configure({ bloom: { strength: 1.4, radius: 0.7, threshold: 0.1 }, vignette: { darkness: 1.6, offset: 1.1 } }, on);
    const passes = p.composer!.passes as unknown as { strength?: number; radius?: number; threshold?: number; uniforms?: Record<string, { value: number }> }[];
    expect(passes[1]).toMatchObject({ strength: 1.4, radius: 0.7, threshold: 0.1 });
    expect(passes[2]!.uniforms!.darkness!.value).toBe(1.6);
    expect(passes[2]!.uniforms!.offset!.value).toBe(1.1);
  });
});
