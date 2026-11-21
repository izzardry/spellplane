/**
 * Nothing styled ad hoc (docs/design/m8/visual.md V11, DS-4; PLAN M8-P1): no `backdrop-filter` and no CSS `blur(`
 * anywhere under src/ (Safari: a blur over the WebGL canvas is a measured cost; the arena still is softened on a 2D
 * canvas by pixel loops), and no raw `<button` without a kit class under src/ui/ outside the legacy files that are
 * swept later. Comments are not scanned for the blur rule (they may name it to forbid it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|svelte|css|js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

/** Source without comments (block, line and HTML comments), so a rule may be named in prose. */
export function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** CSS blur and backdrop filters in any spelling: `backdrop-filter`, `backdropFilter`, `blur(<number>`, a canvas `filter = 'blur`. */
export const BLUR = [/backdrop-filter/i, /backdropFilter/, /\bblur\(\s*[\d.$-]/i, /\bblur\(\s*var\(/i, /filter\s*[:=]\s*[`'"]?\s*blur/i];

describe('no blur under src/', () => {
  it('the patterns catch what they must and leave element.blur() alone', () => {
    const hit = (s: string) => BLUR.some((r) => r.test(stripComments(s)));
    expect(hit('.x { backdrop-filter: blur(8px); }')).toBe(true);
    expect(hit('el.style.backdropFilter = "x"')).toBe(true);
    expect(hit('.x { filter: blur(2px) }')).toBe(true);
    expect(hit("ctx.filter = 'blur(4px)'")).toBe(true);
    expect(hit('filter: blur(var(--r))')).toBe(true);
    expect(hit('input?.blur();')).toBe(false);
    expect(hit('/* no backdrop-filter here */ .x {}')).toBe(false);
  });

  it('no file under src/ uses a backdrop filter or a CSS blur', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const text = stripComments(fs.readFileSync(f, 'utf8'));
      for (const r of BLUR) if (r.test(text)) bad.push(`${rel(f)}: ${r}`);
    }
    expect(bad).toEqual([]);
  });
});

/**
 * The `<button …>` opening tags of a Svelte source, each up to the `>` that closes it: quoted values and `{…}`
 * expressions (which may hold `=>` or `>`) are skipped.
 */
export function buttonTags(text: string): string[] {
  const out: string[] = [];
  const re = /<button\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '{' && quote !== '`') depth++;
        continue;
      }
      if (depth > 0) {
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '"' || c === "'" || c === '`') quote = c;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    out.push(text.slice(m.index, i + 1));
    re.lastIndex = i;
  }
  return out;
}

/** The value of a tag's `class` attribute (`class="…"`, `class='…'` or `class={…}`), or null. Directives (`class:x`) are not it. */
export function classValue(tag: string): string | null {
  const at = /\sclass=/.exec(tag);
  if (!at) return null;
  let i = at.index + at[0].length;
  const open = tag[i];
  if (open === '"' || open === "'") {
    const close = tag.indexOf(open, i + 1);
    return tag.slice(i + 1, close < 0 ? undefined : close);
  }
  if (open !== '{') return null;
  let depth = 0;
  const from = i;
  for (; i < tag.length; i++) {
    if (tag[i] === '{') depth++;
    else if (tag[i] === '}' && --depth === 0) break;
  }
  return tag.slice(from, i + 1);
}

const KIT_TOKEN = /(?:^|[^\w-])ds-[a-z]/;

/**
 * Whether a `<button>` tag carries a kit class: its `class` value has a `ds-` token, or it is `{name}` (or holds
 * `{name}`) where `name` is assigned a value with a `ds-` token in the same file.
 */
export function hasKitClass(tag: string, file: string): boolean {
  const v = classValue(tag);
  if (v === null) return false;
  if (KIT_TOKEN.test(v)) return true;
  for (const m of v.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    const name = m[1]!.replace(/[$]/g, '\\$');
    if (new RegExp(`\\b${name}\\s*=[^;\\n]*(?:^|[^\\w-])ds-[a-z]`).test(file)) return true;
  }
  return false;
}

describe('no raw <button under src/ui/ without a kit class', () => {
  it('the scanner reads whole tags and only the class attribute', () => {
    const raw = (src: string) => buttonTags(src).filter((t) => !hasKitClass(t, src)).length;
    expect(raw('<button type="button" onclick={() => go()} class="ds-btn ds-btn--md">x</button>')).toBe(0);
    expect(raw('<button onclick={() => (a > b ? 1 : 2)} class="ds-btn">x</button>')).toBe(0);
    expect(raw('<button class="tile" data-ds-layer="x">x</button>')).toBe(1);
    expect(raw('<button class="tile" class:ds-x={a}>x</button>')).toBe(1);
    expect(raw('<button type="button">x</button>')).toBe(1);
    expect(raw('<button class="ids-btn">x</button>')).toBe(1);
    expect(raw('<button class="{cls} ds-chip--button">x</button>')).toBe(0);
    expect(raw("const cls = $derived(`ds-btn ds-btn--${v}`);\n<button class={cls}>x</button>")).toBe(0);
    expect(raw('const cls = "tile";\n<button class={cls}>x</button>')).toBe(1);
    expect(raw('<button\n  type="button"\n  class="ds-seg__opt"\n  onclick={() => pick(o.value)}>x</button>')).toBe(0);
    expect(raw('<button class={[\'ds-btn\', on && \'is-on\']}>x</button>')).toBe(0);
    expect(buttonTags('<button onclick={() => f(">")} class="ds-btn">x</button>')).toEqual(['<button onclick={() => f(">")} class="ds-btn">']);
  });

  const files = walk(path.join(SRC, 'ui')).filter((f) => f.endsWith('.svelte'));
  const offenders = new Map<string, number>();
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, 'utf8'));
    const raw = buttonTags(text).filter((t) => !hasKitClass(t, text));
    if (raw.length) offenders.set(rel(f), raw.length);
  }

  it('every <button> in a new file carries a kit class', () => {
    const fresh = [...offenders.keys()].filter((f) => !LEGACY.has(f));
    expect(fresh).toEqual([]);
  });

  it('the kit itself has no raw button', () => {
    expect([...offenders.keys()].filter((f) => f.startsWith('src/ui/design/'))).toEqual([]);
  });
});

/**
 * Legacy files with raw buttons when M8-P1 landed the kit, swept by their owners (visual.md DS-9; contracts.md Part G
 * Visual 4). A plain allow-list: a swept file may stay listed (its owner cannot edit this file); M8-P8 or the gate
 * prunes it. It is not grown. Pruned by the M8-P1 fix round to the 18 files that still hold a raw button.
 */
const LEGACY = new Set<string>([
  'src/ui/about/About.svelte',
  'src/ui/builder/list/ListView.svelte',
  'src/ui/diag/Diag.svelte',
  'src/ui/empty/EmptyState.svelte',
  'src/ui/flow/LobbyDraft.svelte',
  'src/ui/lobby/Lobby.svelte',
  'src/ui/lobby/SpectatorPanel.svelte',
  'src/ui/lobby/StartPage.svelte',
  'src/ui/settings/Keys.svelte',
  'src/ui/settings/Settings.svelte',
  'src/ui/settings/Speech.svelte',
  'src/ui/settings/Storage.svelte',
  'src/ui/settings/Theme.svelte',
  'src/ui/storage/Hints.svelte',
  'src/ui/storage/StoragePanel.svelte',
  'src/ui/version/VersionNotice.svelte',
  'src/ui/voice/TalkIndicator.svelte',
  'src/ui/voice/VoicePanel.svelte',
]);
