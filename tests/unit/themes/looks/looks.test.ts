// The three M7 looks as themes (PLAN Milestone 7, Owner decisions after the first design round: "All three looks are
// kept, as the three themes of the redesign … The four M4 themes leave the theme picker; their code stays"; PLAN M7-P1
// Table worlds: Kitchen "linen playmat, walnut frame, warm light, soft short card shadows", Graphite "cool charcoal …
// with depth", Codex "midnight blue, gilt hairlines and diamond corners, restrained; no particles or glow"; "Card faces
// never tinted or cropped"; "Performance: cheap in Safari (no heavy post-processing by default; quality tiers)").
// The checks every theme passes (seat colours, HUD tokens, signals) are in tests/unit/themes/conformance/.
import { describe, expect, it } from 'vitest';
import { qualityLadderProblems } from '../../../../src/scene/quality';
import { DEFAULT_CARD_FEEL, cardFeel, resolveMotion, rigForTilt } from '../../../../src/scene/types';
import {
  CARD_FACE_MAX_SHADE,
  LISTED_THEME_IDS,
  LOOK_IDS,
  LOOK_LABELS,
  LOOK_THEME,
  M4_THEME_IDS,
  THEME_IDS,
  THEME_LISTED,
  colourDistance,
  contrastRatio,
  hexToRgb,
  loadTheme,
  luminance,
  qualityLevel,
  type SoundCue,
  type Theme,
} from '../../../../src/themes/index';
import { LOOKS as LOOK_TOKENS } from '../../../../src/ui/design/tokens';

const looks: Theme[] = await Promise.all(LOOK_IDS.map((id) => loadTheme(LOOK_THEME[id])));
const ALL_CUES: SoundCue[] = ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick', 'draw', 'untap', 'play', 'toGraveyard', 'toExile', 'toHand', 'attach', 'clip', 'pickup', 'drop', 'snap'];

describe('the picker', () => {
  it('lists exactly the four looks, Plain first (docs/design/m8/m7-adjustments.md, M7-P1); the M4 themes stay registered and loadable', async () => {
    expect(LISTED_THEME_IDS).toEqual(['plain', 'kitchen', 'graphite', 'codex']);
    expect((await loadTheme('plain')).label).toBe('Plain');
    expect('stub' in (await loadTheme('plain'))).toBe(false);
    for (const id of M4_THEME_IDS) {
      expect(THEME_LISTED[id]).toBe(false);
      expect(THEME_IDS).toContain(id);
      expect((await loadTheme(id)).id).toBe(id);
    }
  });

  it('builds each look as a real theme, not the contracts stub', () => {
    for (const t of looks) {
      expect('stub' in t, t.id).toBe(false);
      expect(t.label).toBe(LOOK_LABELS[t.id as keyof typeof LOOK_LABELS]);
    }
  });
});

describe.each(looks.map((t) => [t.id, t] as const))('%s', (id, theme) => {
  const tokens = LOOK_TOKENS[id as keyof typeof LOOK_TOKENS];

  it('never restyles a card face: faces near-unlit within CARD_FACE_MAX_SHADE, no bloom, no glow on anything', () => {
    expect(theme.cardDressing.faceShade).toBeGreaterThanOrEqual(0);
    expect(theme.cardDressing.faceShade).toBeLessThanOrEqual(CARD_FACE_MAX_SHADE);
    expect(theme.post.bloom).toBeNull();
    for (const s of [theme.cardDressing.hover, theme.cardDressing.selected, theme.cardDressing.pending]) expect(s.glow ?? 0).toBe(0);
    for (const kind of ['target', 'attack', 'block', 'attach', 'mark'] as const) expect(theme.lineStyle(kind, theme.tokens.colours.seats[0]!).glow).toBe(0);
  });

  it('is cheap in Safari: no post-processing at any quality, no shadow maps, no particles, no flicker', () => {
    expect(theme.post).toEqual({ bloom: null, vignette: null });
    expect(theme.shadows.map).toBeNull();
    for (const l of theme.quality) {
      expect(l.post).toBe(false);
      expect(l.particles).toBe(false);
      expect(l.msaa ?? 0).toBe(0);
    }
    for (const l of theme.lighting.lights) expect('flicker' in l ? l.flicker : undefined).toBeUndefined();
    expect(theme.lighting.fog).toBeNull();
  });

  it('has a sound quality ladder: high, medium, low; shadows drop first, then the pixel ratio, down to 1', () => {
    expect(theme.quality.map((l) => l.id)).toEqual(['high', 'medium', 'low']);
    expect(qualityLadderProblems(theme.quality)).toEqual([]);
    expect(qualityLevel(theme, 'high').shadows).toBe(true);
    expect(qualityLevel(theme, 'medium').shadows).toBe(false);
    expect(qualityLevel(theme, 'low').pixelRatio).toBe(1);
  });

  it('gives cards soft, short shadows: contact shadows that fade within a few centimetres of lift, on by default', () => {
    expect(theme.shadows.enabled).toBe(true);
    const c = theme.shadows.contact!;
    expect(c).not.toBeNull();
    expect(c.opacity).toBeGreaterThan(0.2);
    expect(c.opacity).toBeLessThan(0.7);
    expect(c.blurMm).toBeGreaterThan(1);
    expect(c.blurMm).toBeLessThanOrEqual(6);
    // Still visible under a held card (lift 12 mm), gone well before a card would be far above the table.
    expect(c.heightMm).toBeGreaterThan(theme.cardDressing.held.lift);
    expect(c.heightMm).toBeLessThanOrEqual(40);
    expect(theme.cardDressing.thickness).toBeCloseTo(0.6, 6);
    expect(theme.cardDressing.held.shadow).toBe(true);
  });

  it('is a lit world without tone mapping, so the table keeps the colours its tokens promise', () => {
    expect(theme.lighting.lit).toBe(true);
    expect(theme.lighting.toneMapping).toBe('none');
    expect(theme.lighting.exposure).toBe(1);
    expect(theme.lighting.lights.some((l) => l.kind === 'spot' || l.kind === 'directional')).toBe(true);
    expect(theme.lighting.lights.some((l) => l.kind === 'hemisphere' || l.kind === 'ambient')).toBe(true);
    // The room around the table is darker than the table, so the table is the hero at every tilt.
    expect(luminance(theme.lighting.background)).toBeLessThan(luminance(theme.tokens.colours.surface));
  });

  it('takes its colours from the look’s design tokens (docs/design/m7-directions.html)', () => {
    const c = theme.tokens.colours;
    expect(theme.tokens.hud!.scheme).toBe(tokens.scheme);
    expect(theme.tokens.hud!.panel).toBe(tokens.colour.panel);
    expect(c.accent).toBe(tokens.colour.accent);
    expect(theme.cardDressing.selected.colour).toBe(tokens.colour.selection);
    expect(c.seats[0]!.colour).toBe(tokens.colour.seatA);
    expect(c.seats[1]!.colour).toBe(tokens.colour.seatB);
    // No blur behind panels (Safari: PLAN Milestone 7, A0).
    expect(theme.tokens.hud!.blur).toBe(0);
    // The table is near the look's mat colour (measured on screen in tests/e2e/themes/looks/looks.spec.ts).
    expect(colourDistance(c.surface, tokens.colour.mat)).toBeLessThan(0.08);
  });

  it('keeps zone hairlines and labels readable on its table', () => {
    const c = theme.tokens.colours;
    expect(contrastRatio(c.muted, c.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(1.4);
  });

  it('tells hover, selection, pending and every seat apart (colour distance)', () => {
    const d = theme.cardDressing;
    expect(colourDistance(d.hover.colour, d.selected.colour)).toBeGreaterThanOrEqual(0.2);
    expect(colourDistance(d.pending.colour, d.selected.colour)).toBeGreaterThanOrEqual(0.2);
    expect(colourDistance(d.pending.colour, d.hover.colour)).toBeGreaterThanOrEqual(0.2);
    for (const s of theme.tokens.colours.seats) expect(colourDistance(d.pending.colour, s.colour), `pending vs seat ${s.index}`).toBeGreaterThanOrEqual(0.2);
    expect(d.selected.width).toBeGreaterThan(d.hover.width);
  });

  it('opens at a tilt on the one continuous tilt, its rig the nearer end', () => {
    const t = theme.camera.tilt!;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
    expect(theme.camera.defaultRig).toBe(rigForTilt(t));
  });

  it('has a sound for every table and card-feel cue, on by default as its tokens say', () => {
    const s = theme.sounds!;
    for (const cue of ALL_CUES) expect(typeof s[cue]?.play, cue).toBe('function');
    expect(s.onByDefault).toBe(tokens.sound.onByDefault);
    expect(s.ambience).toBeUndefined();
  });

  it('has a card feel within the defaults’ range, still a cut under reduced motion', () => {
    const full = cardFeel(theme, resolveMotion('full', false));
    expect(full.liftMm).toBe(DEFAULT_CARD_FEEL.liftMm);
    expect(full.settle.bounce).toBeGreaterThan(0);
    expect(full.settle.bounce).toBeLessThanOrEqual(0.25);
    expect(full.sway.maxDeg).toBeGreaterThan(0);
    expect(full.sway.maxDeg).toBeLessThanOrEqual(DEFAULT_CARD_FEEL.sway.maxDeg);
    const reduced = cardFeel(theme, resolveMotion('system', true));
    expect(reduced.settle.bounce).toBe(0);
    expect(reduced.sway.maxDeg).toBe(0);
    expect(reduced.liftMs).toBe(0);
  });

  it('draws its own neutral card back (procedural, never the official back)', () => {
    const back = theme.cardDressing.back!;
    expect(back.id).toBe(`${id}-back`);
    expect(back.width / back.height).toBeCloseTo(63 / 88, 2);
  });
});

describe('three distinct moods', () => {
  const [kitchen, graphite, codex] = looks as [Theme, Theme, Theme];
  const warm = (hex: string) => {
    const [r, , b] = hexToRgb(hex);
    return r - b;
  };
  const key = (t: Theme) => t.lighting.lights.find((l) => l.kind === 'spot' || l.kind === 'directional')! as { colour: string };

  it('Kitchen Table is a light linen under a warm lamp; Graphite a dark, cool slate; Codex a dark navy under a warm lamp', () => {
    expect(luminance(kitchen.tokens.colours.surface)).toBeGreaterThan(0.4);
    expect(warm(key(kitchen).colour)).toBeGreaterThan(0.1);
    expect(luminance(graphite.tokens.colours.surface)).toBeLessThan(0.03);
    expect(warm(key(graphite).colour)).toBeLessThanOrEqual(0);
    const [r, g, b] = hexToRgb(codex.tokens.colours.surface);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(luminance(codex.tokens.colours.surface)).toBeLessThan(0.03);
    expect(warm(key(codex).colour)).toBeGreaterThan(0.1);
  });
});
