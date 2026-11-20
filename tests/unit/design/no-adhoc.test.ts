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

describe('no raw <button under src/ui/ without a kit class', () => {
  const files = walk(path.join(SRC, 'ui')).filter((f) => f.endsWith('.svelte'));
  const offenders = new Map<string, number>();
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, 'utf8'));
    const raw = [...text.matchAll(/<button\b[^>]*>/g)].filter((m) => !/class(=|:)[^>]*\bds-|class=\{?[^>]*`[^`]*ds-|\{cls\}|class=\{cls\}/.test(m[0]) && !/class=["'{][^"'}]*ds-/.test(m[0]));
    if (raw.length) offenders.set(rel(f), raw.length);
  }

  it('every <button> in a new file carries a kit class', () => {
    const fresh = [...offenders.keys()].filter((f) => !LEGACY.has(f));
    expect(fresh).toEqual([]);
  });

  it('the allow-list only shrinks: every listed file still exists and still has a raw button', () => {
    expect([...LEGACY].filter((f) => !offenders.has(f))).toEqual([]);
  });

  it('the kit itself has no raw button', () => {
    expect([...offenders.keys()].filter((f) => f.startsWith('src/ui/design/'))).toEqual([]);
  });
});

/**
 * Legacy files with raw buttons when M8-P1 landed the kit, swept by their owners (visual.md DS-9; contracts.md Part G
 * Visual 4). The list only shrinks: a file that no longer has a raw button fails the test until it is removed here.
 */
const LEGACY = new Set<string>(
  [
    "src/ui/Avatar.svelte",
    "src/ui/CheatSheet.svelte",
    "src/ui/ContextMenu.svelte",
    "src/ui/DeckImport.svelte",
    "src/ui/Hud.svelte",
    "src/ui/LogPanel.svelte",
    "src/ui/PileViewer.svelte",
    "src/ui/TokenSearch.svelte",
    "src/ui/TurnStrip.svelte",
    "src/ui/about/About.svelte",
    "src/ui/audit/AuditPanel.svelte",
    "src/ui/builder/Builder.svelte",
    "src/ui/builder/list/Library.svelte",
    "src/ui/builder/list/ListView.svelte",
    "src/ui/chat/FilterBar.svelte",
    "src/ui/confirm/ConfirmPrompt.svelte",
    "src/ui/diag/Diag.svelte",
    "src/ui/draft/Draft.svelte",
    "src/ui/empty/EmptyState.svelte",
    "src/ui/flow/EveningBar.svelte",
    "src/ui/flow/LobbyDraft.svelte",
    "src/ui/hints/Hint.svelte",
    "src/ui/lobby/Lobby.svelte",
    "src/ui/lobby/SpectatorPanel.svelte",
    "src/ui/lobby/StartPage.svelte",
    "src/ui/recovery/RecoveryPanel.svelte",
    "src/ui/settings/Keys.svelte",
    "src/ui/settings/Settings.svelte",
    "src/ui/settings/Speech.svelte",
    "src/ui/settings/Storage.svelte",
    "src/ui/settings/Theme.svelte",
    "src/ui/storage/Hints.svelte",
    "src/ui/storage/StoragePanel.svelte",
    "src/ui/touch/RadialMenu.svelte",
    "src/ui/touch/ThumbBar.svelte",
    "src/ui/version/VersionNotice.svelte",
    "src/ui/voice/TalkIndicator.svelte",
    "src/ui/voice/VoicePanel.svelte",
  ],
);
