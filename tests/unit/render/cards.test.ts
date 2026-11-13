// DESIGN "Specification: geometry, layout and motion": card 63 × 88, corner radius 3, rendered thickness 0.6 in themes
// with thickness; lift while dragged 12 with a 4° tilt toward the drag direction in lit themes; motion springs
// (stiffness 320, damping 36, mass 1); reduced motion cuts. Theme table, Dusk: soft contact shadows.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION, GEOMETRY } from '../../../src/core/geometry';
import { boxShape, cardBoxGeometry, cardMatrix, contactShadowOf, SLEEVE_MARGIN_MM, type CardDraw } from '../../../src/scene/cards';
import { FULL_TILT_SPEED, HeldLift, heldTilt } from '../../../src/scene/motion';
import { paper } from '../../../src/themes/paper';
import { litTestTheme } from '../../../src/themes/test-lit';

const draw = (over: Partial<CardDraw> = {}): CardDraw => ({ pose: { x: 100, y: -50, rot: 0 }, z: 0, scaleX: 1, uv: null, dim: 0, highlight: null, ...over });
const world = (d: CardDraw, lx: number, ly: number, lz = 0, lift = 0) => {
  const m = new Float32Array(16);
  cardMatrix(d, m, 0, lift);
  return new THREE.Vector3(lx, ly, lz).applyMatrix4(new THREE.Matrix4().fromArray(m));
};

describe('card boxes', () => {
  it('extrude the rounded card by its thickness, with a sleeve margin when sleeved', () => {
    const g = cardBoxGeometry(0.6, 0.8);
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(GEOMETRY.card.w + 1.6);
    expect(size.y).toBeCloseTo(GEOMETRY.card.h + 1.6);
    expect(size.z).toBeCloseTo(0.6);
    // Top/bottom caps and the edges take different materials (sleeve, edge).
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1]);
  });

  it('come from the dressing: Paper is flat, a lit sleeved theme has 0.6 mm boxes', () => {
    expect(boxShape(paper.cardDressing)).toEqual({ thickness: 0, margin: 0 });
    expect(boxShape(litTestTheme().cardDressing)).toEqual({ thickness: GEOMETRY.card.thickness, margin: SLEEVE_MARGIN_MM });
    expect(boxShape({ ...litTestTheme().cardDressing, sleeve: null, sleeveMaterial: null })).toEqual({ thickness: 0.6, margin: 0 });
  });
});

describe('cardMatrix', () => {
  it('maps the card onto the table at its pose, height and lift (table y is world -z)', () => {
    const d = draw({ pose: { x: 100, y: -50, rot: 90 }, z: 2 });
    const c = world(d, 0, 0, 0, 12);
    expect(c.toArray().map((v) => +v.toFixed(6))).toEqual([100, 14, 50]);
    // rot 90 (clockwise): the card's top points along table +x.
    const top = world(d, 0, 44);
    expect(top.x).toBeCloseTo(144);
    expect(top.z).toBeCloseTo(50);
  });

  it('tilts a held card so the edge toward the drag dips and the other rises', () => {
    const d = draw({ tilt: { x: 1, y: 0, deg: 4 } });
    const centre = world(d, 0, 0);
    const lead = world(d, 31.5, 0);
    const trail = world(d, -31.5, 0);
    expect(lead.y).toBeLessThan(centre.y);
    expect(trail.y).toBeGreaterThan(centre.y);
    expect(Math.asin((centre.y - lead.y) / 31.5) / (Math.PI / 180)).toBeCloseTo(4, 3);
    // Toward table +y (away from seat 0): the card's top edge dips.
    const up = draw({ tilt: { x: 0, y: 1, deg: 4 } });
    expect(world(up, 0, 44).y).toBeLessThan(0);
    // No direction or no angle: flat.
    expect(world(draw({ tilt: { x: 0, y: 0, deg: 4 } }), 31.5, 0).y).toBeCloseTo(0);
  });
});

describe('held lift and tilt', () => {
  it('springs up to the lift without overshoot and settles, and back down after the drop', () => {
    const lift = new HeldLift();
    lift.set(GEOMETRY.dragLift, false);
    let prev = 0;
    let t = 0;
    while (lift.moving && t < 2000) {
      lift.step(16, DEFAULT_MOTION);
      expect(lift.value).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(lift.value).toBeLessThanOrEqual(GEOMETRY.dragLift + 1e-6);
      prev = lift.value;
      t += 16;
    }
    expect(lift.value).toBe(12);
    expect(t).toBeLessThan(800);
    lift.set(0, false);
    while (lift.moving) lift.step(16, DEFAULT_MOTION);
    expect(lift.value).toBe(0);
  });

  it('cuts with reduced motion', () => {
    const lift = new HeldLift();
    lift.set(12, true);
    expect(lift.value).toBe(12);
    expect(lift.moving).toBe(false);
  });

  it('tilts toward the drag velocity, scaled by speed, up to the dressing tilt; none at rest, in Paper or reduced', () => {
    expect(heldTilt(FULL_TILT_SPEED * 2, 0, 4, false)).toEqual({ x: 1, y: 0, deg: 4 });
    const half = heldTilt(0, -FULL_TILT_SPEED / 2, 4, false)!;
    expect(half).toMatchObject({ x: 0, y: -1 });
    expect(half.deg).toBeCloseTo(2);
    expect(heldTilt(0, 0, 4, false)).toBeNull();
    expect(heldTilt(300, 300, 0, false)).toBeNull();
    expect(heldTilt(300, 300, 4, true)).toBeNull();
  });
});

describe('contact shadows', () => {
  const contact = { opacity: 0.5, blurMm: 4, heightMm: 40 };
  it('are darkest on the table and fade out and soften with height', () => {
    expect(contactShadowOf(0, contact)).toEqual({ opacity: 0.5, blur: 4 });
    const held = contactShadowOf(12, contact);
    expect(held.opacity).toBeCloseTo(0.5 * (1 - 12 / 40));
    expect(held.blur).toBeGreaterThan(4);
    expect(contactShadowOf(40, contact).opacity).toBe(0);
    expect(contactShadowOf(100, contact).opacity).toBe(0);
    expect(contactShadowOf(-1, contact)).toEqual({ opacity: 0.5, blur: 4 });
  });
});
