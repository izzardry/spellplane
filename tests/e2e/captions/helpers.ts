/**
 * Browser-test helpers for dictation and captions (PLAN M3-P4): two pages at one table on the local transport, each
 * with its own profile, optionally with the fake speech engine (`?speech=fake`) and a stored talk mode that dictates
 * without a talk key (DESIGN "Chat and voice", Talk modes: dictation with an open gate). Card data comes from the
 * fixtures, faces are placeholders, nothing touches the network.
 */
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { InstanceId, LogEntry, SecretStore, TableState } from '../../../src/core/types';
import type { SceneDebugCard } from '../../../src/scene/table-scene';
import type { DebugCaption } from '../../../src/scene/types';
import type { TalkSettings } from '../../../src/store/types';
import type { Caption } from '../../../src/voice/types';
import { hook } from '../helpers/app';
import { chair, decklist, fixturesScript, freshProfile, freshRoom } from '../lobby/helpers';

export const state = (page: Page) => hook<TableState>(page, 'state');
export const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
export const log = (page: Page) => hook<LogEntry[]>(page, 'session.log');
export const cards = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
export const drawn = (page: Page) => hook<DebugCaption[]>(page, 'speech.drawn');
export const held = (page: Page) => hook<Caption[]>(page, 'speech.captions');
export const say = (page: Page, text: string, final = true) => hook<boolean>(page, 'speech.say', text, final);

/** Talk mode that dictates without a key: open gate, dictation only. */
export const DICTATE_OPEN: TalkSettings = { gate: 'open', voice: false, dictation: true, muted: false, mouseButton: null };

/** Store a setting in the profile's IndexedDB (as the settings panel would), before the table opens. */
async function storeSetting(page: Page, profile: string, name: string, value: unknown): Promise<void> {
  await page.evaluate(
    ([db, n, v]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db as string);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ name: n, value: v });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [`spellplane-${profile}`, name, value] as const,
  );
}

function url(profile: string, speech: boolean, hash = ''): string {
  const q = new URLSearchParams({ faces: 'placeholder', profile, transport: 'local' });
  if (speech) q.set('speech', 'fake');
  return `./?${q.toString()}${hash ? `#${hash}` : ''}`;
}

async function ready(page: Page, file: string): Promise<void> {
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

export interface Table {
  context: BrowserContext;
  a: Page;
  b: Page;
}

/**
 * Anna (s0) and Ben (s1) at one table, game started, both shuffled and holding seven. With `speech`, both pages run
 * the fake engine and dictate with an open gate.
 */
export async function startTable(browser: Browser, info: TestInfo, opts: { speech: boolean }): Promise<Table> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const room = freshRoom();
  const pages: Page[] = [];
  for (const who of ['a', 'b']) {
    const page = await context.newPage();
    const profile = freshProfile(info, who);
    await page.addInitScript({ content: fixturesScript() });
    // The start page creates the profile's database; the talk mode is stored before the table opens.
    await page.goto(url(profile, opts.speech));
    await expect.poll(() => page.evaluate(() => typeof window.__spellplane === 'object')).toBe(true);
    if (opts.speech) await storeSetting(page, profile, 'talk', DICTATE_OPEN);
    await page.goto(url(profile, opts.speech, `/t/${room.roomId}/${room.roomKey}`));
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    pages.push(page);
  }
  const [a, b] = pages as [Page, Page];
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'true');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await b.evaluate(() => window.__spellplane!.session!.draw(7));
  return { context, a, b };
}

/** Put one of Anna's hand cards onto her battlefield (revealed) and wait until both pages draw it face up. */
export async function playCard(t: Table, pose = { x: 0, y: -220, rot: 0 }): Promise<InstanceId> {
  const id = (await secrets(t.a)).hand[0]!;
  await t.a.evaluate(([card, p]) => window.__spellplane!.dispatch!({ type: 'move', card, to: 'battlefield:s0', pose: p } as never), [id, pose] as const);
  for (const p of [t.a, t.b]) {
    await expect.poll(async () => (await cards(p)).find((c) => c.id === id && c.visible && c.shows === 'face' && !c.moving) !== undefined, { timeout: 15_000 }).toBe(true);
  }
  return id;
}

/** Screen centre of a drawn card on a page. */
export async function centreOf(page: Page, id: InstanceId): Promise<{ x: number; y: number }> {
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return { x: c.screen.x + c.screen.width / 2, y: c.screen.y + c.screen.height / 2 };
}

/** The last action of `type` by `seat` in a page's log. */
export async function lastAction(page: Page, type: string, seat = 's0'): Promise<(LogEntry & { kind: 'action' })['action'] | null> {
  const entries = (await log(page)).filter((e): e is LogEntry & { kind: 'action' } => e.kind === 'action' && e.action.type === type && e.action.by === seat);
  return entries.at(-1)?.action ?? null;
}
