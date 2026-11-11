// Minimal types for troika-three-text (its package.json names no type entry). Only what scene/text.ts uses.
declare module 'troika-three-text' {
  import type { Color, Material, Mesh, Object3DEventMap } from 'three';

  export interface TextEventMap extends Object3DEventMap {
    syncstart: object;
    synccomplete: object;
  }

  export class Text extends Mesh<never, never, TextEventMap> {
    text: string;
    font: string | null;
    fontSize: number;
    color: Color | string | number | null;
    anchorX: number | 'left' | 'center' | 'right' | string;
    anchorY: number | 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom' | string;
    letterSpacing: number;
    maxWidth: number;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    outlineWidth: number | string;
    outlineColor: Color | string | number;
    outlineOpacity: number;
    fillOpacity: number;
    sdfGlyphSize: number | null;
    material: Material;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export class BatchedText extends Text {
    addText(text: Text): void;
    removeText(text: Text): void;
  }

  export function configureTextBuilder(config: { defaultFontURL?: string | null; unicodeFontsURL?: string | null; sdfGlyphSize?: number; useWorker?: boolean }): void;
}
