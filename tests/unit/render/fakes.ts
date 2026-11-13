import type * as THREE from 'three';

/** A renderer stand-in for code that only reads capabilities and sizes (no WebGL in Node). */
export function fakeRenderer(opts: { maxAnisotropy?: number; maxSamples?: number } = {}): THREE.WebGLRenderer {
  let pixelRatio = 1;
  return {
    capabilities: { getMaxAnisotropy: () => opts.maxAnisotropy ?? 16, maxSamples: opts.maxSamples ?? 4 },
    getPixelRatio: () => pixelRatio,
    setPixelRatio: (v: number) => (pixelRatio = v),
    getSize: (v: THREE.Vector2) => v.set(800, 600),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800 * pixelRatio, 600 * pixelRatio),
  } as unknown as THREE.WebGLRenderer;
}

/** A 2D canvas stand-in for procedural maps: records nothing, accepts every call. */
export function installFakeCanvas(): () => void {
  const g = globalThis as { OffscreenCanvas?: unknown };
  const prev = g.OffscreenCanvas;
  g.OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return new Proxy({}, { get: () => () => undefined, set: () => true });
    }
  };
  return () => {
    g.OffscreenCanvas = prev;
  };
}
