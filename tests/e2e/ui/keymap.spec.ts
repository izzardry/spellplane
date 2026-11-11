/**
 * PLAN M0-P4 acceptance in the browser: every action in the canonical keymap dispatches the right action on the
 * hovered card (real pointer hover, real key events); no key fires while the chat or a note field has focus; the cheat
 * sheet lists every bound key. Runs on the `?harness=ui` page (fake session and fake scene).
 */
import { expect, test, type Page } from '@playwright/test';
import { MTG_KEYMAP, chordToString } from '../../../src/games/mtg/keymap';
import type { ActionId } from '../../../src/games/types';
import { drafts, hoverCard, hoverNothing, openHud, pwKey, ui } from './harness';

type Check = (page: Page) => Promise<void>;

const promptByBen = () =>
  window.__uiHarness!.update((s) => {
    s.confirm = { id: 'r9', askedBy: 's1', durationMs: 60000, startSeq: 0, responses: {} };
  });
const spellOnStack = () =>
  window.__uiHarness!.update((s) => {
    s.stack = [{ id: 'si9', kind: 'spell', controller: 's0', card: 'bf1' }];
  });

const first = async (page: Page) => (await drafts(page))[0];
const expectDraft = (want: Record<string, unknown>): Check => async (page) => expect.poll(() => first(page)).toMatchObject(want);
const expectCall = (method: string, args?: unknown[]): Check => async (page) =>
  expect.poll(() => ui<{ method: string; args: unknown[] }[]>(page, 'calls')).toContainEqual(args ? { method, args } : expect.objectContaining({ method }));
const expectScene = (method: string, args: unknown[]): Check => async (page) => expect.poll(() => ui<{ method: string; args: unknown[] }[]>(page, 'scene')).toContainEqual({ method, args });

interface Scenario {
  hover?: string;
  setup?: () => void;
  seats?: string[];
  hold?: { during: Check; after: Check };
  check?: Check;
}

const S: Record<ActionId, Scenario> = {
  tap: { hover: 'bf1', check: expectDraft({ type: 'tap', card: 'bf1', tapped: true }) },
  flip: { hover: 'bf1', check: expectDraft({ type: 'flip', card: 'bf1', face: 'down' }) },
  transform: { hover: 'dfc', check: expectDraft({ type: 'transform', card: 'dfc', faceIndex: 1 }) },
  rotate180: { hover: 'bf1', check: expectDraft({ type: 'rotate', card: 'bf1', delta: 180 }) },
  counterAdd: { hover: 'bf1', check: expectDraft({ type: 'counter', card: 'bf1', kind: '+1/+1', delta: 1 }) },
  counterRemove: {
    hover: 'bf1',
    setup: () =>
      window.__uiHarness!.update((s) => {
        s.cards.bf1!.counters = { '+1/+1': 2 };
      }),
    check: expectDraft({ type: 'counter', card: 'bf1', kind: '+1/+1', delta: -1 }),
  },
  note: {
    hover: 'bf1',
    check: async (page) => {
      await expect(page.getByTestId('note-input')).toBeFocused();
    },
  },
  copy: { hover: 'bf1', check: expectDraft({ type: 'copy', of: 'bf1' }) },
  revealTo: {
    hover: 'h1',
    check: async (page) => {
      await page.getByTestId('reveal-to').getByRole('button', { name: 'Ben' }).click();
      await expect.poll(() => first(page)).toMatchObject({ type: 'revealTo', instanceId: 'h1', seats: ['s1'] });
    },
  },
  peek: {
    hover: 'fd1',
    check: async (page) => {
      await expect.poll(() => first(page)).toMatchObject({ type: 'lookAt', card: 'fd1', count: 1 });
      await expect(page.getByTestId('inspect')).toBeVisible();
    },
  },
  ping: { hover: 'bf1', check: expectDraft({ type: 'ping', target: { kind: 'card', id: 'bf1' } }) },
  zoomTo: { hover: 'bf1', check: expectScene('camera.zoomTo', ['bf1']) },
  inspect: {
    hover: 'dfc',
    hold: {
      during: async (page) => {
        await expect(page.getByTestId('inspect')).toBeVisible();
        await expect(page.getByTestId('inspect-face')).toHaveCount(2);
        await expect(page.getByTestId('inspect-text')).toContainText('Sun Sage');
      },
      after: async (page) => {
        await expect(page.getByTestId('inspect')).toHaveCount(0);
      },
    },
  },
  toGraveyard: { hover: 'bf1', check: expectDraft({ type: 'move', card: 'bf1', to: 'graveyard:s0' }) },
  toExile: { hover: 'bf1', check: expectDraft({ type: 'move', card: 'bf1', to: 'exile:s0' }) },
  toHand: { hover: 'bf1', check: expectDraft({ type: 'toZone', card: 'bf1', to: 'hand:s0', position: 'any' }) },
  toLibraryTop: { hover: 'bf1', check: expectDraft({ type: 'toZone', card: 'bf1', to: 'library:s0', position: 'top' }) },
  toLibraryBottom: { hover: 'bf1', check: expectDraft({ type: 'toZone', card: 'bf1', to: 'library:s0', position: 'bottom' }) },
  cast: { hover: 'h1', check: expectDraft({ type: 'stackPush', kind: 'spell', card: 'h1' }) },
  draw: { check: expectCall('draw', [1]) },
  drawN: {
    check: async (page) => {
      await expect(page.getByTestId('draw-n-input')).toBeFocused();
      await page.getByTestId('draw-n-input').fill('3');
      await page.keyboard.press('Enter');
      await expectCall('draw', [3])(page);
    },
  },
  shuffle: { check: expectCall('shuffle', []) },
  mulligan: { check: expectCall('mulligan', []) },
  attack: { hover: 'bf1', check: expectDraft({ type: 'moveTemp', card: 'bf1', pose: { x: -300, y: -150, rot: 0 }, combat: 'attack', tap: true }) },
  attackNoTap: { hover: 'bf1', check: expectDraft({ type: 'moveTemp', card: 'bf1', combat: 'attack', tap: false }) },
  settle: { check: expectDraft({ type: 'settle' }) },
  ability: { hover: 'bf1', check: expectDraft({ type: 'stackPush', kind: 'ability', source: 'bf1' }) },
  resolve: { setup: spellOnStack, check: expectDraft({ type: 'stackResolve', item: 'si9' }) },
  counterTop: { setup: spellOnStack, check: expectDraft({ type: 'stackCounter', item: 'si9' }) },
  nextPhase: { check: expectDraft({ type: 'phaseSet', phase: 'combat' }) },
  nextTurn: { check: expectDraft({ type: 'turnPass', to: 's1' }) },
  untapAll: { check: expectDraft({ type: 'tap', card: 'bf2', tapped: false }) },
  autoPass: { check: expectDraft({ type: 'autoPass', on: true }) },
  ask: { check: expectDraft({ type: 'ask' }) },
  confirmOk: { hover: 'bf1', setup: promptByBen, check: expectDraft({ type: 'respond', round: 'r9', seat: 's0', response: 'ok' }) },
  confirmHold: { hover: 'bf1', setup: promptByBen, check: expectDraft({ type: 'respond', round: 'r9', seat: 's0', response: 'hold' }) },
  tidy: { check: expectDraft({ type: 'tidy', seat: 's0' }) },
  token: {
    hover: 'bf2',
    check: async (page) => {
      await expect(page.getByTestId('token-query')).toBeFocused();
      await expect(page.getByTestId('token-result').first()).toHaveText(/Sprout/);
    },
  },
  rollDie: { check: expectDraft({ type: 'rngCommit', purpose: 'die', n: 6 }) },
  flipCoin: { check: expectDraft({ type: 'rngCommit', purpose: 'coin', n: 2 }) },
  undo: { check: expectCall('undo', []) },
  talk: {
    hold: {
      during: async (page) => expect.poll(() => ui(page, 'voice')).toEqual([{ action: 'talk', phase: 'start' }]),
      after: async (page) => expect.poll(() => ui(page, 'voice')).toEqual([{ action: 'talk', phase: 'start' }, { action: 'talk', phase: 'end' }]),
    },
  },
  teamTalk: {
    hold: {
      during: async (page) => expect.poll(() => ui(page, 'voice')).toEqual([{ action: 'teamTalk', phase: 'start' }]),
      after: async (page) => expect.poll(() => ui<unknown[]>(page, 'voice')).toContainEqual({ action: 'teamTalk', phase: 'end' }),
    },
  },
  mute: { check: async (page) => expect.poll(() => ui(page, 'voice')).toEqual([{ action: 'mute', phase: 'start' }]) },
  focusChat: { check: async (page) => expect(page.getByTestId('chat-input')).toBeFocused() },
  perspective: { check: expectScene('camera.setRig', ['ego']) },
  fitTable: { check: expectScene('camera.fit', [true]) },
  seat1: { check: expectScene('camera.goToSeat', ['s0']) },
  seat2: { check: expectScene('camera.goToSeat', ['s1']) },
  seat3: { seats: ['Anna', 'Ben', 'Cleo'], check: expectScene('camera.goToSeat', ['s2']) },
  seat4: { seats: ['Anna', 'Ben', 'Cleo', 'Dag'], check: expectScene('camera.goToSeat', ['s3']) },
  ownSide: { check: expectScene('camera.goToSeat', ['s0']) },
  help: { check: async (page) => expect(page.getByTestId('cheat-sheet')).toBeVisible() },
};

test.describe('canonical keymap in the browser (PLAN M0-P4)', () => {
  test('a scenario exists for every action', () => {
    expect(new Set(MTG_KEYMAP.map((b) => b.action))).toEqual(new Set(Object.keys(S)));
  });

  for (const b of MTG_KEYMAP) {
    test(`${chordToString(b.chord)} → ${b.action}${b.context === 'prompt' ? ' (prompt)' : ''}`, async ({ page }) => {
      const sc = S[b.action];
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openHud(page, sc.seats ? { seats: sc.seats } : {});
      if (sc.setup) await page.evaluate(sc.setup);
      if (sc.hover) await hoverCard(page, sc.hover);
      else await hoverNothing(page);
      const key = pwKey(b.chord);
      if (sc.hold) {
        const parts = key.split('+');
        for (const k of parts) await page.keyboard.down(k);
        await sc.hold.during(page);
        for (const k of [...parts].reverse()) await page.keyboard.up(k);
        await sc.hold.after(page);
      } else {
        await page.keyboard.press(key);
        if (b.trigger === 'double') {
          // One press is not a ping; the second press within 400 ms is.
          expect(await ui(page, 'actions')).toEqual([]);
          await page.keyboard.press(key);
        }
        await sc.check!(page);
      }
      const acts = await ui<{ by: string }[]>(page, 'actions');
      for (const a of acts) expect(a.by).toBe('s0');
      expect(errors).toEqual([]);
    });
  }
});

test.describe('no key fires while a text field has focus (PLAN M0-P4)', () => {
  test('chat field: every bound key is typed, not run', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.getByTestId('chat-input').focus();
    // A prompt is showing, so the prompt bindings (Enter, Esc, H) are live too.
    await page.evaluate(promptByBen);
    for (const b of MTG_KEYMAP) {
      if (b.chord.key === 'Enter' && !b.chord.ctrl) continue; // Enter sends the chat line; checked below
      if (b.chord.key === 'Escape') continue; // Esc leaves the field; checked below
      await page.keyboard.press(pwKey(b.chord));
      await page.getByTestId('chat-input').focus(); // keys like Tab may move focus; the next key starts in the field again
    }
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    expect(await ui(page, 'actions')).toEqual([]);
    expect(await ui(page, 'calls')).toEqual([]);
    expect(await ui(page, 'scene')).toEqual([]);
    expect(await ui(page, 'voice')).toEqual([]);
    await expect(page.getByTestId('cheat-sheet')).toHaveCount(0);
    await expect(page.getByTestId('inspect')).toHaveCount(0);
    await expect(page.getByTestId('token-search')).toHaveCount(0);
    // Enter in the chat sends a chat line, not "OK" to the prompt.
    await page.getByTestId('chat-input').fill('hello table');
    await page.keyboard.press('Enter');
    expect(await drafts(page)).toEqual([{ type: 'chat', text: 'hello table', channel: 'table' }]);
  });

  test('note field: keys are typed into the note, Enter saves it', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyN');
    const input = page.getByTestId('note-input');
    await expect(input).toBeFocused();
    await page.keyboard.type('tgea dsx');
    // (Tab is left out: leaving the field cancels the note.)
    for (const k of ['Shift+KeyL', 'Control+KeyU', 'Digit0', 'Shift+Slash', 'Control+Enter', 'Control+KeyZ']) {
      await page.keyboard.press(k);
      await input.focus();
    }
    expect(await ui(page, 'actions')).toEqual([]);
    expect(await ui(page, 'calls')).toEqual([]);
    expect(await ui(page, 'scene')).toEqual([]);
    await expect(input).toHaveValue(/tgea dsx/);
    await input.fill('kicked');
    await page.keyboard.press('Enter');
    expect(await drafts(page)).toEqual([{ type: 'note', card: 'bf1', text: 'kicked' }]);
    await expect(input).toHaveCount(0);
    // Keys work again once the field is gone.
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await expect.poll(async () => (await drafts(page)).at(-1)).toEqual({ type: 'tap', card: 'bf1', tapped: true });
  });

  test('Esc in the note field cancels without saving', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyN');
    await page.keyboard.type('x');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('note-input')).toHaveCount(0);
    expect(await ui(page, 'actions')).toEqual([]);
  });
});

test.describe('cheat sheet (PLAN M0-P4)', () => {
  test('? lists every bound key; ? again closes it', async ({ page }) => {
    await openHud(page);
    await hoverNothing(page);
    await page.keyboard.press('Shift+Slash');
    const sheet = page.getByTestId('cheat-sheet');
    await expect(sheet).toBeVisible();
    const keys = await sheet.getByTestId('cheat-key').allTextContents();
    expect(keys.sort()).toEqual(MTG_KEYMAP.map((b) => chordToString(b.chord)).sort());
    for (const b of MTG_KEYMAP) {
      await expect(sheet.locator(`[data-testid="cheat-row"][data-action="${b.action}"][data-context="${b.context}"]`).getByTestId('cheat-key').filter({ hasText: new RegExp(`^${chordToString(b.chord).replace(/[+?]/g, '\\$&')}$`) })).toHaveCount(1);
    }
    await page.keyboard.press('Shift+Slash');
    await expect(sheet).toHaveCount(0);
  });

  test('remapping a key changes what fires, shows in the sheet, persists through settings and survives a reload', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('open-cheat-sheet').click();
    const row = page.locator('[data-testid="cheat-row"][data-action="tap"]');
    await row.getByRole('button', { name: /change/i }).click();
    await expect(page.getByTestId('capture')).toBeVisible();
    // A taken key is refused.
    await page.keyboard.press('KeyG');
    await expect(page.getByTestId('capture')).toContainText('already');
    await page.keyboard.press('KeyJ');
    await expect(row.getByTestId('cheat-key')).toHaveText(['J']);
    expect(await ui(page, 'settingsWrites')).toEqual([{ name: 'keymap', value: [{ action: 'tap', context: 'table', chord: { key: 'j' } }] }]);
    expect(await ui(page, 'actions')).toEqual([]); // capturing never ran G or J
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cheat-sheet')).toHaveCount(0);

    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyJ');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);

    await openHud(page, { keepSettings: true });
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyJ');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);
    await page.keyboard.press('Shift+Slash');
    await page.getByTestId('reset-keys').click();
    await expect(page.locator('[data-testid="cheat-row"][data-action="tap"]').getByTestId('cheat-key')).toHaveText(['T']);
  });
});
