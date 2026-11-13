// Foil marker on the play table (DESIGN "Pre-game", Pack generation: "Foils are marked with a subtle sheen and a badge";
// "Card faces are never recoloured"; PLAN M4-P6 foil signal).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CardLayer, legibleOutlineMm, type CardDraw } from '../../../src/scene/cards';
import { FOIL_SHEEN, TABLE_FOIL, foilHue, foilSheenColour } from '../../../src/scene/foil';
import { CARD_H, CARD_W } from '../../../src/scene/math';

const base = (extra: Partial<CardDraw> = {}): CardDraw => ({ pose: { x: 0, y: 0, rot: 0 }, z: 0, scaleX: 1, uv: null, dim: 0, highlight: null, ...extra });

describe('foil sheen', () => {
  it('hue drifts with the phase and is out of step per card, wrapping into 0..1', () => {
    expect(foilHue(0, 0)).toBe(0);
    expect(foilHue(0.5, 0)).toBe(0.5);
    expect(foilHue(1.25, 0)).toBeCloseTo(0.25);
    expect(foilHue(-0.25, 0)).toBeCloseTo(0.75);
    expect(foilHue(0, 1)).not.toBe(foilHue(0, 0));
    expect(foilSheenColour(0.5, 0)).toBe(`hsl(180, ${FOIL_SHEEN.saturation}%, ${FOIL_SHEEN.lightness}%)`);
  });

  it('the table badge sits in the bottom-left corner, inside the card and clear of its centre', () => {
    const { inset, radius, outline } = TABLE_FOIL.badge;
    expect(inset - radius).toBeGreaterThan(1);
    expect(inset + radius).toBeLessThan(Math.min(CARD_W, CARD_H) / 4);
    expect(outline).toBeLessThan(radius);
    // The rim must read at play zoom but stay a rim (the outline slot holds at most 2 mm).
    expect(TABLE_FOIL.rimMm).toBeGreaterThanOrEqual(FOIL_SHEEN.widthMm);
    expect(TABLE_FOIL.rimMm).toBeLessThanOrEqual(2);
  });

  it('the card layer flags a foil instance with its badge hue and leaves others unmarked', () => {
    const layer = new CardLayer(new THREE.Scene(), '#ffffff');
    layer.write([base(), base({ foil: 0.25 }), base({ foil: null }), base({ foil: 0 })]);
    const misc = layer.mesh.geometry.getAttribute('aMisc').array as Float32Array;
    expect(misc[3]).toBe(0);
    expect(misc[7]).toBeCloseTo(1.25);
    expect(misc[11]).toBe(0);
    expect(misc[15]).toBe(1);
    // The face is untouched: no dim, the texture slot as given.
    expect(misc[6]).toBe(0);
    layer.dispose();
  });
});

describe('hover outline at play zoom (DESIGN "Themes and rendering", Card dressing: hover treatment)', () => {
  it('shows at least the minimum on screen, up to the 2 mm outline slot, and keeps a wider theme width', () => {
    // A 100 px card: 0.6 mm is under a pixel; widened to 1.5 px.
    expect(legibleOutlineMm(0.6, 100, 1.5) * (100 / CARD_H)).toBeCloseTo(1.5);
    // Far out the slot caps it.
    expect(legibleOutlineMm(0.6, 20, 1.5)).toBe(2);
    // Close in the theme's width stands.
    expect(legibleOutlineMm(0.6, 400, 1.5)).toBe(0.6);
    expect(legibleOutlineMm(0.9, 0, 1.5)).toBe(0.9);
  });
});
