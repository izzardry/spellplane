// M4-C contracts: theme interface v2, functional signals, quality levels, lazy theme loading, stubs naming their
// packages (PLAN Milestone 4; DESIGN "Themes and rendering", "Camera and navigation", "Specification: code interfaces").
import { describe, expect, it } from 'vitest';
import { CAMERA } from '../../../src/core/geometry';
import { blendPose } from '../../../src/scene/camera/blend';
import { egoPose } from '../../../src/scene/camera/ego';
import { DEFAULT_EGO_RIG, type CameraPose } from '../../../src/scene/types';
import {
  CARD_FACE_MAX_SHADE,
  SEAT_CONTRAST,
  SIGNALS,
  SIGNAL_IDS,
  THEME_IDS,
  THEME_LABELS,
  colourDistance,
  contrastRatio,
  loadTheme,
  qualityLevel,
  themeIdOf,
  tokensToCssVars,
  type QualityLevel,
} from '../../../src/themes/index';
import { paper } from '../../../src/themes/paper/index';
import { DEFAULT_SETTINGS } from '../../../src/store/types';

describe('functional signals', () => {
  it('lists the twelve signals of PLAN M4-P6 once each, in order', () => {
    expect(SIGNAL_IDS).toEqual(['tapped', 'selected', 'hovered', 'displaced', 'attacking', 'blocking', 'faceDown', 'foil', 'seatColour', 'speaking', 'pendingConfirmation', 'away']);
    expect(new Set(SIGNAL_IDS).size).toBe(12);
  });
  it('gives every signal a probe, a neutral and a signalled state and a positive threshold', () => {
    for (const s of SIGNALS) {
      expect(s.neutral.length).toBeGreaterThan(0);
      expect(s.signalled.length).toBeGreaterThan(0);
      expect(s.styledBy.length).toBeGreaterThan(0);
      expect(s.threshold.changedFraction).toBeGreaterThan(0);
      expect(s.threshold.channelDelta).toBeGreaterThan(0);
      if (s.probe.kind === 'element') expect(s.surface).toBe('hud');
    }
    expect(SIGNALS.filter((s) => s.perSeat).map((s) => s.id)).toEqual(['seatColour']);
  });
  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(colourDistance('#000', '#ffffff')).toBeCloseTo(Math.sqrt(3), 5);
  });
  it('Paper’s seat colours pass the seat-colour conformance rule', () => {
    const seats = paper.tokens.colours.seats;
    for (const s of seats) expect(contrastRatio(s.colour, paper.tokens.colours.surface)).toBeGreaterThanOrEqual(SEAT_CONTRAST.surface);
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) expect(colourDistance(seats[i]!.colour, seats[j]!.colour)).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
  });
});

describe('theme interface v2', () => {
  it('loads every theme lazily under its own id, the stubs naming their package', async () => {
    const stubs: Record<string, string> = { wyrm: 'M4-P4' };
    for (const id of THEME_IDS) {
      const t = await loadTheme(id);
      expect(t.id).toBe(id);
      expect(t.label).toBe(THEME_LABELS[id]);
      expect(t.tokens.colours.seats).toHaveLength(8);
      expect(t.quality.length).toBeGreaterThan(0);
      expect(t.cardDressing.faceShade).toBeLessThanOrEqual(CARD_FACE_MAX_SHADE);
      // A theme package replaces its stub (Dusk: M4-P3); a theme still stubbed names the package that replaces it.
      const stub = (t as { stub?: string }).stub;
      if (stub !== undefined) expect(stub).toBe(stubs[id]);
      // A theme without the marker is a real one, not Paper under another id (a stub that lost its marker).
      else if (id !== 'paper') {
        // Compared by value, so a copy of Paper's lighting (`{ ...paper.lighting }`) does not pass as a real theme's.
        expect(t.build, `${id} builds its own table`).not.toBe(paper.build);
        expect(t.lighting.lit, `${id} is lit`).toBe(true);
        expect(t.lighting, `${id} has its own lighting`).not.toEqual(paper.lighting);
      }
    }
    expect((await loadTheme('stonetable')).camera.defaultRig).toBe('ego');
    expect((await loadTheme('wyrm')).camera.defaultRig).toBe('ego');
    expect((await loadTheme('dusk')).camera.defaultRig).toBe('birdseye');
  });
  it('keeps Paper flat: unlit, no shadows, no post-processing, no sound, bird’s-eye', () => {
    expect(paper.lighting.lit).toBe(false);
    expect(paper.lighting.lights).toEqual([]);
    expect(paper.shadows.enabled).toBe(false);
    expect(paper.post).toEqual({ bloom: null, vignette: null });
    expect(paper.sounds).toBeUndefined();
    expect(paper.camera.defaultRig).toBe('birdseye');
    expect(paper.cardDressing.thickness).toBe(0);
    expect(paper.cardDressing.faceShade).toBe(0);
  });
  it('maps HUD tokens to CSS custom properties', () => {
    const vars = tokensToCssVars(paper.tokens);
    expect(vars['--sp-hud-scheme']).toBe('light');
    expect(vars['--sp-hud-blur']).toBe('0px');
    expect(vars['--sp-seat-0-ink']).toBe(paper.tokens.colours.bg);
    expect(vars['--sp-seat-0-glow']).toBe(paper.tokens.colours.seats[0]!.colour);
    const { hud: _hud, ...noHud } = paper.tokens;
    expect(tokensToCssVars(noHud)['--sp-hud-panel']).toBe('#ffffff');
  });
  it('reads unknown stored themes as Paper', () => {
    expect(themeIdOf('stonetable')).toBe('stonetable');
    expect(themeIdOf('neon')).toBe('paper');
    expect(themeIdOf(DEFAULT_SETTINGS.theme)).toBe('paper');
    expect(DEFAULT_SETTINGS.sound).toBe('theme');
  });
});

describe('quality levels', () => {
  const L = (id: QualityLevel['id'], shadows: boolean, post: boolean): QualityLevel => ({ id, shadows, post, particles: post, pixelRatio: 1 });
  it('picks the matching level, else the best one not better than asked, else the lowest', () => {
    const full = { quality: [L('high', true, true), L('medium', false, true), L('low', false, false)] };
    expect(qualityLevel(full, 'medium').id).toBe('medium');
    const gap = { quality: [L('high', true, true), L('low', false, false)] };
    expect(qualityLevel(gap, 'medium').id).toBe('low');
    expect(qualityLevel(paper, 'low').id).toBe('high');
    expect(() => qualityLevel({ quality: [] }, 'high')).toThrow();
  });
});

describe('camera rig contracts', () => {
  it('ego defaults follow the geometry spec', () => {
    expect(DEFAULT_EGO_RIG).toMatchObject({ fovDeg: 45, behindEdge: 260, height: 620, pitchDeg: 35, minPitchDeg: 25, maxPitchDeg: 60 });
    expect(DEFAULT_EGO_RIG.fovDeg).toBe(CAMERA.ego.fovDeg);
  });
});

describe('stubs name their package', () => {
  const pose: CameraPose = { position: [0, 0, 1000], target: [0, 0, 0], fovDeg: 6, pitchDeg: 90 };
  it.each([
    ['M4-P1', () => egoPose(DEFAULT_EGO_RIG, { w: 1400, d: 1100 }, 0, { lean: 0, dolly: 0, pitchDeg: 35 })],
    ['M4-P1', () => blendPose(pose, pose, 0.5, { w: 800, h: 600 }, null)],
  ])('%s', (pkg, fn) => {
    expect(fn).toThrow(`not implemented: ${pkg}`);
  });
});
