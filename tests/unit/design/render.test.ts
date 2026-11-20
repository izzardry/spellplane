/**
 * Kit components rendered on the server (svelte/server): what other packages read from the seams of contracts.md
 * Part B (band names, the still's size, the boosters' names and counts, a pile's default edge). Added by M8-P1.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BoosterFan from '../../../src/ui/design/BoosterFan.svelte';
import BoosterPack from '../../../src/ui/design/BoosterPack.svelte';
import PileStack from '../../../src/ui/design/PileStack.svelte';
import StrengthPips from '../../../src/ui/design/StrengthPips.svelte';
import TableThumb from '../../../src/ui/design/TableThumb.svelte';
import { STRENGTH_BANDS, bandName } from '../../../src/ui/design/strength';
import { thumbBox } from '../../../src/ui/design/thumb';

const attr = (html: string, tag: string, name: string): string | null => {
  const m = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(html);
  return m ? m[1]! : null;
};
const visible = (html: string): string => /<span class="ds-t-eyebrow"[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? '';

describe('StrengthPips', () => {
  it('names the five bands of decks.md D19: Rough, Casual, Solid, Tuned, Fierce', () => {
    expect(STRENGTH_BANDS).toEqual(['Rough', 'Casual', 'Solid', 'Tuned', 'Fierce']);
    const cases: [1 | 2 | 3 | 4 | 5, number, string][] = [
      [1, 15, '15 Rough'],
      [2, 35, '35 Casual'],
      [3, 54, '54 Solid'],
      [4, 75, '75 Tuned'],
      [5, 92, '92 Fierce'],
    ];
    for (const [band, score, text] of cases) {
      const { body } = render(StrengthPips, { props: { band, score } });
      expect(visible(body)).toBe(text);
      expect(attr(body, 'span', 'aria-label')).toBe(`Strength ${score}, ${bandName(band)}, band ${band} of 5`);
      expect(attr(body, 'span', 'data-band')).toBe(String(band));
      expect(body.match(/ds-str__bar--off/g) ?? []).toHaveLength(5 - band);
    }
  });

  it('uses label as the accessible name, never as visible text; text={false} draws the bars alone', () => {
    const named = render(StrengthPips, { props: { band: 3, label: 'Deck strength 3 of 5' } }).body;
    expect(attr(named, 'span', 'aria-label')).toBe('Deck strength 3 of 5');
    expect(visible(named)).toBe('Solid');
    expect(named).not.toContain('>Deck strength');
    const bare = render(StrengthPips, { props: { band: 2, text: false } }).body;
    expect(bare).not.toContain('ds-t-eyebrow');
    expect(attr(bare, 'span', 'aria-label')).toBe('Strength Casual, band 2 of 5');
    const unknown = render(StrengthPips, { props: { band: null } }).body;
    expect(attr(unknown, 'span', 'aria-label')).toBe('Strength unknown');
    expect(unknown.match(/ds-str__bar--off/g) ?? []).toHaveLength(5);
  });
});

describe('TableThumb', () => {
  const seats = [{ colour: 'red', life: 20 }, { colour: 'blue', life: 18 }];
  it('is 16:9 whatever the thumb frame: 128 × 72 by default, 96 × 54 in the continue strip', () => {
    const frames = [
      { w: 80, h: 80, cards: [[40, 40, 0, 0]] },
      { w: 143, h: 480, cards: [[40, 40, 0, 0], [103, 440, 1, 1]] },
      { w: 1280, h: 720, cards: [] },
      { w: 3000, h: 400, cards: [[10, 10, 0, 0]] },
    ] as { w: number; h: number; cards: [number, number, 0 | 1, number][] }[];
    for (const thumb of [...frames, null]) {
      const def = render(TableThumb, { props: { thumb, seats } }).body;
      expect([attr(def, 'svg', 'width'), attr(def, 'svg', 'height')]).toEqual(['128', '72']);
      const small = render(TableThumb, { props: { thumb, seats, width: 96 } }).body;
      expect([attr(small, 'svg', 'width'), attr(small, 'svg', 'height')]).toEqual(['96', '54']);
      const vb = attr(def, 'svg', 'viewBox')!.split(' ').map(Number);
      expect(vb[2]! / vb[3]!).toBeCloseTo(16 / 9, 6);
    }
  });

  it('the box holds the whole frame, centred, and is at least a table wide', () => {
    for (const f of [{ w: 80, h: 80 }, { w: 143, h: 480 }, { w: 3000, h: 400 }, { w: 1280, h: 720 }]) {
      const b = thumbBox(f);
      expect(b.w / b.h).toBeCloseTo(16 / 9, 6);
      expect(b.x).toBeLessThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(0);
      expect(b.x + b.w).toBeGreaterThanOrEqual(f.w);
      expect(b.y + b.h).toBeGreaterThanOrEqual(f.h);
      expect(b.x + b.w / 2).toBeCloseTo(f.w / 2, 6);
      expect(b.w).toBeGreaterThanOrEqual(1050);
    }
    expect(thumbBox({ w: 1280, h: 720 })).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('boosters and piles keep the seed seams', () => {
  it('a pack is named "<CODE> booster" and 80 wide by default', () => {
    const { body } = render(BoosterPack, { props: { set: 'm19' } });
    expect(attr(body, 'svg', 'aria-label')).toBe('M19 booster');
    expect(attr(body, 'svg', 'width')).toBe('80');
  });
  it('a fan says how many boosters (the sets given when count is not), and carries its label as is', () => {
    const fan = render(BoosterFan, { props: { sets: ['M19', 'M19', 'M19'], label: 'Three boosters of M19' } }).body;
    expect(attr(fan, 'div', 'data-count')).toBe('3');
    expect(attr(fan, 'div', 'aria-label')).toBe('Three boosters of M19');
    expect(fan.match(/aria-label="M19 booster"/g) ?? []).toHaveLength(3);
    const counted = render(BoosterFan, { props: { sets: ['M19'], count: 2, label: 'x' } }).body;
    expect(attr(counted, 'div', 'data-count')).toBe('2');
  });
  it('a pile without a count has no edge', () => {
    const { body } = render(PileStack, { props: {} });
    expect(attr(body, 'span', 'data-count')).toBe('0');
    expect(body).not.toMatch(/class="[^"]*ds-pile\b/);
  });
});
