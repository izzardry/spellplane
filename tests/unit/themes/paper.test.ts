// Paper contrast, DESIGN "Input and interaction design" (Accessibility: Paper meets WCAG AA contrast throughout):
// text 4.5:1, zone hairlines and other non-text markings 3:1 against the white table.
import { describe, expect, it } from 'vitest';
import { paper } from '../../../src/themes/paper';

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('Paper contrast', () => {
  const c = paper.tokens.colours;
  it('text colours reach 4.5:1 on the table', () => {
    expect(contrast(c.fg, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.muted, c.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it('zone hairlines (border) reach 3:1 on the table', () => {
    expect(contrast(c.border, c.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.border, c.bg)).toBeGreaterThanOrEqual(3);
  });
  it('seat colours reach 4.5:1 on the white table and panel, as text in a seat colour does (confirm prompt names)', () => {
    const panel = paper.tokens.hud!.panel;
    for (const seat of c.seats) {
      expect(contrast(seat.colour, c.surface), `seat ${seat.index} ${seat.colour} on the table`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(seat.colour, panel), `seat ${seat.index} ${seat.colour} on the panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(seat.ink ?? c.bg, seat.colour), `ink on seat ${seat.index}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
