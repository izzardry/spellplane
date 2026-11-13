// Stonetable as data (PLAN M4-P5; DESIGN "Themes and rendering", theme table: "Carved stone slab with PBR materials,
// torch-like directional light, real shadows, cards with thickness and slight lift when held | Glowing runes for lines,
// dust motes in the light | Ego"; "Card faces are never restyled"; Tokens: seat colours "tuned per theme for contrast";
// Renderer: "a per-theme quality setting drops shadows and post-processing first"; "Specification: geometry, layout and
// motion": thickness 0.6, lift 12 with a 4° tilt in lit themes, motion constants; "Input and interaction design",
// Accessibility: seat colours paired with a pattern and glyph).
import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION, GEOMETRY } from '../../../../src/core/geometry';
import { keyLightOf } from '../../../../src/scene/lights';
import { effectiveQuality, qualityLadderProblems } from '../../../../src/scene/quality';
import {
  CARD_FACE_MAX_SHADE,
  SEAT_CONTRAST,
  SIGNALS,
  colourDistance,
  contrastRatio,
  hexToRgb,
  loadTheme,
  qualityLevel,
  type LineKind,
  type Theme,
} from '../../../../src/themes/index';
import { paper } from '../../../../src/themes/paper/index';
import { stonetable, STONE_SURFACE } from '../../../../src/themes/stonetable/index';
import { TORCH } from '../../../../src/themes/stonetable/rig';
import { albedoPixels, averageColour, stoneField } from '../../../../src/themes/stonetable/stone';

const KINDS: LineKind[] = ['target', 'attack', 'block', 'attach', 'mark'];
const c = stonetable.tokens.colours;

/** An opaque hex for a CSS colour composited over `under` (rgba panels). */
function opaque(css: string, under: string): string {
  if (css.startsWith('#')) return css;
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css.trim())!;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const base = hexToRgb(under).map((x) => x * 255);
  return `#${[1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + base[k]! * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
}

describe('Stonetable: identity and loading', () => {
  it('loads lazily under its own id and name, and is no longer the M4-C stub', async () => {
    const t = await loadTheme('stonetable');
    expect(t).toBe(stonetable);
    expect(t.id).toBe('stonetable');
    expect(t.label).toBe('Stonetable');
    expect((t as { stub?: string }).stub).toBeUndefined();
    expect(t.build).not.toBe(paper.build);
  });

  it('defaults to the ego camera (DESIGN theme table and "Camera and navigation": default in Stonetable)', () => {
    expect(stonetable.camera.defaultRig).toBe('ego');
    // The ego rig keeps the geometry spec's defaults (fov 45°, 260 behind, 620 up, 35° pitch).
    expect(stonetable.camera.ego).toBeUndefined();
  });

  it('moves with the spec motion constants', () => {
    expect(stonetable.motion).toEqual(DEFAULT_MOTION);
  });
});

describe('Stonetable: physically rendered table, torch and shadows', () => {
  it('is lit, tone-mapped and lights the table with a flickering, shadow-casting torch as its key light', () => {
    expect(stonetable.lighting.lit).toBe(true);
    expect(stonetable.lighting.toneMapping).not.toBe('none');
    const casters = stonetable.lighting.lights.filter((l) => 'castShadow' in l && l.castShadow);
    expect(casters).toEqual([TORCH]);
    expect(TORCH.flicker!.amplitude).toBeGreaterThan(0);
    expect(TORCH.flicker!.amplitude).toBeLessThan(0.2);
    // A warm (torch-coloured) light: red over blue.
    const [r, , b] = hexToRgb(TORCH.colour);
    expect(r).toBeGreaterThan(b + 0.2);
    // The torch is the key light that may shade faces, placed above the table.
    const key = keyLightOf(stonetable.lighting.lights, 0);
    expect(key).toEqual({ kind: 'position', x: TORCH.position[0], y: TORCH.position[2], z: -TORCH.position[1] });
    for (const l of stonetable.lighting.lights) if ('position' in l) expect(l.position.every(Number.isFinite)).toBe(true);
  });

  it('keeps the torch behind the viewer, high, and its cone over the whole table on every format', () => {
    const [x, y, z] = TORCH.position;
    const [tx, ty] = TORCH.target ?? [0, 0, 0];
    expect(y).toBeLessThan(-550 - 260); // behind the 1v1 near edge and the ego camera
    expect(z).toBeGreaterThan(1000);
    const axis = [tx - x, ty - y, -z];
    const angleTo = (px: number, py: number) => {
      const v = [px - x, py - y, -z];
      const dot = v[0]! * axis[0]! + v[1]! * axis[1]! + v[2]! * axis[2]!;
      return (Math.acos(dot / (Math.hypot(...v) * Math.hypot(...axis))) * 180) / Math.PI;
    };
    // Every corner of the largest tables (DESIGN "Tables and seats") is inside the cone: lit, if dimmer at the edge.
    for (const t of [{ w: 1400, d: 1100 }, { w: 2000, d: 1300 }, { w: 1800, d: 1800 }, { w: 2200, d: 1100 }]) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) expect(angleTo((sx * t.w) / 2, (sy * t.d) / 2), `${t.w}x${t.d} corner ${sx},${sy}`).toBeLessThan(TORCH.angleDeg);
    }
  });

  it('casts real shadow-map shadows and contact shadows at the best level, and drops them first', () => {
    expect(stonetable.shadows.enabled).toBe(true);
    expect(stonetable.shadows.map).not.toBeNull();
    expect(stonetable.shadows.contact).not.toBeNull();
    const device = { devicePixelRatio: 2, maxAnisotropy: 16, maxSamples: 4 };
    const high = effectiveQuality(qualityLevel(stonetable, 'high'), stonetable, device);
    expect(high).toMatchObject({ shadowMap: true, contactShadows: true, post: true, particles: true });
    const medium = effectiveQuality(qualityLevel(stonetable, 'medium'), stonetable, device);
    expect(medium).toMatchObject({ shadowMap: false, contactShadows: false, post: true });
    const low = effectiveQuality(qualityLevel(stonetable, 'low'), stonetable, device);
    expect(low).toMatchObject({ shadowMap: false, post: false, particles: false, msaa: 0 });
    expect(qualityLadderProblems(stonetable.quality)).toEqual([]);
    expect(stonetable.quality.map((q) => q.id)).toEqual(['high', 'medium', 'low']);
  });

  it('blooms and vignettes the world, leaving card faces to the overlay', () => {
    expect(stonetable.post.bloom).not.toBeNull();
    expect(stonetable.post.vignette).not.toBeNull();
    // A threshold above the lit stone keeps the bloom on runes, lines and motes.
    expect(stonetable.post.bloom!.threshold).toBeGreaterThan(0.3);
  });

  it('has no fog (the bird’s-eye rig looks from metres away and would be fogged out)', () => {
    expect(stonetable.lighting.fog).toBeNull();
  });
});

describe('Stonetable: card dressing', () => {
  const d = stonetable.cardDressing;
  it('gives cards thickness, a lit sleeve and the spec lift with a tilt and a shadow when held', () => {
    expect(d.thickness).toBe(GEOMETRY.card.thickness);
    expect(d.held).toEqual({ lift: GEOMETRY.dragLift, tiltDeg: GEOMETRY.dragTiltDeg, shadow: true });
    expect(d.sleeveMaterial).not.toBeNull();
    expect(d.sleeveMaterial!.model).not.toBe('unlit');
  });

  it('never restyles a card face: near-unlit, shaded by at most CARD_FACE_MAX_SHADE', () => {
    expect(d.faceShade).toBeGreaterThanOrEqual(0);
    expect(d.faceShade).toBeLessThanOrEqual(CARD_FACE_MAX_SHADE);
  });

  it('has its own neutral back (procedural, no official back)', () => {
    expect(d.back).not.toBeNull();
    expect(d.back!.id).toMatch(/^stonetable-/);
    expect(d.back!.width / d.back!.height).toBeCloseTo(GEOMETRY.card.w / GEOMETRY.card.h, 2);
  });

  it('draws hover, selection and pending in three different, visible colours', () => {
    const colours = [d.hover.colour, d.selected.colour, d.pending.colour];
    expect(new Set(colours).size).toBe(3);
    for (const col of colours) expect(contrastRatio(col, c.surface), col).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(colourDistance(colours[i]!, colours[j]!)).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
    expect(d.selected.width).toBeGreaterThan(d.hover.width);
    expect(contrastRatio(d.ghost.colour, c.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(d.tappedBadge, c.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(d.displacedMarker, c.surface)).toBeGreaterThanOrEqual(3);
    expect(d.foilSheen).toBe(true);
  });
});

describe('Stonetable: lines are glowing runes', () => {
  it('draws every kind as a glowing rune ribbon in the seat colour, with the seat’s pattern (never hue alone)', () => {
    for (const seat of c.seats)
      for (const kind of KINDS) {
        const s = stonetable.lineStyle(kind, seat);
        const p = paper.lineStyle(kind, paper.tokens.colours.seats[seat.index]!);
        expect(s.colour).toBe(seat.colour);
        expect(s.geometry).toBe('ribbon');
        expect(s.ornament).toBe('runes');
        expect(s.glow).toBeGreaterThan(0);
        // The same dash as Paper's for the seat: a seat's pattern is its identity across themes.
        expect(s.dash).toEqual(p.dash);
        expect(s.widthPx).toBeGreaterThanOrEqual(p.widthPx);
        expect(s.arrowhead).toBe(kind === 'attach' ? 'dot' : kind === 'mark' ? 'none' : 'chevron');
      }
  });
  it('lets persistent marks sit still while targeting lines flow toward their target', () => {
    const seat = c.seats[0]!;
    expect(stonetable.lineStyle('mark', seat).animation).toBe('none');
    expect(stonetable.lineStyle('mark', seat).dash).not.toBeNull();
    for (const k of ['target', 'attack', 'block', 'attach'] as const) expect(stonetable.lineStyle(k, seat).animation).toBe('flow');
  });
});

describe('Stonetable: tokens', () => {
  it('names the stone it draws: the surface token is the slab albedo’s average colour', () => {
    const avg = averageColour(albedoPixels(stoneField()));
    const tok = hexToRgb(STONE_SURFACE).map((x) => x * 255);
    for (let i = 0; i < 3; i++) expect(Math.abs(avg[i]! - tok[i]!)).toBeLessThan(4);
    expect(c.surface).toBe(STONE_SURFACE);
  });

  it(`tunes eight seat colours to ${SEAT_CONTRAST.surface}:1 on the stone and ${SEAT_CONTRAST.pairwise} apart`, () => {
    expect(c.seats.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const s of c.seats) {
      expect(s.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(s.colour, c.surface), `seat ${s.index}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.surface);
    }
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) expect(colourDistance(c.seats[i]!.colour, c.seats[j]!.colour), `seats ${i} ${j}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
  });

  it('keeps every seat’s pattern and glyph from Paper', () => {
    expect(c.seats.map((s) => [s.pattern, s.glyph])).toEqual(paper.tokens.colours.seats.map((s) => [s.pattern, s.glyph]));
  });

  it('is a dark HUD with readable text, seat chips and seat marks on its panels', () => {
    const hud = stonetable.tokens.hud!;
    expect(hud.scheme).toBe('dark');
    const panel = opaque(hud.panel, c.bg);
    expect(contrastRatio(c.fg, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.muted, panel)).toBeGreaterThanOrEqual(4.5);
    for (const s of c.seats) {
      expect(contrastRatio(s.colour, panel), `seat ${s.index} on panel`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(s.ink ?? c.bg, s.colour), `ink on seat ${s.index}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const k of ['danger', 'warning', 'accent', 'focus'] as const) expect(contrastRatio(c[k], panel), k).toBeGreaterThanOrEqual(4.5);
  });

  it('chalks zone outlines at 3:1 on the stone', () => {
    expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.muted, c.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('Stonetable: the theme checklist of functional signals', () => {
  it('styles every field each of the twelve signals is drawn with', () => {
    expect(SIGNALS).toHaveLength(12);
    for (const s of SIGNALS)
      for (const path of s.styledBy) {
        if (path.startsWith('lineStyle(')) {
          const kind = /lineStyle\('(\w+)'\)/.exec(path)![1] as LineKind;
          for (const seat of c.seats) expect(stonetable.lineStyle(kind, seat).widthPx, `${s.id}: ${path}`).toBeGreaterThan(0);
          continue;
        }
        let v: unknown = stonetable as Theme;
        for (const key of path.split('.')) v = (v as Record<string, unknown>)[key];
        expect(v ?? null, `${s.id}: ${path}`).not.toBeNull();
        if (typeof v === 'boolean') expect(v, `${s.id}: ${path}`).toBe(true);
      }
  });
});
