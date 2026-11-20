/**
 * A practice table's room id (journey.md 4.1 SOLO · ALONE, `#/p/<room>`): `p-` and twelve characters, the shape of a
 * computer room id and of `ui/play/launch.ts` newPracticeRoom (M8 gate: Home's PLAY made a ten-character id).
 */
import { describe, expect, it } from 'vitest';
import { newPracticeRoomId } from '../../../src/session/practice';

describe('newPracticeRoomId', () => {
  it('is p- and twelve lower-case letters or digits, different each time', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newPracticeRoomId()));
    for (const id of ids) expect(id).toMatch(/^p-[0-9a-z]{12}$/);
    expect(ids.size).toBe(20);
  });
});
