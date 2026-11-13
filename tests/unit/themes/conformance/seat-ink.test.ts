// Text on a seat-coloured chip uses the theme's seat ink (DESIGN "Themes and rendering", Tokens: seat colours "tuned per
// theme for contrast", "Exposed to the HUD as CSS custom properties"; "Input and interaction design", Accessibility:
// "Paper meets WCAG AA contrast throughout"). themes.test.ts holds every `--sp-seat-<i>-ink` to 4.5:1 on its seat colour;
// this check holds the HUD's CSS to using it: a rule that paints a seat colour behind text sets that text in
// `var(--seat-ink)`, and every component that reads `--seat-ink` sets it from `--sp-seat-<i>-ink`. The browser check
// of the drawn colours is in tests/e2e/signals.spec.ts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function svelteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? svelteFiles(p) : e.name.endsWith('.svelte') ? [p] : [];
  });
}

/** The innermost `{ … }` blocks of a stylesheet (rules and keyframe steps) with their selectors. */
function cssBlocks(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) out.push({ selector: m[1]!.trim(), body: m[2]! });
  return out;
}

function declarations(body: string): Map<string, string> {
  const d = new Map<string, string>();
  for (const part of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) d.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return d;
}

/** Rules that paint a seat colour behind text but set the text in something other than the seat ink. */
function seatTextViolations(css: string): string[] {
  const bad: string[] = [];
  for (const { selector, body } of cssBlocks(css)) {
    const d = declarations(body);
    const bg = d.get('background') ?? d.get('background-color');
    const colour = d.get('color');
    if (bg === undefined || colour === undefined || !/^var\(--seat[,)]/.test(bg)) continue;
    if (!/^var\(--seat-ink[,)]/.test(colour)) bad.push(`${selector} { background: ${bg}; color: ${colour} }`);
  }
  return bad;
}

const files = svelteFiles(path.join('src', 'ui'));

describe('seat ink in the HUD', () => {
  it('the scanner finds a violation and accepts the seat ink', () => {
    expect(seatTextViolations('.a { background: var(--seat); color: var(--sp-surface, #fff); }')).toHaveLength(1);
    expect(seatTextViolations('@keyframes k { to { background: var(--seat); color: #fff; } }')).toHaveLength(1);
    expect(seatTextViolations('.a { background: var(--seat); color: var(--seat-ink); }')).toEqual([]);
    expect(seatTextViolations('.a { background: var(--seat-ink, #fff); }')).toEqual([]);
  });

  it.each(files)('%s: text on a seat colour is in the seat ink', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(src)?.[1] ?? '';
    expect(seatTextViolations(css)).toEqual([]);
    if (/var\(--seat-ink[,)]/.test(css)) {
      // Whoever reads the ink sets it from the theme's per-seat ink token, next to where it sets `--seat`.
      expect(src, `${file} sets --seat-ink`).toMatch(/(style:--seat-ink=|--seat-ink:\s*)[^\n]*--sp-seat-[^\n]*-ink/);
    }
  });

  it('the components that put text on a seat colour are covered', () => {
    const users = files.filter((f) => /var\(--seat-ink[,)]/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(path.join('src', 'ui'), f).split(path.sep).join('/'));
    expect(users).toEqual(expect.arrayContaining(['Avatar.svelte', 'chat/Flashes.svelte', 'lobby/Lobby.svelte']));
  });
});
