// The asset licence manifest (PLAN M4-P6: asset licence manifest; M4-P3 to P5: "every asset is listed in
// docs/ASSETS.md with a CC0 source or is procedural"; DESIGN "Themes and rendering", Assets: CC0 physically based
// materials, effects as shaders, no Wizards artwork, logos or official card back). The check reads docs/ASSETS.md in
// the format the file itself describes and compares it with the files the app bundles.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_IDS, THEME_LABELS } from '../../../../src/themes/index';

const ROOT = path.resolve(__dirname, '../../../..');
const MANIFEST = path.join(ROOT, 'docs', 'ASSETS.md');

/** File types that are assets rather than code (textures, models, sounds, fonts). */
export const ASSET_EXTENSIONS = /\.(png|jpe?g|webp|avif|gif|ktx2|basis|hdr|exr|dds|glb|gltf|bin|mp3|ogg|opus|wav|m4a|flac|ttf|otf|woff2?)$/i;

export interface AssetRow {
  section: string;
  asset: string;
  usedBy: string;
  kind: string;
  source: string;
  licence: string;
  notes: string;
  line: number;
}

/** The rows of every table in the manifest, with the `## ` section they are in. */
export function parseManifest(text: string): { sections: string[]; rows: AssetRow[]; problems: string[] } {
  const sections: string[] = [];
  const rows: AssetRow[] = [];
  const problems: string[] = [];
  let section = '';
  let header: string[] | null = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      sections.push(section);
      header = null;
      return;
    }
    if (!line.startsWith('|')) {
      header = null;
      return;
    }
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (header === null) {
      header = cells;
      const want = ['Asset', 'Used by', 'Kind', 'Source', 'Licence', 'Notes'];
      if (cells.join('|') !== want.join('|')) problems.push(`line ${i + 1}: table header must be | ${want.join(' | ')} |`);
      return;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) return;
    if (cells.length !== 6) {
      problems.push(`line ${i + 1}: a row needs 6 cells, found ${cells.length}`);
      return;
    }
    const [asset, usedBy, kind, source, licence, notes] = cells as [string, string, string, string, string, string];
    rows.push({ section, asset, usedBy, kind, source, licence, notes, line: i + 1 });
  });
  return { sections, rows, problems };
}

/** Repository paths of the files the app can bundle or serve (src/ and public/), asset types only. */
function bundledAssets(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (ASSET_EXTENSIONS.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'public'));
  return out.sort();
}

const pathOf = (cell: string): string => cell.replace(/^`|`$/g, '');
const KINDS = ['texture', 'model', 'sound', 'font', 'shader', 'environment'];

describe('docs/ASSETS.md', () => {
  const { sections, rows, problems } = parseManifest(fs.readFileSync(MANIFEST, 'utf8'));

  it('has one section for shared assets and one per theme', () => {
    expect(sections).toEqual(expect.arrayContaining(['Shared', ...THEME_IDS.map((id) => THEME_LABELS[id])]));
    expect(new Set(sections).size).toBe(sections.length);
  });

  it('keeps the table format: the six columns in order, six cells a row', () => {
    expect(problems).toEqual([]);
  });

  it('lists every asset file the app bundles', () => {
    const listed = new Set(rows.map((r) => pathOf(r.asset)));
    expect(bundledAssets().filter((f) => !listed.has(f))).toEqual([]);
  });

  it('names files that exist, with a kind, a source and a licence', () => {
    for (const r of rows) {
      const at = `docs/ASSETS.md line ${r.line}`;
      expect(r.asset, at).toMatch(/^`[^`]+`$/);
      expect(fs.existsSync(path.join(ROOT, pathOf(r.asset))), `${at}: ${r.asset} does not exist`).toBe(true);
      expect(r.usedBy, at).not.toBe('');
      expect(KINDS, `${at}: kind ${r.kind}`).toContain(r.kind);
      expect(r.source === 'procedural' || /^https:\/\/\S+$/.test(r.source), `${at}: source must be an https URL or "procedural"`).toBe(true);
      expect(r.licence, at).not.toBe('');
    }
  });

  it('theme assets are CC0 or procedural (PLAN M4-P3 to P5)', () => {
    const themeSections = new Set(THEME_IDS.map((id) => THEME_LABELS[id]));
    for (const r of rows.filter((x) => themeSections.has(x.section))) {
      const ok = r.source === 'procedural' || /^CC0(-1\.0)?\b/.test(r.licence);
      expect(ok, `docs/ASSETS.md line ${r.line}: ${r.asset} is ${r.licence} from ${r.source}`).toBe(true);
    }
  });

  it('procedural rows point at the module that generates them', () => {
    for (const r of rows.filter((x) => x.source === 'procedural')) expect(pathOf(r.asset), `docs/ASSETS.md line ${r.line}`).toMatch(/\.(ts|glsl|wgsl|frag|vert)$/);
  });
});

describe('manifest parser', () => {
  it('reads rows by section and reports malformed tables', () => {
    const md = [
      '## Dusk',
      '',
      '| Asset | Used by | Kind | Source | Licence | Notes |',
      '| --- | --- | --- | --- | --- | --- |',
      '| `src/themes/dusk/felt.ts` | Dusk table | shader | procedural | MIT (this repository) | felt noise |',
      '| `a.png` | Dusk | texture | https://polyhaven.com/a/x |',
      '',
      '## Wyrm',
      '| Asset | Kind |',
    ].join('\n');
    const m = parseManifest(md);
    expect(m.sections).toEqual(['Dusk', 'Wyrm']);
    expect(m.rows).toMatchObject([{ section: 'Dusk', asset: '`src/themes/dusk/felt.ts`', kind: 'shader', source: 'procedural' }]);
    expect(m.problems).toEqual(['line 6: a row needs 6 cells, found 4', 'line 9: table header must be | Asset | Used by | Kind | Source | Licence | Notes |']);
  });
});
