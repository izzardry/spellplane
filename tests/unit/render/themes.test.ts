// Every theme against the pipeline's rules (DESIGN "Themes and rendering": card faces near-unlit; Paper flat white,
// no lighting, no shadows; "Specification: geometry, layout and motion": thickness 0.6 in themes with thickness, lift
// 12 with a 4° tilt in lit themes). Runs over the real themes as they land (M4-P3..P5) and the lit test theme.
import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '../../../src/core/geometry';
import { effectiveQuality } from '../../../src/scene/quality';
import { litTestTheme } from '../../../src/themes/test-lit';
import { CARD_FACE_MAX_SHADE, loadTheme, THEME_IDS, type Theme } from '../../../src/themes/index';

const all = async (): Promise<Theme[]> => [...(await Promise.all(THEME_IDS.map((id) => loadTheme(id)))), litTestTheme()];

describe('themes in the lit pipeline', () => {
  it('shade card faces by at most CARD_FACE_MAX_SHADE', async () => {
    for (const t of await all()) {
      expect(t.cardDressing.faceShade, t.label).toBeGreaterThanOrEqual(0);
      expect(t.cardDressing.faceShade, t.label).toBeLessThanOrEqual(CARD_FACE_MAX_SHADE);
    }
  });

  it('give cards the geometry spec: flat or 0.6 mm thick, lifted 12 mm when held, tilted 4° only in lit themes', async () => {
    for (const t of await all()) {
      const d = t.cardDressing;
      expect([0, GEOMETRY.card.thickness], t.label).toContain(d.thickness);
      expect(d.held.lift, t.label).toBe(GEOMETRY.dragLift);
      expect(d.held.tiltDeg, t.label).toBe(t.lighting.lit ? GEOMETRY.dragTiltDeg : 0);
    }
  });

  it('keep Paper unlit, flat and cheap at every quality level', async () => {
    const paper = await loadTheme('paper');
    expect(paper.lighting).toMatchObject({ lit: false, lights: [], toneMapping: 'none' });
    expect(paper.cardDressing).toMatchObject({ thickness: 0, faceShade: 0, sleeveMaterial: null });
    for (const level of paper.quality) {
      expect(effectiveQuality(level, paper, { devicePixelRatio: 2, maxAnisotropy: 16, maxSamples: 4 })).toMatchObject({ shadowMap: false, contactShadows: false, post: false, msaa: 0 });
    }
  });

  it('lights only lit themes, with finite light positions', async () => {
    for (const t of await all()) {
      if (!t.lighting.lit) {
        expect(t.lighting.lights, t.label).toEqual([]);
        continue;
      }
      for (const l of t.lighting.lights) if ('position' in l) expect(l.position.every(Number.isFinite), t.label).toBe(true);
    }
  });
});
