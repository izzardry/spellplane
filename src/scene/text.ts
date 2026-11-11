/**
 * Table text: counters, badges, notes and zone labels as signed-distance-field text (DESIGN "Themes and rendering",
 * Renderer: SDF text so labels stay sharp at any zoom). All labels live in one troika BatchedText, one draw call
 * (plus one for outlines). The font is bundled (fonts/Roboto-Medium.ttf, Apache-2.0) so nothing is fetched from a
 * CDN; text is restricted to Latin characters the font covers, so troika never asks its unicode font resolver.
 */
import * as THREE from 'three';
import { BatchedText, Text, configureTextBuilder } from 'troika-three-text';
import fontUrl from './fonts/Roboto-Medium.ttf?url';
import { DEG } from './math';

export interface TextSpec {
  text: string;
  /** Table position, mm. */
  x: number;
  y: number;
  z: number;
  /** Rotation in degrees clockwise (the reading direction). */
  rot: number;
  /** Cap height-ish size in mm. */
  size: number;
  colour: string;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  /** Outline colour for legibility over card art; width as a fraction of the size. */
  outline?: string;
  letterSpacing?: number;
}

let configured = false;

/** Keep characters the bundled font has (Basic Latin, Latin-1, Latin Extended-A/B); others become '?'. */
export function sanitize(s: string): string {
  return [...s].map((ch) => ((ch.codePointAt(0) ?? 0) < 0x250 ? ch : '?')).join('');
}

export class TextLayer {
  readonly object: BatchedText;
  private members = new Map<string, { t: Text; spec: TextSpec }>();
  private material: THREE.MeshBasicMaterial;

  constructor() {
    if (!configured) {
      configureTextBuilder({ defaultFontURL: fontUrl, unicodeFontsURL: null });
      configured = true;
    }
    this.object = new BatchedText();
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.object.material = this.material;
    this.object.font = fontUrl;
    this.object.rotation.x = -Math.PI / 2;
    this.object.renderOrder = 3;
    this.object.frustumCulled = false;
    this.object.name = 'text';
  }

  /** Set the full set of labels; members not listed are removed. Cheap when nothing changed. */
  sync(specs: ReadonlyMap<string, TextSpec>): void {
    for (const [key, m] of this.members) {
      if (!specs.has(key)) {
        this.object.removeText(m.t);
        m.t.dispose();
        this.members.delete(key);
      }
    }
    for (const [key, spec] of specs) {
      let m = this.members.get(key);
      let fresh = false;
      if (!m) {
        const t = new Text();
        t.font = fontUrl;
        m = { t, spec };
        fresh = true;
        this.members.set(key, m);
        this.object.addText(t);
      }
      const t = m.t;
      // A fresh member compares against an impossible spec so every property is set once.
      const prev: Partial<TextSpec> = fresh ? { size: -1, colour: '', text: '\u0000', anchorX: undefined, anchorY: undefined, letterSpacing: -1, outline: '\u0000' } : m.spec;
      const text = sanitize(spec.text);
      if (prev.text !== text) t.text = text;
      if (prev.size !== spec.size) t.fontSize = spec.size;
      if (prev.colour !== spec.colour) t.color = spec.colour;
      if (fresh || prev.anchorX !== spec.anchorX) t.anchorX = spec.anchorX ?? 'center';
      if (fresh || prev.anchorY !== spec.anchorY) t.anchorY = spec.anchorY ?? 'middle';
      if (prev.letterSpacing !== spec.letterSpacing) t.letterSpacing = spec.letterSpacing ?? 0;
      if (prev.outline !== spec.outline) {
        t.outlineWidth = spec.outline ? '12%' : 0;
        if (spec.outline) t.outlineColor = spec.outline;
      }
      // Batch-local frame: x = table x, y = table y, z = height.
      t.position.set(spec.x, spec.y, spec.z);
      t.rotation.z = -spec.rot * DEG;
      m.spec = { ...spec, text };
    }
  }

  get size(): number {
    return this.members.size;
  }

  dispose(): void {
    for (const m of this.members.values()) m.t.dispose();
    this.members.clear();
    this.object.dispose();
    this.material.dispose();
  }
}
