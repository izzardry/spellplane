// DESIGN "Themes and rendering", Renderer: "a per-theme quality setting drops shadows and post-processing first";
// Defaults: "whether shadows are on". PLAN M4-P2: quality levels that drop shadows and post-processing first.
import { describe, expect, it } from 'vitest';
import { effectiveQuality, qualityLadderProblems, type DeviceLimits } from '../../../src/scene/quality';
import { litTestTheme } from '../../../src/themes/test-lit';
import { loadTheme, THEME_IDS, type QualityLevel, type Theme } from '../../../src/themes/index';

const device: DeviceLimits = { devicePixelRatio: 2, maxAnisotropy: 16, maxSamples: 8 };
const lit = litTestTheme();
const level = (id: QualityLevel['id']) => lit.quality.find((l) => l.id === id)!;

describe('effectiveQuality', () => {
  it('turns everything on at the best level of a lit theme', () => {
    expect(effectiveQuality(level('high'), lit, device)).toEqual({ id: 'high', shadowMap: true, contactShadows: true, post: true, particles: true, pixelRatio: 2, anisotropy: 8, msaa: 4, shadowMapSize: 2048 });
  });

  it('drops shadows first (medium), then post-processing (low)', () => {
    const medium = effectiveQuality(level('medium'), lit, device);
    expect(medium).toMatchObject({ shadowMap: false, contactShadows: false, post: true, particles: true });
    const low = effectiveQuality(level('low'), lit, device);
    expect(low).toMatchObject({ shadowMap: false, contactShadows: false, post: false, msaa: 0, anisotropy: 1, pixelRatio: 1 });
  });

  it('clamps to the device: pixel ratio, anisotropy and MSAA samples', () => {
    const small: DeviceLimits = { devicePixelRatio: 1, maxAnisotropy: 2, maxSamples: 2 };
    expect(effectiveQuality(level('high'), lit, small)).toMatchObject({ pixelRatio: 1, anisotropy: 2, msaa: 2 });
    // No anisotropic filtering at all on the GPU: 1 (off).
    expect(effectiveQuality(level('high'), lit, { ...small, maxAnisotropy: 0 }).anisotropy).toBe(1);
  });

  it("keeps a theme's own choices: shadows off by default, no shadow map, no passes", () => {
    const noShadows: Pick<Theme, 'shadows' | 'post'> = { shadows: { ...lit.shadows, enabled: false }, post: lit.post };
    expect(effectiveQuality(level('high'), noShadows, device)).toMatchObject({ shadowMap: false, contactShadows: false });
    const contactOnly: Pick<Theme, 'shadows' | 'post'> = { shadows: { ...lit.shadows, map: null }, post: lit.post };
    expect(effectiveQuality(level('high'), contactOnly, device)).toMatchObject({ shadowMap: false, contactShadows: true });
    const noPost: Pick<Theme, 'shadows' | 'post'> = { shadows: lit.shadows, post: { bloom: null, vignette: null } };
    expect(effectiveQuality(level('high'), noPost, device)).toMatchObject({ post: false, msaa: 0 });
    // A theme-specific pass (Wyrm's shimmer) alone needs the chain.
    expect(effectiveQuality(level('high'), noPost, device, true).post).toBe(true);
    // The level's shadow map size wins over the theme's, which is the fallback.
    expect(effectiveQuality({ ...level('high'), shadowMapSize: undefined }, lit, device).shadowMapSize).toBe(2048);
    expect(effectiveQuality({ ...level('high'), shadowMapSize: 1024 }, lit, device).shadowMapSize).toBe(1024);
  });
});

describe('qualityLadderProblems', () => {
  const best: QualityLevel = { id: 'high', shadows: true, post: true, particles: true, pixelRatio: 2, anisotropy: 8, msaa: 4 };

  it('accepts a ladder that drops shadows, then post, then particles and resolution', () => {
    expect(
      qualityLadderProblems([
        best,
        { ...best, id: 'medium', shadows: false, msaa: 0 },
        { id: 'low', shadows: false, post: false, particles: false, pixelRatio: 1, anisotropy: 1 },
      ]),
    ).toEqual([]);
  });

  it('rejects dropping post-processing while shadows stay, and particles or resolution while either stays', () => {
    expect(qualityLadderProblems([best, { ...best, id: 'medium', post: false }])).toContain('medium drops post before shadows');
    expect(qualityLadderProblems([best, { ...best, id: 'medium', particles: false }])).toEqual(expect.arrayContaining(['medium drops particles before shadows', 'medium drops particles before post']));
    expect(qualityLadderProblems([best, { ...best, id: 'low', shadows: false, pixelRatio: 1 }])).toContain('low drops pixelRatio before post');
  });

  it('rejects turning a feature back on, raising numbers, bad order and empty ladders', () => {
    expect(qualityLadderProblems([{ ...best, shadows: false }, { ...best, id: 'low' }])).toContain('low turns shadows back on');
    expect(qualityLadderProblems([best, { ...best, id: 'medium', shadows: false, post: false, anisotropy: 16 }])).toContain('medium raises anisotropy');
    expect(qualityLadderProblems([{ ...best, id: 'low' }, { ...best, id: 'high' }])).toContain('high is listed after low: levels go best first');
    expect(qualityLadderProblems([])).toEqual(['no quality levels']);
  });

  it('holds for every theme and the lit test theme', async () => {
    const themes = [...(await Promise.all(THEME_IDS.map((id) => loadTheme(id)))), lit];
    for (const t of themes) expect(qualityLadderProblems(t.quality), `${t.id} (${t.label})`).toEqual([]);
  });
});
