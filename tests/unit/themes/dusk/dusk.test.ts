// Dusk as data (PLAN M4-P3; DESIGN "Themes and rendering", theme table: Dusk — "Dark felt under a single warm lamp,
// soft contact shadows, vignette"; "Soft bloom on lines, slow light falloff, muted ambience"; "Bird's-eye, slightly
// tilted"; Tokens: seat colours "tuned per theme for contrast", HUD tokens; Card dressing; Renderer: quality levels
// drop shadows and post-processing first). The browser specs in tests/e2e/themes/dusk/ check how it renders.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION } from '../../../../src/core/geometry';
import { mtgLayout, soloLayout } from '../../../../src/games/mtg/layout';
import { effectiveQuality, qualityLadderProblems } from '../../../../src/scene/quality';
import { entryOutline } from '../../../../src/scene/stack';
import { DUSK_BLOOM_THRESHOLD, DUSK_PENDING, DUSK_SURFACE, dusk } from '../../../../src/themes/dusk/index';
import { FELT, FELT_COLOUR, RAIL } from '../../../../src/themes/dusk/table';
import { PATTERN_DASH, paper } from '../../../../src/themes/paper/index';
import {
  CARD_FACE_MAX_SHADE,
  SEAT_CONTRAST,
  THEME_LABELS,
  colourDistance,
  contrastRatio,
  hexToRgb,
  loadTheme,
  luminance,
  tokensToCssVars,
  type LightSpec,
  type LineKind,
} from '../../../../src/themes/index';

const placed = (l: LightSpec): l is Extract<LightSpec, { position: [number, number, number] }> => 'position' in l;
const LINE_KINDS: LineKind[] = ['target', 'attack', 'block', 'attach', 'mark'];
const device = { devicePixelRatio: 2, maxAnisotropy: 16, maxSamples: 4 };

describe('Dusk theme package', () => {
  it('is the real theme behind the lazy loader, no longer M4-C’s stub', async () => {
    const t = await loadTheme('dusk');
    expect(t).toBe(dusk);
    expect(t.id).toBe('dusk');
    expect(t.label).toBe(THEME_LABELS.dusk);
    expect((t as { stub?: string }).stub).toBeUndefined();
    expect(t.build).not.toBe(paper.build);
  });

  it('defaults to the bird’s-eye camera, slightly tilted', () => {
    expect(dusk.camera.defaultRig).toBe('birdseye');
    expect(dusk.camera.birdseyeTiltDeg).toBeGreaterThan(0);
    expect(dusk.camera.birdseyeTiltDeg).toBeLessThanOrEqual(15);
  });

  it('keeps the specified motion constants', () => {
    expect(dusk.motion).toEqual(DEFAULT_MOTION);
  });
});

describe('a single warm lamp with a slow falloff', () => {
  const lamps = dusk.lighting.lights.filter(placed);
  const lamp = lamps[0]!;

  it('is lit and tone-mapped, with exactly one placed light: a spot lamp above the table', () => {
    expect(dusk.lighting.lit).toBe(true);
    expect(dusk.lighting.toneMapping).not.toBe('none');
    expect(lamps).toHaveLength(1);
    expect(lamp.kind).toBe('spot');
    expect(lamp.position[2]).toBeGreaterThan(1000);
  });

  it('is warm: red over green over blue', () => {
    const [r, g, b] = hexToRgb(lamp.colour);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(0.2);
  });

  it('is the only real light: the fill is faint and no light flickers', () => {
    const fill = dusk.lighting.lights.filter((l) => !placed(l));
    for (const f of fill) expect(f.kind === 'ambient' || f.kind === 'hemisphere').toBe(true);
    const fillIntensity = fill.reduce((a, l) => a + l.intensity, 0);
    expect(fillIntensity).toBeLessThan(lamp.intensity / 4);
    for (const l of lamps) expect('flicker' in l ? l.flicker : undefined).toBeUndefined();
  });

  it('falls off slowly: a soft, wide penumbra that still reaches the corners of every table', () => {
    if (lamp.kind !== 'spot') throw new Error('the lamp is a spot');
    expect(lamp.penumbra).toBeGreaterThanOrEqual(0.8);
    // Every corner of every format's table (1v1, three- and four-player free-for-all, Two-Headed Giant, solo) lies
    // inside the cone with a margin, so the light fades over it instead of stopping at a hard edge.
    const angleTo = (x: number, y: number) => (Math.atan2(Math.hypot(x - lamp.position[0], y - lamp.position[1]), lamp.position[2]) * 180) / Math.PI;
    const tables = [...(['1v1', 'ffa3', 'ffa4', '2hg'] as const).map((f) => mtgLayout(f).table), soloLayout().table];
    expect(tables.map((t) => `${t.w}x${t.d}`)).toContain('2200x1100');
    for (const t of tables)
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const)
        expect(angleTo((sx * t.w) / 2, (sy * t.d) / 2), `${t.w}x${t.d} corner ${sx},${sy}`).toBeLessThanOrEqual(lamp.angleDeg - 3);
  });

  it('casts no shadow maps: soft contact shadows under the cards instead', () => {
    expect(dusk.shadows.enabled).toBe(true);
    expect(dusk.shadows.map).toBeNull();
    expect(dusk.shadows.contact).not.toBeNull();
    expect(dusk.shadows.contact!.blurMm).toBeGreaterThan(0);
    expect(dusk.shadows.contact!.opacity).toBeGreaterThan(0);
    expect(dusk.shadows.contact!.opacity).toBeLessThanOrEqual(1);
    expect(lamp.castShadow).toBe(false);
  });

  it('puts a dark room around the table', () => {
    expect(luminance(dusk.lighting.background)).toBeLessThan(luminance(DUSK_SURFACE));
  });
});

describe('post-processing: soft bloom on lines and a vignette', () => {
  const bloom = dusk.post.bloom!;
  it('has both passes', () => {
    expect(bloom).not.toBeNull();
    expect(dusk.post.vignette).not.toBeNull();
    expect(bloom.threshold).toBe(DUSK_BLOOM_THRESHOLD);
  });

  it('blooms every seat colour (the lines) and nothing of the table', () => {
    // three's high-pass compares the linear luminance of the world image with the threshold (Rec. 709 weights, as
    // WCAG's relative luminance): lines in any seat colour pass, the lit felt, the rail, zone hairlines and labels not.
    for (const s of dusk.tokens.colours.seats) expect(luminance(s.colour), `seat ${s.index}`).toBeGreaterThan(DUSK_BLOOM_THRESHOLD);
    const table = { felt: FELT_COLOUR, rail: RAIL.colour, surface: DUSK_SURFACE, border: dusk.tokens.colours.border, labels: dusk.tokens.colours.muted, sleeve: dusk.cardDressing.sleeveMaterial!.colour, edge: dusk.cardDressing.edge };
    for (const [name, c] of Object.entries(table)) expect(luminance(c), name).toBeLessThan(DUSK_BLOOM_THRESHOLD);
  });

  it('keeps the vignette from driving colours below black (darkness ≤ 1)', () => {
    expect(dusk.post.vignette!.darkness).toBeGreaterThan(0);
    expect(dusk.post.vignette!.darkness).toBeLessThanOrEqual(1);
  });

  it('is soft: a moderate strength', () => {
    expect(bloom.strength).toBeGreaterThan(0);
    expect(bloom.strength).toBeLessThanOrEqual(1);
  });
});

describe('seat colours tuned for the dark felt', () => {
  const seats = dusk.tokens.colours.seats;
  it('has eight, each 3:1 against the felt and every two apart (SEAT_CONTRAST)', () => {
    expect(seats.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const s of seats) expect(contrastRatio(s.colour, DUSK_SURFACE), `seat ${s.index}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.surface);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(colourDistance(seats[i]!.colour, seats[j]!.colour), `${i}/${j}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
  });

  it('keeps each seat’s pattern and glyph as in every theme (nothing depends on hue alone)', () => {
    expect(seats.map((s) => [s.pattern, s.glyph])).toEqual(paper.tokens.colours.seats.map((s) => [s.pattern, s.glyph]));
  });

  it('gives readable ink on each seat colour', () => {
    for (const s of seats) expect(contrastRatio(s.ink ?? dusk.tokens.colours.bg, s.colour), `seat ${s.index}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('lines', () => {
  it('draw in the seat colour with the seat’s dash pattern, glowing; marks always dashed', () => {
    for (const seat of dusk.tokens.colours.seats)
      for (const kind of LINE_KINDS) {
        const l = dusk.lineStyle(kind, seat);
        expect(l.colour).toBe(seat.colour);
        expect(l.glow).toBeGreaterThan(0);
        expect(l.widthPx).toBeGreaterThanOrEqual(paper.lineStyle(kind, seat).widthPx);
        if (kind === 'mark') expect(l.dash).not.toBeNull();
        else expect(l.dash).toEqual(PATTERN_DASH[seat.pattern]);
        expect(l.arrowhead).toBe(kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'triangle');
      }
  });
});

describe('HUD tokens for a dark HUD', () => {
  const c = dusk.tokens.colours;
  it('is dark: scheme, background and panels', () => {
    expect(dusk.tokens.hud?.scheme).toBe('dark');
    expect(luminance(c.bg)).toBeLessThan(0.02);
    const vars = tokensToCssVars(dusk.tokens);
    expect(vars['--sp-hud-scheme']).toBe('dark');
    expect(vars['--sp-surface']).toBe(DUSK_SURFACE);
    expect(vars['--sp-hud-blur']).toBe(`${dusk.tokens.hud!.blur}px`);
  });

  it('reads: text AA on the background and on the felt, controls 3:1', () => {
    expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(c.fg, c.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(c.muted, c.bg)).toBeGreaterThanOrEqual(4.5);
    // Zone labels on the felt and the away avatar's muted text on the surface.
    expect(contrastRatio(c.muted, c.surface)).toBeGreaterThanOrEqual(4.5);
    // Zone hairlines find their drop targets (WCAG 1.4.11).
    expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(3);
    for (const k of ['danger', 'warning', 'accent'] as const) expect(contrastRatio(c[k], c.bg), k).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('card dressing', () => {
  const d = dusk.cardDressing;
  it('keeps card faces near-unlit (never recoloured)', () => {
    expect(d.faceShade).toBeGreaterThanOrEqual(0);
    expect(d.faceShade).toBeLessThanOrEqual(CARD_FACE_MAX_SHADE);
  });

  it('gives cards thickness, a lift and tilt while held, and contact shadows when held', () => {
    expect(d.thickness).toBe(0.6);
    expect(d.held).toEqual({ lift: 12, tiltDeg: 4, shadow: true });
  });

  it('dresses cards in matte sleeves that do not mirror the lamp into the bloom', () => {
    expect(d.sleeve).not.toBeNull();
    expect(d.sleeveMaterial).not.toBeNull();
    expect(d.sleeveMaterial!.model).not.toBe('unlit');
    expect(d.sleeveMaterial!.clearcoat ?? 0).toBe(0);
    expect(d.sleeveMaterial!.roughness).toBeGreaterThanOrEqual(0.5);
    expect(d.sleeveMaterial!.metalness).toBe(0);
  });

  it('has its own neutral back, drawn in code', () => {
    expect(d.back).not.toBeNull();
    expect(d.back!.id).toBe('dusk-back');
    expect(d.back!.width / d.back!.height).toBeCloseTo(63 / 88, 2);
  });

  it('tells selection from hover: brighter and thicker', () => {
    expect(d.selected.colour).not.toBe(d.hover.colour);
    expect(d.selected.width).toBeGreaterThan(d.hover.width);
    expect(luminance(d.selected.colour)).toBeGreaterThan(luminance(DUSK_SURFACE));
    expect(contrastRatio(d.hover.colour, DUSK_SURFACE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(d.selected.colour, DUSK_SURFACE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(d.pending.colour, DUSK_SURFACE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(d.ghost.colour, DUSK_SURFACE)).toBeGreaterThanOrEqual(3);
  });

  it('outlines a waiting stack entry in a colour apart from every seat colour and every other outline', () => {
    // scene/stack.ts entryOutline swaps the controller's seat colour for this one while the round waits, so the
    // pending-confirmation signal must change colour whichever seat controls the entry (review round 2: the earlier
    // amber sat 0.07 from seat 4's).
    expect(d.pending.colour).toBe(DUSK_PENDING);
    for (const s of dusk.tokens.colours.seats) expect(colourDistance(d.pending.colour, s.colour), `seat ${s.index}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
    for (const other of [d.hover.colour, d.selected.colour, d.ghost.colour]) expect(colourDistance(d.pending.colour, other), other).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
    expect(entryOutline(true, dusk.tokens.colours.seats[4]!.colour, d, 1)).toEqual({ colour: DUSK_PENDING, width: 2.2 });
  });
});

describe('quality levels', () => {
  it('form a ladder that drops shadows, then post-processing', () => {
    expect(qualityLadderProblems(dusk.quality)).toEqual([]);
    expect(dusk.quality.map((q) => q.id)).toEqual(['high', 'medium', 'low']);
  });

  it('turn contact shadows and post-processing on and off as the level says', () => {
    const [high, medium, low] = dusk.quality.map((l) => effectiveQuality(l, dusk, device));
    expect(high).toMatchObject({ shadowMap: false, contactShadows: true, post: true });
    expect(medium).toMatchObject({ shadowMap: false, contactShadows: false, post: true });
    expect(low).toMatchObject({ shadowMap: false, contactShadows: false, post: false, msaa: 0 });
  });
});

describe('felt', () => {
  it('is a rough, non-metal cloth with procedural maps that keep their scale on every table', () => {
    expect(FELT.model).toBe('standard');
    expect(FELT.roughness).toBeGreaterThanOrEqual(0.9);
    expect(FELT.metalness).toBe(0);
    expect(FELT.tileMm).toBeGreaterThan(0);
    for (const m of Object.values(FELT.maps ?? {})) expect(m.kind).toBe('procedural');
    // Dark and green.
    const [r, g, b] = hexToRgb(FELT_COLOUR);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(luminance(FELT_COLOUR)).toBeLessThan(0.1);
  });
});

describe('sound', () => {
  it('has the full set plus a room tone, on until the viewer turns it off', () => {
    const s = dusk.sounds!;
    for (const k of ['slide', 'tap', 'shuffle', 'turnChime', 'promptTick'] as const) expect(typeof s[k]?.play, k).toBe('function');
    expect(typeof s.ambience?.start).toBe('function');
    expect(s.onByDefault).toBe(true);
  });
});
