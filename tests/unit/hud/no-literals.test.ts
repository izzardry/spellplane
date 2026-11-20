/**
 * PLAN Milestone 8, M7-P2 acceptance (chunk P2-2): the HUD is built only from the kit's variables. No colour literal
 * (#rgb, rgb(, hsl() and no font family other than a --ds-* variable in the style blocks of the HUD's files, and no
 * blur or backdrop-filter anywhere in them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const OWNED = [
  'src/ui/Hud.svelte',
  'src/ui/TurnStrip.svelte',
  'src/ui/Avatar.svelte',
  'src/ui/LogPanel.svelte',
  ...fs
    .readdirSync(path.join(ROOT, 'src/ui/hud'))
    .filter((f) => f.endsWith('.svelte') || f.endsWith('.css'))
    .map((f) => `src/ui/hud/${f}`),
];

function styles(file: string): string {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (file.endsWith('.css')) return text;
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

export function literals(css: string): string[] {
  const out: string[] = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of noComments.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)) out.push(m[0]);
  for (const m of noComments.matchAll(/font-family\s*:\s*([^;]+);/g)) if (!/^var\(--ds-/.test(m[1]!.trim()) && m[1]!.trim() !== 'inherit') out.push(m[0]);
  for (const m of noComments.matchAll(/(?:^|[\s;{])font\s*:\s*([^;]+);/g)) {
    const rest = m[1]!.replace(/var\([^)]*\)/g, '').replace(/\d+(\.\d+)?(px|em|rem|%)?/g, '');
    const words = (rest.match(/[a-zA-Z-]{3,}/g) ?? []).filter((w) => !['inherit', 'normal', 'bold', 'italic'].includes(w));
    if (words.length) out.push(m[0].trim());
  }
  return out;
}

describe('HUD style blocks use only kit variables', () => {
  it('the scanner finds what it must', () => {
    expect(literals('a { color: #fff; background: rgb(1,2,3); border-color: hsl(1 2% 3%); font-family: Georgia; }')).toHaveLength(4);
    expect(literals('a { color: var(--ds-ink); font-family: var(--ds-font-body); font: inherit; }')).toEqual([]);
    expect(literals('a { font: var(--ds-type-small) / 1.4 var(--ds-font-body); }')).toEqual([]);
    expect(literals('a { font: 12px / 1.4 system-ui; }')).toHaveLength(1);
  });
  for (const file of OWNED) {
    it(`${file} has no colour or font literal`, () => {
      expect(literals(styles(file))).toEqual([]);
    });
    it(`${file} has no blur and no backdrop-filter`, () => {
      expect(styles(file)).not.toMatch(/backdrop-filter|blur\(/);
    });
  }
});
