/**
 * Procedural texture seam (docs/DESIGN.md, "Specification: code interfaces": `cardBack: TextureSource`).
 * Lives in util/ because games/ (card back) and themes/ (card dressing) both need it and neither may import the other.
 * Nothing is bundled as an image: a texture is a function that paints onto a 2D canvas.
 */

/** A 2D drawing context from a DOM canvas or an OffscreenCanvas (DESIGN "Themes and rendering"). */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A procedurally drawn texture: `draw` paints the whole `width` x `height` area; same input, same picture (DESIGN "Specification: code interfaces"). */
export interface TextureSource {
  /** Stable cache key, e.g. 'mtg-back'. */
  id: string;
  /** Preferred size in pixels (card textures use the 63 x 88 aspect, e.g. 488 x 680). */
  width: number;
  height: number;
  draw(ctx: Canvas2D, width: number, height: number): void;
}
