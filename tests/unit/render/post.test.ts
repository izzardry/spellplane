// DESIGN "Themes and rendering", Lighting and post-processing: bloom, vignette, tone mapping; theme-specific passes
// (Wyrm's shimmer) through SceneContext.post; a quality level drops post-processing. scene/types.ts PostPipeline.
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { describe, expect, it, vi } from 'vitest';
import { createPostPipeline, GLOW_MIN_DEVICE_PX, glowWidthPx, POST_TARGET_BUDGET, postBytes, postSamples } from '../../../src/scene/post';
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

describe('post chain memory (PLAN M4 Performance: texture memory under 400 MB)', () => {
  it('keeps the MSAA samples a level asks for while both targets fit the budget', () => {
    expect(postSamples(4, 1440, 900, 8)).toBe(4);
    expect(postSamples(4, 1440, 900, 2)).toBe(2);
    expect(postSamples(0, 1440, 900, 8)).toBe(0);
  });

  it('drops MSAA on a high-density or very large screen, and stays inside the budget', () => {
    expect(postSamples(4, 2880, 1800, 8)).toBe(0);
    expect(postSamples(4, 3840, 2160, 8)).toBe(0);
    for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080], [2560, 1440], [2880, 1800]] as const) {
      const s = postSamples(8, w, h, 8);
      expect(postBytes(w, h, s, false), `${w}x${h}`).toBeLessThanOrEqual(POST_TARGET_BUDGET);
    }
  });

  it('counts both targets with their sample buffers and the bloom chain', () => {
    const base = 100 * 100 * 8;
    expect(postBytes(100, 100, 0, false)).toBe(2 * base);
    expect(postBytes(100, 100, 4, false)).toBe(10 * base);
    expect(postBytes(100, 100, 0, true)).toBe(Math.round(2 * base + base / 4 + (2 * base) / 3));
  });

  it('draws a glow copy at least 4 device px wide, whatever the pixel ratio, and never thinner than the stroke', () => {
    // The bloom's bright pass samples every 2 × 2 pixels once: a 3 px stroke can fall between two sample rows.
    expect(GLOW_MIN_DEVICE_PX).toBe(4);
    expect(glowWidthPx(3, 1)).toBe(4);
    expect(glowWidthPx(1.5, 2)).toBe(2);
    expect(glowWidthPx(3, 2)).toBe(3);
    expect(glowWidthPx(6, 1)).toBe(6);
    expect(glowWidthPx(2, 0)).toBe(4);
  });
});
