import type { Canvas2D } from '../../../../src/util/texture';

/** One recorded call on a fake 2D context. */
export interface CanvasCall {
  name: string;
  args: unknown[];
}

/**
 * A 2D context stand-in that records every call and property write (no canvas in Node). `createImageData` returns a
 * real pixel buffer, so `putImageData` calls carry the pixels drawn.
 */
export function recordingContext(): { ctx: Canvas2D; calls: CanvasCall[]; props: Record<string, unknown[]> } {
  const calls: CanvasCall[] = [];
  const props: Record<string, unknown[]> = {};
  const target: Record<string, unknown> = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t && typeof t[key] === 'function') {
        const fn = t[key] as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => {
          calls.push({ name: key, args });
          return fn(...args);
        };
      }
      if (key in t) return t[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        return undefined;
      };
    },
    set(t, key: string, value: unknown) {
      (props[key] ??= []).push(value);
      t[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as Canvas2D, calls, props };
}

/** Every number among a call's arguments. */
export const numbers = (c: CanvasCall): number[] => c.args.filter((a): a is number => typeof a === 'number');

/** An OffscreenCanvas stand-in whose 2D context is a recording context (procedural maps draw into it). */
export function installRecordingCanvas(): () => void {
  const g = globalThis as { OffscreenCanvas?: unknown };
  const prev = g.OffscreenCanvas;
  g.OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return recordingContext().ctx;
    }
  };
  return () => {
    g.OffscreenCanvas = prev;
  };
}
