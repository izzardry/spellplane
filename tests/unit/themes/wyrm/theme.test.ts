// PLAN M4-P4 Wyrm as data. DESIGN "Themes and rendering": theme table (obsidian slab, ember seams, fiery line glow,
// ember particles, heat shimmer on the stack, ego camera); Tokens ("the eight seat colours, tuned per theme for
// contrast", exposed to the HUD); Card dressing; "Card faces are never restyled"; Assets (CC0 or procedural, no
// Wizards artwork, logos or card back); Renderer ("a per-theme quality setting drops shadows and post-processing first").
// "Specification: geometry, layout and motion": thickness 0.6, lift 12 with a 4° tilt in lit themes; motion constants.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION, GEOMETRY } from '../../../../src/core/geometry';
import type { LineKind } from '../../../../src/core/types';
import { qualityLadderProblems } from '../../../../src/scene/quality';
import { CARD_FACE_MAX_SHADE, colourDistance, contrastRatio, loadTheme, qualityLevel, SEAT_CONTRAST, tokensToCssVars, type MaterialSpec, type Theme } from '../../../../src/themes/index';
import { paper } from '../../../../src/themes/paper/index';
import { BACK_COLOURS, WYRM_BACK } from '../../../../src/themes/wyrm/back';
import { EMBER, shimmerAllowed, wyrm, WYRM_EFFECTS } from '../../../../src/themes/wyrm/index';

const KINDS: LineKind[] = ['target', 'attack', 'block', 'attach', 'mark'];
const c = wyrm.tokens.colours;

describe('Wyrm theme package', () => {
  it('is the real theme behind loadTheme("wyrm"), not the stub, with the ego camera by default', async () => {
    const t = await loadTheme('wyrm');
    expect(t).toBe(wyrm);
    expect((t as { stub?: string }).stub).toBeUndefined();
    expect(t).toMatchObject({ id: 'wyrm', label: 'Wyrm', camera: { defaultRig: 'ego' } });
    // Its own build, not Paper's flat plane.
    expect(t.build).not.toBe(paper.build);
  });

  it('is lit and dark: lights with a shadow-casting key, shadows on, bloom and vignette, a near-black background', () => {
    expect(wyrm.lighting.lit).toBe(true);
    expect(wyrm.lighting.lights.some((l) => 'castShadow' in l && l.castShadow)).toBe(true);
    expect(wyrm.lighting.toneMapping).not.toBe('none');
    expect(contrastRatio(wyrm.lighting.background, '#000000')).toBeLessThan(1.2);
    expect(wyrm.shadows.enabled).toBe(true);
    expect(wyrm.shadows.map).not.toBeNull();
    expect(wyrm.post.bloom).not.toBeNull();
    // Bloom low enough for lines in seat colours to glow (fiery line glow).
    expect(wyrm.post.bloom!.threshold).toBeLessThan(0.3);
    // A vignette that darkens (three's VignetteShader mixes toward 1 - darkness: above 1 it goes negative).
    expect(wyrm.post.vignette!.darkness).toBeGreaterThan(0);
    expect(wyrm.post.vignette!.darkness).toBeLessThanOrEqual(1);
  });

  it('dresses cards as the geometry spec says and never lights the printed face beyond CARD_FACE_MAX_SHADE', () => {
    const d = wyrm.cardDressing;
    expect(d.thickness).toBe(GEOMETRY.card.thickness);
    expect(d.held).toEqual({ lift: GEOMETRY.dragLift, tiltDeg: GEOMETRY.dragTiltDeg, shadow: true });
    expect(d.faceShade).toBeGreaterThanOrEqual(0);
    expect(d.faceShade).toBeLessThanOrEqual(CARD_FACE_MAX_SHADE);
    expect(d.sleeveMaterial?.model).not.toBe('unlit');
    expect(d.foilSheen).toBe(true);
    expect(wyrm.motion).toEqual(DEFAULT_MOTION);
  });

  it('tunes its eight seat colours to the slab: 3:1 against the surface, apart from each other and from the seams’ ember', () => {
    expect(c.seats).toHaveLength(8);
    c.seats.forEach((s, i) => {
      expect(s.index).toBe(i);
      // A seat keeps its pattern and glyph in every theme.
      expect(s.pattern).toBe(paper.tokens.colours.seats[i]!.pattern);
      expect(s.glyph).toBe(paper.tokens.colours.seats[i]!.glyph);
      expect(contrastRatio(s.colour, c.surface), s.colour).toBeGreaterThanOrEqual(SEAT_CONTRAST.surface);
      // Seat chips and caption bubbles: text on the seat colour (WCAG AA).
      expect(contrastRatio(s.ink!, s.colour), s.colour).toBeGreaterThanOrEqual(4.5);
      // A line over the glowing seams still reads as its seat, not as fire.
      expect(colourDistance(s.colour, EMBER), s.colour).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
    });
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        expect(colourDistance(c.seats[i]!.colour, c.seats[j]!.colour), `${i}/${j}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
        expect(colourDistance(c.seats[i]!.glow!, c.seats[j]!.glow!), `glow ${i}/${j}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
      }
  });

  it('keeps the signals the HUD and the markings draw legible: hairlines, text, focus, away, speaking, pending style', () => {
    // Zone hairlines on the slab (WCAG 1.4.11 non-text contrast).
    expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(3);
    // HUD text on the dark panels, muted text (the "away" avatar dims to it) still AA.
    expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(c.muted, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
    expect(colourDistance(c.muted, c.fg)).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
    // The speaking ring is drawn in the seat colour on the HUD's dark panel.
    for (const s of c.seats) expect(contrastRatio(s.colour, c.bg)).toBeGreaterThanOrEqual(3);
    // Selection and hover read on the slab and apart from each other.
    const d = wyrm.cardDressing;
    for (const h of [d.hover, d.selected]) expect(contrastRatio(h.colour, c.surface)).toBeGreaterThanOrEqual(3);
    expect(colourDistance(d.hover.colour, d.selected.colour)).toBeGreaterThan(0.1);
    // The pending style, for the scene hook that draws it (scene/table-scene.ts entryHighlight does not read
    // cardDressing.pending yet; tests/e2e/signals.spec.ts measures the drawn signal): it reads on the slab, apart from
    // selection and hover, and apart from every seat colour, so a stack outline switching from its controller's seat
    // colour to it changes colour as well as width.
    expect(contrastRatio(d.pending.colour, c.surface)).toBeGreaterThanOrEqual(3);
    for (const h of [d.hover, d.selected]) expect(colourDistance(d.pending.colour, h.colour)).toBeGreaterThan(0.1);
    for (const s of c.seats) expect(colourDistance(d.pending.colour, s.colour), `seat ${s.index}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
    expect(d.pending.width).toBeGreaterThan(0.8);
    expect(d.selected.width).toBeGreaterThan(d.hover.width);
    const vars = tokensToCssVars(wyrm.tokens);
    expect(vars['--sp-hud-scheme']).toBe('dark');
    expect(vars['--sp-seat-0-ink']).toBe(c.seats[0]!.ink);
  });

  it('draws every line kind in the seat colour with the seat’s dash, glowing, with an arrowhead where the kind has a direction', () => {
    for (const seat of c.seats) {
      for (const kind of KINDS) {
        const st = wyrm.lineStyle(kind, seat);
        expect(st.colour).toBe(seat.colour);
        expect(st.widthPx).toBeGreaterThanOrEqual(1.5);
        expect(st.glow).toBeGreaterThan(0);
        expect(st.geometry).toBe('ribbon');
        // Same dash as Paper: lines never depend on hue alone, and marks are always dashed.
        expect(st.dash).toEqual(paper.lineStyle(kind, paper.tokens.colours.seats[seat.index]!).dash);
        if (kind === 'mark') expect(st.dash).not.toBeNull();
        expect(st.arrowhead).toBe(kind === 'mark' ? 'none' : kind === 'attach' ? 'dot' : 'chevron');
      }
      expect(wyrm.lineStyle('attack', seat).ornament).toBe('embers');
    }
  });

  it('has a quality ladder that drops shadows, then the shimmer and post-processing, then the embers', () => {
    expect(qualityLadderProblems(wyrm.quality)).toEqual([]);
    expect(wyrm.quality.map((q) => q.id)).toEqual(['high', 'medium', 'low']);
    const [high, medium, low] = [qualityLevel(wyrm, 'high'), qualityLevel(wyrm, 'medium'), qualityLevel(wyrm, 'low')];
    expect(high).toMatchObject({ shadows: true, post: true, particles: true });
    expect(shimmerAllowed(high, false)).toBe(true);
    expect(medium).toMatchObject({ shadows: false, post: true, particles: true });
    expect(shimmerAllowed(medium, false)).toBe(false);
    expect(low).toMatchObject({ shadows: false, post: false, particles: false });
    expect(shimmerAllowed(low, false)).toBe(false);
    // Reduced motion never runs the shimmer, at any level.
    for (const q of wyrm.quality) expect(shimmerAllowed(q, true)).toBe(false);
    // A post-off level never gets the shimmer even if the table says so.
    expect(shimmerAllowed({ ...high, post: false }, false)).toBe(false);
    expect(Object.keys(WYRM_EFFECTS).sort()).toEqual(['high', 'low', 'medium']);
  });

  it('lists its procedural modules in docs/ASSETS.md with the manifest’s licence for this repository’s code', () => {
    const md = readFileSync(resolve(__dirname, '../../../../docs/ASSETS.md'), 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| `src/themes/wyrm/'));
    expect(rows.map((r) => r.split('|')[1]!.trim()).sort()).toEqual(['`src/themes/wyrm/back.ts`', '`src/themes/wyrm/embers.ts`', '`src/themes/wyrm/scales.ts`', '`src/themes/wyrm/shimmer.ts`', '`src/themes/wyrm/slab.ts`']);
    for (const r of rows) {
      const cells = r.split('|').map((x) => x.trim());
      expect(cells[4], r).toBe('procedural');
      expect(cells[5], r).toBe('MIT (this repository)');
    }
  });

  it('bundles no asset file: every material map is procedural and the card back is drawn', () => {
    const specs: (MaterialSpec | null)[] = [wyrm.cardDressing.sleeveMaterial];
    for (const s of specs) for (const m of Object.values(s?.maps ?? {})) expect(m.kind).toBe('procedural');
    const t: Theme = wyrm;
    expect(t.cardDressing.back).toBe(WYRM_BACK);
    // Sound is optional (DESIGN Sound) and Wyrm has none: nothing to fetch.
    expect(t.sounds).toBeUndefined();
  });
});

describe('Wyrm card back', () => {
  /** A 2D context that records every call. */
  function recorder() {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => ({ addColorStop: (o: number, col: string) => calls.push(`stop:${o}:${col}`) });
          return (...args: unknown[]) => calls.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`);
        },
        set(_t, prop: string, value: unknown) {
          calls.push(`${prop}=${typeof value === 'object' ? 'gradient' : String(value)}`);
          return true;
        },
      },
    );
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it('is geometric and neutral: no text, no images, the same picture every time, in the card’s aspect', () => {
    const a = recorder();
    const b = recorder();
    WYRM_BACK.draw(a.ctx, WYRM_BACK.width, WYRM_BACK.height);
    WYRM_BACK.draw(b.ctx, WYRM_BACK.width, WYRM_BACK.height);
    expect(a.calls).toEqual(b.calls);
    expect(a.calls.some((x) => /^(fillText|strokeText|drawImage|putImageData)\(/.test(x))).toBe(false);
    expect(a.calls).toContain(`fillStyle=${BACK_COLOURS.field}`);
    expect(WYRM_BACK.width / WYRM_BACK.height).toBeCloseTo(GEOMETRY.card.w / GEOMETRY.card.h, 2);
    // It fills the whole card first (no transparent corners showing the table through a face-down card).
    expect(a.calls.indexOf(`fillRect(0.00,0.00,${WYRM_BACK.width.toFixed(2)},${WYRM_BACK.height.toFixed(2)})`)).toBeGreaterThanOrEqual(0);
    expect(WYRM_BACK.id).not.toBe(paper.cardDressing.back?.id);
  });
});
