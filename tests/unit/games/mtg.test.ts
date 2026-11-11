/**
 * M0-P6 acceptance: the Magic game definition (DESIGN "Table model", "Players, seats and formats", "The effect stack",
 * "Turn flow and confirmation", "Themes and rendering", "Specification: code interfaces").
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CardInstance, StackItem, ZoneSpec } from '../../../src/core/types';
import { parseZoneId } from '../../../src/core/ids';
import type { Canvas2D } from '../../../src/util/texture';
import { MTG_KEYMAP, mtg } from '../../../src/games/mtg/index';

describe('zones (DESIGN "Table model")', () => {
  const byId = new Map(mtg.zones.map((z) => [z.id, z]));
  const z = (id: string): ZoneSpec => {
    const spec = byId.get(id);
    if (!spec) throw new Error(`missing zone ${id}`);
    return spec;
  };

  it('declares each zone of the Table model exactly once', () => {
    expect(mtg.zones.map((x) => x.id).sort()).toEqual(['battlefield', 'command', 'exile', 'graveyard', 'hand', 'library', 'pack', 'sideboard', 'stack'].sort());
  });

  it.each([
    // id, scope, visibility, ordered, presentation
    ['library', 'seat', 'nobody', true, 'squared'],
    ['hand', 'seat', 'owner', false, 'fan'],
    ['battlefield', 'seat', 'public', false, 'free'],
    ['graveyard', 'seat', 'public', true, 'squared'],
    ['exile', 'seat', 'public', false, 'squared'],
    ['stack', 'table', 'public', true, 'cascade-lane'],
    ['command', 'seat', 'public', false, 'area'],
    ['sideboard', 'seat', 'owner', false, 'hidden'],
    ['pack', 'seat', 'owner', false, 'fan'],
  ] as const)('%s: scope %s, visible to %s, ordered %s, drawn as %s', (id, scope, visibility, ordered, presentation) => {
    expect(z(id)).toMatchObject({ id, scope, visibility, ordered, presentation });
    expect(z(id).label.length).toBeGreaterThan(0);
  });

  it('zone kinds are valid zone-id kinds (no separator inside)', () => {
    for (const spec of mtg.zones) expect(parseZoneId(spec.id)).toEqual({ kind: spec.id, seat: null });
  });

  it('only the library hides its contents from its owner', () => {
    expect(mtg.zones.filter((x) => x.visibility === 'nobody').map((x) => x.id)).toEqual(['library']);
  });
});

describe('phases (DESIGN "Turn flow and confirmation": seven steps)', () => {
  it('lists untap, upkeep, draw, main 1, combat, main 2, end in order', () => {
    expect(mtg.phases.map((p) => p.label)).toEqual(['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End']);
    expect(mtg.phases.map((p) => p.id)).toEqual(['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end']);
  });
  it('phase ids are unique', () => {
    expect(new Set(mtg.phases.map((p) => p.id)).size).toBe(mtg.phases.length);
  });
});

describe('starting life (DESIGN "Players, seats and formats")', () => {
  it.each([
    ['1v1', 20],
    ['ffa3', 20],
    ['ffa4', 20],
    ['2hg', 30],
  ] as const)('%s starts at %i', (format, life) => {
    expect(mtg.startingLife(format)).toBe(life);
  });
});

describe('identity and keymap', () => {
  it("is the 'mtg' definition and uses the canonical keymap", () => {
    expect(mtg.id).toBe('mtg');
    expect(mtg.keymap).toBe(MTG_KEYMAP);
    expect(mtg.keymap.length).toBeGreaterThan(0);
  });
});

describe('defaultDestination (DESIGN "The effect stack", Resolving)', () => {
  const spell = (controller = 's1'): StackItem => ({ id: 'st1', kind: 'spell', controller, card: 'c1' });
  const inst = (owner: string, controller = owner): CardInstance => ({
    id: 'c1',
    owner,
    controller,
    zone: 'stack',
    identity: { sid: 'x' },
    face: 'up',
    faceIndex: 0,
    tapped: false,
    pose: { x: 0, y: 0, rot: 0 },
    counters: {},
  });

  // Spell controlled by s1, card owned by s0 (e.g. cast from a stolen card): permanents go to s1's battlefield,
  // instants and sorceries to s0's graveyard.
  it.each([
    ['Creature — Elf Druid', 'battlefield:s1'],
    ['Legendary Creature — Elder Dragon', 'battlefield:s1'],
    ['Artifact — Equipment', 'battlefield:s1'],
    ['Artifact Creature — Golem', 'battlefield:s1'],
    ['Enchantment — Aura', 'battlefield:s1'],
    ['Enchantment — Saga', 'battlefield:s1'],
    ['Basic Land — Forest', 'battlefield:s1'],
    ['Land', 'battlefield:s1'],
    ['Legendary Planeswalker — Ajani', 'battlefield:s1'],
    ['Battle — Siege', 'battlefield:s1'],
    ['Kindred Artifact — Goblin', 'battlefield:s1'],
    ['Instant', 'graveyard:s0'],
    ['Instant — Arcane', 'graveyard:s0'],
    ['Sorcery', 'graveyard:s0'],
    ['Tribal Sorcery — Elf', 'graveyard:s0'],
    ['Kindred Instant — Faerie', 'graveyard:s0'],
    ['Legendary Sorcery', 'graveyard:s0'],
    // Double-faced and split cards: the front face is what was cast.
    ['Legendary Creature — Human Cleric // Legendary Planeswalker — Liliana', 'battlefield:s1'],
    ['Instant // Land', 'graveyard:s0'],
    ['Sorcery // Sorcery', 'graveyard:s0'],
    ['Creature — Elf Knight // Sorcery — Adventure', 'battlefield:s1'],
    // Case and spacing do not matter.
    ['  instant  ', 'graveyard:s0'],
  ])('a spell with type line %j goes to %s', (typeLine, dest) => {
    expect(mtg.defaultDestination(spell('s1'), { type_line: typeLine }, inst('s0', 's1'))).toBe(dest);
  });

  it.each(['ability', 'trigger', 'copy'] as const)('a %s marker vanishes (null)', (kind) => {
    const item: StackItem = { id: 'm1', kind, controller: 's0', source: 'c9' };
    expect(mtg.defaultDestination(item)).toBeNull();
    expect(mtg.defaultDestination(item, { type_line: 'Creature — Bear' }, inst('s0'))).toBeNull();
  });

  it('a copy marker of an instant still vanishes', () => {
    expect(mtg.defaultDestination({ id: 'm2', kind: 'copy', controller: 's0', copyOf: 'st1' }, { type_line: 'Instant' })).toBeNull();
  });

  it("without the card instance, an instant goes to the controller's graveyard", () => {
    expect(mtg.defaultDestination(spell('s1'), { type_line: 'Instant' })).toBe('graveyard:s1');
  });

  it("without card data (identity not yet known), a spell defaults to the controller's battlefield", () => {
    expect(mtg.defaultDestination(spell('s1'), undefined, inst('s0', 's1'))).toBe('battlefield:s1');
  });

  it('a spell item without a card has nothing to move (null)', () => {
    expect(mtg.defaultDestination({ id: 'x', kind: 'spell', controller: 's0' }, { type_line: 'Creature' })).toBeNull();
  });

  it('destinations are zones the definition declares, with the seat suffix', () => {
    const kinds = new Set(mtg.zones.map((x) => x.id));
    for (const t of ['Creature', 'Instant']) {
      const d = mtg.defaultDestination(spell('s0'), { type_line: t }, inst('s0'));
      expect(d).not.toBeNull();
      const { kind, seat } = parseZoneId(d as string);
      expect(kinds.has(kind)).toBe(true);
      expect(seat).toBe('s0');
    }
  });
});

/** A 2D context that records every call and property write; it has no image support at all. */
function recordingContext(): { ctx: Canvas2D; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const gradient = { addColorStop: (...args: unknown[]) => calls.push({ name: 'gradient.addColorStop', args }) };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') return gradient;
        if (prop === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(t, prop, value) {
      if (typeof prop === 'string') {
        calls.push({ name: `set ${prop}`, args: [value] });
        t[prop] = value;
      }
      return true;
    },
  });
  return { ctx: ctx as unknown as Canvas2D, calls };
}

describe('card back (DESIGN "Themes and rendering": neutral back, nothing bundled)', () => {
  it('is a card-shaped procedural texture (63 x 88 aspect)', () => {
    expect(mtg.cardBack.id.length).toBeGreaterThan(0);
    expect(mtg.cardBack.width / mtg.cardBack.height).toBeCloseTo(63 / 88, 2);
  });

  it('draws with canvas primitives only: no images, patterns or network', () => {
    const { ctx, calls } = recordingContext();
    mtg.cardBack.draw(ctx, mtg.cardBack.width, mtg.cardBack.height);
    expect(calls.length).toBeGreaterThan(10);
    const names = new Set(calls.map((c) => c.name));
    for (const banned of ['drawImage', 'createPattern', 'putImageData', 'getImageData', 'createImageData']) expect(names.has(banned)).toBe(false);
  });

  it('first covers the whole area, so no transparent corners remain', () => {
    const { ctx, calls } = recordingContext();
    mtg.cardBack.draw(ctx, 200, 280);
    const firstPaint = calls.find((c) => c.name === 'fillRect' || c.name === 'fill');
    expect(firstPaint).toEqual({ name: 'fillRect', args: [0, 0, 200, 280] });
  });

  it('carries no Wizards marks or game name in any text it writes', () => {
    const { ctx, calls } = recordingContext();
    mtg.cardBack.draw(ctx, 488, 680);
    for (const c of calls.filter((x) => x.name === 'fillText' || x.name === 'strokeText')) {
      expect(String(c.args[0])).not.toMatch(/magic|gathering|wizards|deckmaster|coast/i);
    }
  });

  it('is deterministic: the same size draws the same picture', () => {
    const a = recordingContext();
    const b = recordingContext();
    mtg.cardBack.draw(a.ctx, 488, 680);
    mtg.cardBack.draw(b.ctx, 488, 680);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
  });

  it('scales to the requested size (everything stays within it)', () => {
    for (const [w, h] of [
      [146, 204],
      [672, 936],
    ] as const) {
      const { ctx, calls } = recordingContext();
      mtg.cardBack.draw(ctx, w, h);
      for (const c of calls.filter((x) => ['moveTo', 'lineTo', 'arc', 'arcTo', 'fillRect', 'strokeRect', 'rect', 'roundRect'].includes(x.name))) {
        const [x, y] = c.args as [number, number];
        expect(x, `${c.name} x`).toBeGreaterThanOrEqual(-1e-9);
        expect(x, `${c.name} x`).toBeLessThanOrEqual(w + 1e-9);
        expect(y, `${c.name} y`).toBeGreaterThanOrEqual(-1e-9);
        expect(y, `${c.name} y`).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });

  it('no image asset is bundled in or referenced by games/', () => {
    const root = join(__dirname, '../../../src/games');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(root);
    for (const f of files) {
      expect(f).toMatch(/\.ts$/);
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\.(png|jpe?g|webp|gif|svg|avif)\b/i);
      expect(src, f).not.toMatch(/new Image\(|drawImage|createImageBitmap|fetch\(|backs\.scryfall/);
    }
  });
});
