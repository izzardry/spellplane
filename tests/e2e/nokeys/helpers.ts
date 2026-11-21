/**
 * Helpers for the play-without-keys specs (PLAN M7-P5: "an e2e goldfish turn by mouse only and one by touch only (iPad
 * emulation) that asserts no keydown was sent"). The table is set up through the debug hook (a deck imported, an
 * opening hand drawn: setup, not play); everything the specs then play goes through the mouse or fingers only, and what
 * the table did is read back through the debug hook, never from pixels or timing.
 *
 * Table points reach the screen through the homography of the own territory's four corners (the debug hook's
 * `tableView`), so a drop lands at a table spot in either camera rig and at any tilt.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { CardInstance, InstanceId, LogEntry, SecretStore, TableState } from '../../../src/core/types';
import type { AffordanceDebugState } from '../../../src/scene/types';
import type { DebugTableView } from '../../../src/scene/lines';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { hook } from '../helpers/app';
import { call, decklist, openSolo } from '../solo/helpers';

export type Pt = { x: number; y: number };

export const state = (page: Page) => hook<TableState>(page, 'state');
export const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
export const affordances = (page: Page) => hook<AffordanceDebugState>(page, 'affordances');
export const coachNow = (page: Page) => hook<string | null>(page, 'coach.current');
export const coachSeen = (page: Page) => hook<string[]>(page, 'coach.seen');
export const keydowns = (page: Page) => hook<number>(page, 'input.keydowns');
export const pointerdowns = (page: Page) => hook<{ mouse: number; touch: number; pen: number }>(page, 'input.pointerdowns');
export const log = (page: Page) => call<LogEntry[]>(page, 'log');
const tableView = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { tableView(): DebugTableView | null }).tableView()) as Promise<DebugTableView | null>;

export interface ShownCard {
  id: InstanceId;
  zone: string;
  screen: { x: number; y: number; width: number; height: number };
  visible: boolean;
  selected: boolean;
  tapped: boolean;
  moving: boolean;
  /** Held by a drag of this viewer's (the scene's debug card). */
  dragging: boolean;
}
export const shown = (page: Page) => hook<ShownCard[]>(page, 'cards');
export async function shownCard(page: Page, id: InstanceId): Promise<ShownCard> {
  const c = (await shown(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return c;
}
export const centreOf = (r: { x: number; y: number; width: number; height: number }): Pt => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/** A profile no other test uses (a fresh IndexedDB: no hint or coach mark seen). */
export function profileFor(info: TestInfo, tag: string): string {
  return `nokeys-${tag}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The front type line of a card this browser knows (own hand from its secrets, public cards from the state), read from the recorded fixture cards the page was given. */
export async function typeLine(page: Page, id: InstanceId): Promise<string> {
  return page.evaluate((card) => {
    const d = window.__spellplane!;
    const c = d.state!().cards[card];
    const ref = c?.identity ?? d.secrets!().identities[card]?.card;
    const fx = (window as unknown as { __spellplaneFixtures?: { cards: { id: string; type_line?: string; card_faces?: { type_line?: string }[] }[] } }).__spellplaneFixtures;
    const data = ref ? fx?.cards.find((x) => x.id === ref.sid) : undefined;
    return data?.type_line ?? data?.card_faces?.[0]?.type_line ?? '';
  }, id);
}

/** Own hand ids in the fan's order. */
export const handIds = async (page: Page): Promise<InstanceId[]> => {
  const st = await state(page);
  const s = await secrets(page);
  const z = new Set(st.zones['hand:s0']?.ids ?? []);
  return [...s.hand.filter((id) => z.has(id)), ...[...z].filter((id) => !s.hand.includes(id))];
};

/**
 * The solo goldfish table with the 60-card fixture deck and an opening hand holding at least one land and one creature
 * (drawn through the debug hook: setup). Returns the land and creature ids. The input counters are reset after setup.
 */
export async function goldfish(page: Page, info: TestInfo, opts: { hand?: number } = {}): Promise<{ land: InstanceId; creature: InstanceId; spare: InstanceId }> {
  await openSolo(page, profileFor(info, 'g'));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'draw', opts.hand ?? 7);
  let land: InstanceId | undefined;
  let creature: InstanceId | undefined;
  for (let i = 0; i < 30; i++) {
    const hand = await handIds(page);
    for (const id of hand) {
      const t = await typeLine(page, id);
      if (!land && /\bLand\b/.test(t)) land = id;
      if (!creature && /\bCreature\b/.test(t)) creature = id;
    }
    if (land && creature) break;
    await call(page, 'draw', 1);
  }
  if (!land || !creature) throw new Error('no land or creature in thirty draws');
  const spare = (await handIds(page)).find((id) => id !== land && id !== creature)!;
  await settledTable(page);
  await hook(page, 'input.reset');
  return { land, creature, spare };
}

/** Wait until no card moves and two camera poses a few frames apart agree. */
export async function settledTable(page: Page): Promise<void> {
  await expect.poll(async () => (await shown(page)).every((c) => !c.moving), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(
      async () => {
        const a = await hook<{ position: number[] }>(page, 'rig.pose');
        await page.waitForTimeout(80);
        const b = await hook<{ position: number[] }>(page, 'rig.pose');
        return Math.hypot(...a.position.map((v, i) => v - b.position[i]!)) < 0.01 && (await hook(page, 'rig.blend')) === null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** Solve the 3 × 3 homography (h33 = 1) that maps four source points onto four destination points. */
function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k]! -= f * A[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * h[k]!;
    h[r] = s / A[r]![r]!;
  }
  return h;
}

/** Where a table point (mm, canonical frame) is on screen now, for the solo table's seat s0. */
export async function tableToScreen(page: Page, p: Pt): Promise<Pt> {
  const v = await tableView(page);
  const seat = v?.seats.find((s) => s.seat === 's0');
  const corners = seat?.zones?.territory;
  if (!seat || !corners || corners.some((c) => !c)) throw new Error('the own territory is not on screen');
  const t = mtgLayout('1v1').seats[0]!.territory;
  const src = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, w]) => {
    const r = (t.rot * Math.PI) / 180;
    const lx = (u! * t.w) / 2;
    const ly = (w! * t.d) / 2;
    return { x: t.x + lx * Math.cos(r) + ly * Math.sin(r), y: t.y - lx * Math.sin(r) + ly * Math.cos(r) };
  });
  const h = homography(src, corners as Pt[]);
  const d = h[6]! * p.x + h[7]! * p.y + 1;
  return { x: Math.round((h[0]! * p.x + h[1]! * p.y + h[2]!) / d), y: Math.round((h[3]! * p.x + h[4]! * p.y + h[5]!) / d) };
}

/** The screen centre of a zone pile of the solo seat (library, graveyard, exile). */
export async function pileCentre(page: Page, kind: 'library' | 'graveyard' | 'exile'): Promise<Pt> {
  const v = await tableView(page);
  const c = v?.seats.find((s) => s.seat === 's0')?.zones?.[kind];
  if (!c || c.some((x) => !x)) throw new Error(`the ${kind} is not on screen`);
  const pts = c as Pt[];
  return { x: Math.round(pts.reduce((a, q) => a + q.x, 0) / 4), y: Math.round(pts.reduce((a, q) => a + q.y, 0) / 4) };
}

/** A hand card's element and a point near its foot that is not covered by a neighbour. */
export const fanCard = (page: Page, id: InstanceId) => page.locator(`[data-testid="hand-card"][data-card="${id}"]`);
export async function handPoint(page: Page, id: InstanceId): Promise<Pt> {
  const b = (await fanCard(page, id).boundingBox())!;
  for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const p = { x: Math.round(b.x + b.width * fx), y: Math.round(b.y + b.height - 14) };
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="hand-card"]')?.getAttribute('data-card') ?? null, [p.x, p.y]);
    if (hit === id) return p;
  }
  throw new Error(`hand card ${id} has no uncovered point`);
}

/** Press, move in steps and release the left mouse button. */
export async function mouseDrag(page: Page, from: Pt, to: Pt, steps = 14): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Out of the hand fan first (straight up), so the fan hands the card to the table.
  await page.mouse.move(from.x, from.y - 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/** A card's state in the table. */
export const cardIn = async (page: Page, id: InstanceId): Promise<CardInstance | undefined> => (await state(page)).cards[id];

/** How many shuffles of the own library this browser made (its audit records). */
export const shuffles = async (page: Page): Promise<number> => (await secrets(page)).audit.filter((a) => a.kind === 'shuffle' && a.zone === 'library:s0').length;
