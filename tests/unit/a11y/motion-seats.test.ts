/**
 * Seat patterns beside colours and the reduced-motion audit (DESIGN "Input and interaction design", Accessibility:
 * "Seat colours are paired with a shape or pattern (line dash, avatar glyph), so nothing depends on hue alone";
 * "Reduced-motion is honoured"; "Specification: geometry, layout and motion": with reduced motion, all motion cuts;
 * PLAN M5-P4: every animation cuts or fades under prefers-reduced-motion).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dusk } from '../../../src/themes/dusk/index';
import { paper } from '../../../src/themes/paper/index';
import { stonetable } from '../../../src/themes/stonetable/index';
import { wyrm } from '../../../src/themes/wyrm/index';
import { SEAT_GLYPHS, SEAT_PATTERNS, seatGlyph } from '../../../src/ui/a11y/index';
import { REDUCED_MOTION_CSS } from '../../../src/ui/a11y/motion';

describe('seat glyphs and patterns', () => {
  it('every theme pairs each seat colour with the same glyph and line pattern, all eight distinct', () => {
    for (const t of [paper, dusk, wyrm, stonetable]) {
      expect(t.tokens.colours.seats.map((s) => s.glyph), t.id).toEqual([...SEAT_GLYPHS]);
      expect(t.tokens.colours.seats.map((s) => s.pattern), t.id).toEqual([...SEAT_PATTERNS]);
    }
    expect(new Set(SEAT_GLYPHS).size).toBe(8);
    expect(new Set(SEAT_PATTERNS).size).toBe(8);
    expect(seatGlyph(9)).toBe(SEAT_GLYPHS[1]);
  });

  /** HUD files that colour something by seat must draw the seat's glyph (or pattern) beside it. */
  it('every HUD component that colours by seat also draws the seat glyph', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.svelte')) files.push(p);
      }
    };
    walk('src/ui');
    const colouring = files.filter((f) => /--sp-seat-\{|--sp-seat-\$\{|seatColour\(|seats\[[^\]]+\]\??\.colour/.test(fs.readFileSync(f, 'utf8')));
    expect(colouring.length).toBeGreaterThan(5);
    for (const f of colouring) {
      const src = fs.readFileSync(f, 'utf8');
      expect(/SeatGlyph|class="glyph|glyph=\{/.test(src), `${f} colours by seat without a glyph`).toBe(true);
    }
  });
});

describe('reduced motion', () => {
  it('the page-wide rule cuts every CSS animation and transition to one 1 ms run under the setting', () => {
    expect(REDUCED_MOTION_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(REDUCED_MOTION_CSS).toMatch(/animation-duration: 1ms !important/);
    expect(REDUCED_MOTION_CSS).toMatch(/animation-iteration-count: 1 !important/);
    expect(REDUCED_MOTION_CSS).toMatch(/transition-duration: 1ms !important/);
  });

  it('a component whose signal is an endless animation shows it still under reduced motion (the cut must not hide it)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(svelte|css)$/.test(p)) {
          const src = fs.readFileSync(p, 'utf8');
          if (/animation[^;]*infinite/.test(src) && !/prefers-reduced-motion/.test(src)) offenders.push(p);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
