// Face loading per texture tier, DESIGN "Specification: geometry, layout and motion" (Texture tiers: 146x204,
// 488x680, 672x936) and "Camera and navigation" (Level of detail): each tier asks the FaceSource for its own image.
import { describe, expect, it } from 'vitest';
import type { CardRef } from '../../../src/core/types';
import type { FaceSource, ImageTier } from '../../../src/data/types';
import { FaceLoader } from '../../../src/scene/faces';

describe('face loader', () => {
  it('requests and decodes the image of the job\'s tier', async () => {
    const asked: ImageTier[] = [];
    const decoded: string[] = [];
    const source: FaceSource = {
      faceFor(ref: CardRef, faceIndex: 0 | 1, tier: ImageTier) {
        asked.push(tier);
        return Promise.resolve({ kind: 'url', url: `https://img.invalid/${tier}/${ref.sid}/${faceIndex}.jpg` });
      },
    };
    const back = { id: 'test-back', width: 4, height: 4, draw() {} };
    const loader = new FaceLoader(source, back, (url) => {
      decoded.push(url);
      return Promise.resolve({} as CanvasImageSource);
    });
    const key = loader.register({ sid: 'abc' }, 0);
    await loader.load(key, 'small');
    await loader.load(key, 'large');
    await loader.load(key, 'normal');
    expect(asked).toEqual(['small', 'large', 'normal']);
    expect(decoded).toEqual(['https://img.invalid/small/abc/0.jpg', 'https://img.invalid/large/abc/0.jpg', 'https://img.invalid/normal/abc/0.jpg']);
  });
});
