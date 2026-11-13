/**
 * PLAN M3-P4 acceptance in the browser (fake engine, `?speech=fake`; DESIGN "Chat and voice", Dictation and captions):
 *
 * 1. A final transcript produces a caption anchored to the last-touched card on every page, and a log entry attached
 *    to that action.
 * 2. With no card context the caption sits at the avatar.
 * 3. The local-model engine is not downloaded unless chosen.
 *
 * Also: interim words grow one bubble on every page before the final, the bubble fades a few seconds after the final,
 * and holding dictation while a note field has focus dictates into that field (Notes by voice). Engine behaviour is
 * asserted on the debug hook (anchors and screen rectangles), never on pixels. Two pages on the local transport.
 */
import { expect, test, type Page } from '@playwright/test';
import type { DebugStackEntry } from '../../../src/scene/stack';
import type { DebugCaption } from '../../../src/scene/types';
import { centreOf, drawn, held, holdTalk, lastAction, log, playCard, say, startTable, state, type Table } from './helpers';

let table: Table | null = null;
test.afterEach(async () => {
  await table?.context.close();
  table = null;
});

/** The page's only drawn caption once it has `text`. */
async function bubble(page: Page, text: string): Promise<DebugCaption> {
  let found: DebugCaption | undefined;
  await expect
    .poll(
      async () => {
        found = (await drawn(page)).find((c) => c.text === text && c.screen !== null);
        return found !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

test.describe('captions with the fake engine', () => {
  test('a final transcript makes a caption at the last-touched card on every page, and a log entry attached to that action', async ({ browser }, info) => {
    test.setTimeout(120_000);
    table = await startTable(browser, info, { speech: true });
    const { a, b } = table;
    const card = await playCard(table);

    // Anna taps the card with the hover key (her last action on a card).
    const at = await centreOf(a, card);
    await a.mouse.move(at.x, at.y, { steps: 3 });
    await a.keyboard.press('t');
    await expect.poll(async () => (await state(b)).cards[card]?.tapped, { timeout: 15_000 }).toBe(true);
    const tap = (await lastAction(a, 'tap'))!;
    expect(tap).toMatchObject({ card, tapped: true });
    // Moving away: the caption follows the last touched card, not a hovered one.
    await a.mouse.move(720, 120);

    await holdTalk(a);
    await expect.poll(() => engineOf(a)).toBe('fake');
    // Interim words: one growing bubble at the card on both pages, nothing in the log yet.
    expect(await say(a, 'two damage', false)).toBe(true);
    for (const p of [a, b]) {
      const c = await bubble(p, 'two damage');
      expect(c).toMatchObject({ final: false, anchoredTo: { kind: 'card', id: card } });
      await expectAbove(p, c, card);
    }
    expect((await log(b)).some((e) => e.kind === 'action' && e.action.type === 'caption')).toBe(false);

    expect(await say(a, 'two damage to your Elf', true)).toBe(true);
    // Both pages at once: the final bubble lingers only a few seconds.
    await Promise.all(
      [a, b].map(async (p) => {
        const c = await bubble(p, 'two damage to your Elf');
        expect(c).toMatchObject({ final: true, anchoredTo: { kind: 'card', id: card } });
        await expectAbove(p, c, card);
        // One bubble: the final replaced the interim.
        expect((await drawn(p)).filter((x) => x.text.startsWith('two damage'))).toHaveLength(1);
        // It shows Anna's seat glyph, so the speaker does not depend on hue alone.
        const glyph = p.locator('[data-testid="caption"]', { hasText: 'two damage to your Elf' }).locator('[data-caption-glyph]');
        await expect(glyph).not.toHaveAttribute('data-caption-glyph', '');
        await expect(glyph).toBeVisible();
      }),
    );
    for (const p of [a, b]) {
      // The log entry is attached to the tap.
      await expect.poll(async () => (await lastAction(p, 'caption')) !== null, { timeout: 15_000 }).toBe(true);
      expect(await lastAction(p, 'caption')).toMatchObject({ text: 'two damage to your Elf', anchor: { kind: 'card', id: card }, about: tap.cid });
      // And it reads in the timeline as the speaker's line.
      await expect(p.getByTestId('log-line').filter({ hasText: 'two damage to your Elf' })).toHaveCount(1);
    }

    // It fades a few seconds after the final result.
    for (const p of [a, b]) await expect.poll(async () => (await drawn(p)).length, { timeout: 15_000 }).toBe(0);
    for (const p of [a, b]) expect(await held(p)).toEqual([]);
  });

  test('with no card context the caption sits beside the speaker’s avatar', async ({ browser }, info) => {
    test.setTimeout(120_000);
    table = await startTable(browser, info, { speech: true });
    const { a, b } = table;
    // Anna passes the turn: her last action touched no card.
    await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
    await expect.poll(async () => (await state(b)).turn.active, { timeout: 15_000 }).toBe('s1');

    await holdTalk(a);
    expect(await say(a, 'your go', true)).toBe(true);
    const vh = 900;
    await Promise.all(
      [a, b].map(async (p) => {
        const c = await bubble(p, 'your go');
        expect(c.anchoredTo).toEqual({ kind: 'seat', id: 's0' });
        // Anna's avatar is at her own near edge on her page and at the far edge on Ben's.
        const mid = c.screen!.y + c.screen!.height / 2;
        if (p === a) expect(mid).toBeGreaterThan(vh / 2);
        else expect(mid).toBeLessThan(vh / 2);
      }),
    );
    for (const p of [a, b]) {
      await expect.poll(async () => (await lastAction(p, 'caption')) !== null, { timeout: 15_000 }).toBe(true);
      const sent = (await lastAction(p, 'caption'))!;
      expect(sent).toMatchObject({ text: 'your go' });
      expect(sent).not.toHaveProperty('anchor');
      expect(sent).not.toHaveProperty('about');
    }
  });

  test('a hovered stack marker (an ability without a card) is the caption’s anchor', async ({ browser }, info) => {
    test.setTimeout(120_000);
    table = await startTable(browser, info, { speech: true });
    const { a, b } = table;
    const card = await playCard(table);
    // Anna puts an ability of her card on the stack, then passes the turn: her last action touched no card.
    await a.evaluate((source) => window.__spellplane!.dispatch!({ type: 'stackPush', item: 'cap-ab1', kind: 'ability', source } as never), card);
    await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
    await expect.poll(async () => (await state(b)).turn.active, { timeout: 15_000 }).toBe('s1');
    // She points at the ability's marker in the stack lane.
    let marker: DOMRect | null = null;
    await expect
      .poll(
        async () => {
          const lane = await a.evaluate(() => JSON.parse(JSON.stringify(window.__spellplane!.stack!())) as DebugStackEntry[]);
          marker = lane.find((e) => e.item === 'cap-ab1' && e.marker)?.screen ?? null;
          return marker !== null;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const m = marker!;
    await a.mouse.move(m.x + m.width / 2 - 4, m.y + m.height / 2 - 4);
    await a.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 3 });

    await holdTalk(a);
    expect(await say(a, 'that trigger', true)).toBe(true);
    for (const p of [a, b]) {
      const c = await bubble(p, 'that trigger');
      expect(c.anchoredTo).toEqual({ kind: 'stackItem', id: 'cap-ab1' });
    }
    await expect.poll(async () => (await lastAction(b, 'caption')) !== null, { timeout: 15_000 }).toBe(true);
    expect(await lastAction(b, 'caption')).toMatchObject({ text: 'that trigger', anchor: { kind: 'stackItem', id: 'cap-ab1' } });
  });

  test('dictation while a note field has focus goes into that field, not into a caption', async ({ browser }, info) => {
    test.setTimeout(120_000);
    table = await startTable(browser, info, { speech: true });
    const { a, b } = table;
    const card = await playCard(table);
    await a.bringToFront();
    const at = await centreOf(a, card);
    await a.mouse.move(at.x, at.y, { steps: 3 });
    await a.keyboard.press('n');
    const input = a.getByTestId('note-input');
    await expect(input).toBeFocused();
    await input.fill('kicked');
    // The talk mouse button (here the back button, which Playwright's mouse cannot press, so the event is dispatched)
    // held over the field dictates into it (Ctrl held alone would too; tests/unit/voice/ctrl-key.test.ts).
    await input.dispatchEvent('mousedown', { button: 3, bubbles: true });
    expect(await say(a, 'gets plus two', false)).toBe(true);
    await expect(input).toHaveValue('kicked gets plus two');
    expect(await say(a, 'gets plus two until end of turn', true)).toBe(true);
    await expect(input).toHaveValue('kicked gets plus two until end of turn');
    await input.press('Enter');
    await expect.poll(async () => (await state(b)).cards[card]?.note, { timeout: 15_000 }).toBe('kicked gets plus two until end of turn');
    expect(await held(a)).toEqual([]);
    expect(await drawn(b)).toEqual([]);
    expect(await lastAction(a, 'caption')).toBeNull();

    // With the field closed, dictation is a caption again.
    expect(await say(a, 'and a caption', true)).toBe(true);
    await bubble(b, 'and a caption');
    await a.dispatchEvent('body', 'mouseup', { button: 3, bubbles: true });
  });
});

test('the on-device model is not downloaded unless chosen; the settings say where audio goes', async ({ browser }, info) => {
  test.setTimeout(120_000);
  table = await startTable(browser, info, { speech: false });
  const { a, context } = table;
  // Nothing may reach the network: the CDN and the model hub are refused, and every request is recorded.
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await context.route(/cdn\.jsdelivr\.net\/npm\/@huggingface|huggingface\.co|hf\.co/, (r) => r.abort());
  const MODEL = /cdn\.jsdelivr\.net\/npm\/@huggingface|huggingface\.co|hf\.co|\/assets\/local-[^/]*\.js/;
  const modelRequests = () => requests.filter((u) => MODEL.test(u));
  // Nothing of it was loaded since the page opened either.
  const loadedSincePageOpened = () => a.evaluate((src) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new RegExp(src).test(n)), MODEL.source);
  expect(await loadedSincePageOpened()).toEqual([]);

  await a.getByTestId('open-speech-settings').click();
  const panel = a.getByTestId('speech-settings');
  await expect(panel).toBeVisible();
  // The active engine and where its audio goes, in plain words.
  const statement = a.getByTestId('speech-statement');
  await expect(statement).toHaveAttribute('data-engine', 'webspeech');
  await expect(statement).toContainText('Browser speech recognition');
  // Where the browser has no speech recognition, the statement says dictation is unavailable instead of naming the vendor.
  const recogniser = await a.evaluate(() => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  await expect(statement).toHaveAttribute('data-available', String(recogniser));
  if (recogniser) await expect(statement).toContainText('browser vendor');
  else await expect(statement).toContainText('Dictation is unavailable');
  const local = panel.locator('[data-testid="speech-engine"][data-engine="local"]');
  await expect(local).toContainText('audio stays on this device');
  await expect(local).toContainText(/downloads about \d+ MB once/);
  await expect(panel.locator('[data-testid="speech-engine"]')).toHaveCount(2);

  // Picking it asks first; nothing is fetched until the player confirms.
  await local.locator('input').check();
  await expect(a.getByTestId('speech-download-confirm')).toContainText(/about \d+ MB/);
  // …and where it comes from.
  await expect(a.getByTestId('speech-download-sources')).toContainText('jsDelivr');
  await expect(a.getByTestId('speech-download-sources')).toContainText('Hugging Face');
  expect(modelRequests()).toEqual([]);
  expect(await loadedSincePageOpened()).toEqual([]);

  // The language is a per-player setting, stored with a full tag.
  await a.getByTestId('speech-lang').selectOption('de-DE');
  await expect(a.getByTestId('speech-lang')).toHaveValue('de-DE');
  expect(modelRequests()).toEqual([]);

  // Confirming starts the download (refused here, so it fails and the engine stays the browser's).
  await a.getByTestId('speech-download').click();
  await expect(a.getByTestId('speech-error')).toContainText('could not be downloaded', { timeout: 15_000 });
  expect(modelRequests().some((u) => /cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/.test(u))).toBe(true);
  expect(modelRequests().some((u) => /\/assets\/local-[^/]*\.js/.test(u))).toBe(true);
  await expect(statement).toHaveAttribute('data-engine', 'webspeech');
  // The choice shows the engine in use again, and so does the debug hook.
  await expect(local.locator('input')).not.toBeChecked();
  await expect(panel.locator('[data-testid="speech-engine"][data-engine="webspeech"] input')).toBeChecked();
  await expect(a.getByTestId('speech-download-confirm')).toHaveCount(0);
  expect(await engineOf(a)).not.toBe('local');

  // Closing and reopening keeps the language.
  await a.getByTestId('open-speech-settings').click();
  await a.getByTestId('open-speech-settings').click();
  await expect(a.getByTestId('speech-lang')).toHaveValue('de-DE');
});

// --- helpers -----------------------------------------------------------------------------------------------------------

function engineOf(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__spellplane!.speech!.engine());
}

/** The bubble hangs just above the card's centre on this page (DESIGN "Chat and voice", Placement). */
async function expectAbove(page: Page, c: DebugCaption, card: string): Promise<void> {
  const centre = await centreOf(page, card);
  const s = c.screen!;
  expect(Math.abs(s.x + s.width / 2 - centre.x)).toBeLessThan(3);
  const gap = centre.y - (s.y + s.height);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(30);
}
