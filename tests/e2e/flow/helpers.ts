/** Browser-test helpers of the evening flow: the recorded MTGJSON booster data, injected before the page loads. */
import fs from 'node:fs';
import path from 'node:path';
import type { SetData } from '../../../src/data/types';

let script: string | null = null;

/** An init script that sets window.__spellplaneSets to the recorded booster data of `codes` (main.ts then never fetches MTGJSON). */
export function setsScript(codes: readonly string[] = ['M19']): string {
  if (script === null || codes.join() !== 'M19') {
    const sets: SetData[] = codes.map((code) => {
      const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mtgjson', `${code}.json`), 'utf8')) as { data: { code: string; name: string; releaseDate: string; booster: Record<string, SetData['booster']>; cards: SetData['cards'] } };
      const d = raw.data;
      return { code: d.code, name: d.name, releaseDate: d.releaseDate, boosterType: 'draft', booster: d.booster.draft!, cards: d.cards };
    });
    const out = `window.__spellplaneSets = ${JSON.stringify(sets)};`;
    if (codes.join() === 'M19') script = out;
    return out;
  }
  return script;
}
