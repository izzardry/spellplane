/**
 * No panel rounds with the button radius (gate M8 finding F1; visual.md 2.3 "round buttons, 16 px sheets"). In Plain
 * the button radius is 9999 px, so a panel, card, popover or sheet that used `--ds-radius-md` (or its M4 alias
 * `--sp-radius-md`) drew as an ellipse and clipped its title, buttons and text. Panels use `--ds-radius-panel`,
 * `-card` or `-sheet`; `--ds-radius-md` is not used under src/ at all, and `--sp-radius-md` only on a button, an input
 * or a one-line chip of the legacy components.
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
    else if (/\.(svelte|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

/** Source without block and HTML comments, so a rule may be named in prose. */
const stripComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The selector of the CSS rule that holds position `at`: the text between the previous `}` (or `<style>`) and its `{`. */
export function selectorAt(css: string, at: number): string {
  const open = css.lastIndexOf('{', at);
  if (open < 0) return '';
  const close = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('>', open));
  return css.slice(close + 1, open).trim();
}

/** A selector that names a single-line control, where a pill radius is the design (visual.md 2.3). */
const CONTROL = /^(?:(?:button|input|textarea|\.chip)\b[^,{]*(?:,\s*|$))+$/;

describe('no panel rounds with the button radius', () => {
  it('selectorAt finds the rule around a declaration', () => {
    const css = '.a { color: red; }\n  .menu {\n    border-radius: var(--x);\n  }';
    expect(selectorAt(css, css.indexOf('border-radius'))).toBe('.menu');
    expect(CONTROL.test('button')).toBe(true);
    expect(CONTROL.test('input,\n  textarea')).toBe(true);
    expect(CONTROL.test('.menu')).toBe(false);
    expect(CONTROL.test('button, .menu')).toBe(false);
  });

  it('no file under src/ uses --ds-radius-md, and --sp-radius-md only on a control', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const text = stripComments(fs.readFileSync(f, 'utf8'));
      for (const m of text.matchAll(/--(ds|sp)-radius-md\b/g)) {
        const sel = selectorAt(text, m.index);
        if (m[1] === 'ds' || !CONTROL.test(sel)) bad.push(`${rel(f)}: ${sel} uses --${m[1]}-radius-md`);
      }
    }
    expect(bad).toEqual([]);
  });
});
