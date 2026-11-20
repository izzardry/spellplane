/** The invite sheet's QR code (matchmaking.md 2.12: the whole link, error correction M; null when too long). M8-P4. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { qrMatrix } from '../../../src/ui/qr';

const fixture = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'qr', 'link-matrix.json'), 'utf8')) as { link: string; rows: string[] };

describe('qrMatrix', () => {
  it('encodes a fixed link to the recorded matrix', async () => {
    const m = await qrMatrix(fixture.link);
    expect(m?.map((r) => r.map((d) => (d ? '1' : '0')).join(''))).toEqual(fixture.rows);
  });
  it('a table link fits in at most 45 modules', async () => {
    const m = await qrMatrix(`https://izzardry.example.github.io/spellplane/#/t/juniper-kestrel-lantern-42/${'A'.repeat(22)}`);
    expect(m!.length).toBeLessThanOrEqual(45);
  });
  it('returns null for a text longer than any QR code holds', async () => {
    expect(await qrMatrix('x'.repeat(4000))).toBeNull();
  });
});
