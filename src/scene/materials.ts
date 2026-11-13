/**
 * Materials for the lit pipeline (DESIGN "Themes and rendering": card boxes with thickness, sleeves and tables lit,
 * card faces near-unlit so the printed colours stay; "Card faces are never restyled"). Stub by M4-C; implemented by
 * M4-P2 (scene/materials.ts).
 */
import type { WebGLRenderer } from 'three';
import type { MaterialLibrary } from './types';

/** A material library bound to a renderer (anisotropy, colour space). Stub: M4-P2. */
export function createMaterialLibrary(_renderer: WebGLRenderer): MaterialLibrary {
  throw new Error('not implemented: M4-P2 (materials)');
}
