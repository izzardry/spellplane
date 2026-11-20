// M7-C contracts: looks and design tokens, the one continuous tilt, card feel and motion settings, affordance
// constants, coach-mark hint ids and the new settings keys (PLAN Milestone 7, Owner decisions after the first design
// round and Overnight run packages; docs/design/m7-directions.html; docs/design/m7-hud-proposal.md).
import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '../../src/core/geometry';
import {
  DEFAULT_CARD_FEEL,
  LIFE_SCRUB,
  PILE_ACTIONS,
  TILT_PRESETS,
  cardFeel,
  clampTilt,
  perspectiveToggleTilt,
  resolveMotion,
  rigForTilt,
  tiltForRig,
} from '../../src/scene/types';
import { readBackup } from '../../src/store/backup';
import { COACH_MARK_IDS, DEFAULT_SETTINGS, HINT_IDS, MOTION_INTENSITIES } from '../../src/store/types';
import {
  DEFAULT_LOOK,
  FEEL_CUES,
  LISTED_THEME_IDS,
  LOOK_IDS,
  LOOK_LABELS,
  LOOK_THEME,
  M4_THEME_IDS,
  THEME_IDS,
  THEME_LABELS,
  THEME_LISTED,
  loadTheme,
  lookIdOf,
  lookOfTheme,
  type SoundCue,
  type SoundSet,
} from '../../src/themes/index';

const ALL: readonly SoundCue[] = ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick', ...FEEL_CUES];
import { LAYOUT, LOOKS, designCssVars, lookTokens, motionTokens } from '../../src/ui/design/tokens';

describe('looks', () => {
  it('has four looks (M8-C added Plain), each mapped to a registered theme that the picker lists; the M4 themes stay registered but unlisted', async () => {
    expect([...LOOK_IDS]).toEqual(['plain', 'kitchen', 'graphite', 'codex']);
    for (const look of LOOK_IDS) {
      const theme = LOOK_THEME[look];
      expect(THEME_IDS).toContain(theme);
      expect(THEME_LISTED[theme]).toBe(true);
      expect(lookOfTheme(theme)).toBe(look);
      expect(LOOK_LABELS[look]).toBe(THEME_LABELS[theme]);
      expect((await loadTheme(theme)).id).toBe(theme);
    }
    for (const id of M4_THEME_IDS) {
      expect(THEME_LISTED[id]).toBe(false);
      expect(lookOfTheme(id)).toBeNull();
    }
    expect([...LISTED_THEME_IDS]).toEqual(['plain', 'kitchen', 'graphite', 'codex']);
  });

  it('reads a stored look, anything unknown as the default look (Plain since M8-C)', () => {
    expect(DEFAULT_LOOK).toBe('plain');
    expect(DEFAULT_SETTINGS.look).toBe(DEFAULT_LOOK);
    expect(DEFAULT_SETTINGS.theme).toBe('plain');
    expect(lookIdOf('graphite')).toBe('graphite');
    expect(lookIdOf('paper')).toBe('plain');
    expect(lookIdOf(undefined)).toBe('plain');
  });
});

describe('design tokens', () => {
  const hex = /^#[0-9a-f]{6}$/;
  const colour = (v: string) => hex.test(v) || /^rgba?\(/.test(v);

  it('gives every look every role, with the directions page’s key colours', () => {
    const keys = Object.keys(LOOKS.kitchen.colour).sort();
    for (const look of LOOK_IDS) {
      const t = lookTokens(look);
      expect(t.id).toBe(look);
      expect(Object.keys(t.colour).sort()).toEqual(keys);
      for (const [k, v] of Object.entries(t.colour)) expect(colour(v), `${look} ${k} = ${v}`).toBe(true);
      // The primary action and danger never share a hue word: they are different colours.
      expect(t.colour.danger).not.toBe(t.colour.accent);
      expect(t.sound.gain).toBeGreaterThan(0);
      expect(t.sound.gain).toBeLessThanOrEqual(1);
    }
    // docs/design/m7-directions.html swatches.
    expect(LOOKS.kitchen.colour).toMatchObject({ mat: '#d9ccb2', frame: '#5b3f2c', panel: '#f7f1e5', ink: '#2b2118', accent: '#b94f2c' /* M7-P2 tuned the directions' #c0532f to meet AA under the primary button's text */, selection: '#b08a3e' });
    expect(LOOKS.graphite.colour).toMatchObject({ mat: '#16191e', panel: '#20242b', border: '#323843', ink: '#e9ecf0', muted: '#9aa3ae', accent: '#3fd2a3' });
    expect(LOOKS.codex.colour).toMatchObject({ mat: '#1b2235', panel: '#242c42', ornament: '#c8a75e', ink: '#efe6d2', muted: '#a99f8c', accent: '#b8432f' });
  });

  it('gives Graphite depth: layered panels and shadows, where the directions page had none', () => {
    const g = LOOKS.graphite;
    expect(g.colour.panelRaised).not.toBe(g.colour.panel);
    expect(g.elevation.raised).not.toBe('none');
    expect(g.elevation.primary).not.toBe('none');
  });

  it('never uses a blur or backdrop filter (Safari cost over the canvas)', () => {
    for (const look of LOOK_IDS) expect(JSON.stringify(LOOKS[look])).not.toMatch(/blur\(|backdrop/);
  });

  it('maps to CSS custom properties; reduced motion zeroes every duration', () => {
    const vars = designCssVars(LOOKS.codex);
    expect(vars['--ds-panel-raised']).toBe(LOOKS.codex.colour.panelRaised);
    expect(vars['--ds-font-heading']).toContain('Iowan Old Style');
    expect(vars['--ds-heading-variant']).toBe('small-caps');
    expect(vars['--ds-radius-md']).toBe('6px');
    expect(vars['--ds-space-md']).toBe(`${LAYOUT.space.md}px`);
    expect(vars['--ds-control-touch']).toBe('44px');
    expect(vars['color-scheme']).toBe('dark');
    const reduced = designCssVars(LOOKS.kitchen, true);
    for (const k of ['fast', 'base', 'slow', 'deliberate']) expect(reduced[`--ds-duration-${k}`]).toBe('0ms');
    expect(motionTokens(LOOKS.kitchen, false)).toBe(LOOKS.kitchen.motion);
  });

  it('keeps sizes shared: looks change materials and mood, not layout', () => {
    expect(LAYOUT.control.touch).toBeGreaterThanOrEqual(44);
    for (const look of LOOK_IDS) expect(Object.keys(LOOKS[look])).not.toContain('space');
  });
});

describe('the one continuous tilt', () => {
  it('runs from first person (0) to bird’s-eye (1) with three presets, and maps the old rigs onto its ends', () => {
    expect(TILT_PRESETS.map((p) => p.tilt)).toEqual([0, 0.5, 1]);
    expect(TILT_PRESETS.map((p) => p.id)).toEqual(['firstPerson', 'midTilt', 'birdseye']);
    expect(tiltForRig('birdseye')).toBe(1);
    expect(tiltForRig('ego')).toBe(0);
    expect(rigForTilt(0.7)).toBe('birdseye');
    expect(rigForTilt(0.2)).toBe('ego');
    expect(clampTilt(-1)).toBe(0);
    expect(clampTilt(2)).toBe(1);
    expect(clampTilt(Number.NaN)).toBe(1);
  });

  it('sends the old perspective key to the other end', () => {
    expect(perspectiveToggleTilt(1)).toBe(0);
    expect(perspectiveToggleTilt(0.6)).toBe(0);
    expect(perspectiveToggleTilt(0)).toBe(1);
    expect(perspectiveToggleTilt(0.3)).toBe(1);
  });

  it('starts each look at a tilt on the one continuous tilt (M7-P1 chose them; the stubs started bird’s-eye)', async () => {
    for (const look of LOOK_IDS) {
      const t = (await loadTheme(LOOK_THEME[look])).camera.tilt!;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    expect(DEFAULT_SETTINGS.tilt).toBeNull();
  });
});

describe('card feel and motion', () => {
  it('starts from the geometry spec: lift 12, spring 320/36/1, magnet reaching past the snap radius', () => {
    expect(DEFAULT_CARD_FEEL.liftMm).toBe(GEOMETRY.dragLift);
    expect(DEFAULT_CARD_FEEL.follow).toEqual({ stiffness: 320, damping: 36, mass: 1 });
    expect(DEFAULT_CARD_FEEL.magnet.radiusMm).toBeGreaterThanOrEqual(GEOMETRY.snapRadius);
    expect(DEFAULT_CARD_FEEL.magnet.previewMm).toBeGreaterThanOrEqual(DEFAULT_CARD_FEEL.magnet.radiusMm);
  });

  it('resolves the motion setting against the system preference', () => {
    expect([...MOTION_INTENSITIES]).toEqual(['system', 'full', 'subtle', 'reduced']);
    expect(DEFAULT_SETTINGS.motion).toBe('system');
    expect(resolveMotion('system', false)).toEqual({ reduced: false, scale: 1 });
    expect(resolveMotion('system', true)).toEqual({ reduced: true, scale: 0 });
    expect(resolveMotion('full', true)).toEqual({ reduced: false, scale: 1 });
    expect(resolveMotion('subtle', false)).toEqual({ reduced: false, scale: 0.5 });
    expect(resolveMotion('reduced', false)).toEqual({ reduced: true, scale: 0 });
  });

  it('scales sway, bounce and durations, and cuts everything under reduced motion; the lift height stays', () => {
    const full = cardFeel({}, { reduced: false, scale: 1 });
    expect(full).toEqual(DEFAULT_CARD_FEEL);
    const half = cardFeel({ feel: { liftMm: 10 } }, { reduced: false, scale: 0.5 });
    expect(half.liftMm).toBe(10);
    expect(half.sway.maxDeg).toBe(DEFAULT_CARD_FEEL.sway.maxDeg / 2);
    expect(half.durations.draw).toBe(DEFAULT_CARD_FEEL.durations.draw / 2);
    const cut = cardFeel({}, { reduced: true, scale: 0 });
    expect(cut.settle.bounce).toBe(0);
    expect(cut.sway.maxDeg).toBe(0);
    expect(Object.values(cut.durations).every((d) => d === 0)).toBe(true);
  });

  it('names a sound slot for every cue, and every look plays only known cues', () => {
    // SoundSet has a source slot for every SoundCue: ui/sound.ts indexes a set by cue, so a cue without one fails tsc.
    const slots: Record<SoundCue, keyof SoundSet> = Object.fromEntries(ALL.map((c) => [c, c])) as Record<SoundCue, keyof SoundSet>;
    expect(Object.keys(slots).sort()).toEqual([...ALL].sort());
    expect(new Set(FEEL_CUES).size).toBe(FEEL_CUES.length);
    for (const look of LOOK_IDS) for (const c of LOOKS[look].sound.cues) expect(ALL, c).toContain(c);
  });
});

describe('affordances and coach marks', () => {
  it('offers draw first on a library, open on the other piles', () => {
    expect(PILE_ACTIONS.library[0]).toBe('draw');
    expect(PILE_ACTIONS.graveyard).toEqual(['open']);
    expect(PILE_ACTIONS.exile).toEqual(['open']);
    expect(LIFE_SCRUB.pxPerPoint).toBeGreaterThan(LIFE_SCRUB.slopPx);
  });

  it('keeps coach marks as hint ids, so a backup carries them and an unknown id is dropped', () => {
    for (const id of COACH_MARK_IDS) expect(HINT_IDS).toContain(id);
    const r = readBackup({ format: 'spellplane-backup', version: 1, settings: { hintsSeen: ['coachDraw', 'nonsense'], look: 'graphite', tilt: 0.4, motion: 'subtle' } });
    expect(r.errors).toEqual([]);
    expect(r.settings).toMatchObject({ hintsSeen: ['coachDraw'], look: 'graphite', tilt: 0.4, motion: 'subtle' });
    expect(readBackup({ format: 'spellplane-backup', version: 1, settings: { tilt: null } }).settings).toEqual({ tilt: null });
    const bad = readBackup({ format: 'spellplane-backup', version: 1, settings: { tilt: 3, motion: 'wild' } });
    expect(bad.errors.map((e) => e.where).sort()).toEqual(['setting motion', 'setting tilt']);
  });

  it('M8-C: a backup accepts the look Plain and still the three older looks', () => {
    for (const look of ['plain', 'kitchen', 'graphite', 'codex']) {
      const r = readBackup({ format: 'spellplane-backup', version: 1, settings: { look, theme: look } });
      expect(r.errors).toEqual([]);
      expect(r.settings).toMatchObject({ look, theme: look });
    }
  });
});
