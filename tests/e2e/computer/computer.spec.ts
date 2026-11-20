/**
 * M8-P6 acceptance (PLAN Milestone 8, M8-P6 E2E) on `?harness=computer`: a computer game from two fixture decks
 * mounted on the table frame. Seven cards in hand; Sparring plays a land on its turn; marking an attacker in any phase
 * offers the `ATTACK` cue (on the HUD's primary when HUD_SHELL, else on the frame's fallback bar), `DAMAGE` follows and
 * life totals change; the coach mark shows once; no invite entry; leaving and mounting again restores the state hash
 * and Sparring goes on; `Sparring concedes` sets `TableState.result`.
 *
 * Sparring's pace is driven by the debug hook's manual clock (`bot.setClock('manual')`, `bot.tick(ms)`), never slept
 * through; behaviour is asserted on the state through the debug hook. Fixture cards, placeholder faces, no network.
 */
import { expect, test, type Page } from '@playwright/test';
import { fixturesScript } from '../offline/helpers';

interface Card {
  id: string;
  zone: string;
  owner: string;
  controller: string;
  combat?: string;
  identity?: { sid: string };
}
interface View {
  active: string;
  phase: string;
  life: Record<string, number>;
  cards: Card[];
  hand: number;
  result: { winners: string[] } | null;
  confirm: { id: string; askedBy: string; responses: Record<string, string> } | null;
  /** Sparring's steps since the game was opened (or resumed). */
  steps: number;
}

/** The table as the human session sees it. */
const view = (page: Page): Promise<View> =>
  page.evaluate(() => {
    const s = window.__spellplane!.state!();
    return {
      active: s.turn.active,
      phase: s.turn.phase,
      life: Object.fromEntries(Object.values(s.seats).map((x) => [x.id, x.life])),
      cards: Object.values(s.cards).map((c) => ({ id: c.id, zone: c.zone, owner: c.owner, controller: c.controller, ...(c.combat ? { combat: c.combat } : {}), ...(c.identity ? { identity: { sid: c.identity.sid } } : {}) })),
      hand: window.__spellplane!.secrets!().hand.length,
      result: s.result ? { winners: s.result.winners } : null,
      confirm: s.confirm ? { id: s.confirm.id, askedBy: s.confirm.askedBy, responses: { ...s.confirm.responses } } as View['confirm'] : null,
      steps: window.__spellplane!.bot!.steps(),
    };
  });

const hash = (page: Page): Promise<string | null> => page.evaluate(() => window.__computerHarness!.hash());
const steps = (page: Page): Promise<number> => page.evaluate(() => window.__spellplane!.bot!.steps());
/** The primary button wherever it is: the frame's fallback bar, or the HUD's primary once it shows the shell's slots. */
const primary = (page: Page) => page.locator('[data-testid="frame-primary"], [data-testid="primary-action"]').first();

/** The primary button only while it shows a cue matching `text`. */
const cueShown = (page: Page, text: RegExp) => page.locator('[data-testid="frame-primary"], [data-testid="primary-action"]').filter({ hasText: text });

/** Advance Sparring's clock until `done` holds; the human OKs Sparring's own spells, as Enter would. */
async function drive(page: Page, done: (v: View) => boolean, what: string, rounds = 240): Promise<View> {
  for (let i = 0; i < rounds; i++) {
    const v = await view(page);
    if (done(v)) return v;
    if (v.confirm && v.confirm.askedBy === 's1' && v.confirm.responses.s0 === undefined) {
      await page.evaluate((round) => window.__spellplane!.dispatch!({ type: 'respond', round, seat: 's0', response: 'ok' } as never), v.confirm.id);
    }
    await page.evaluate(() => window.__spellplane!.bot!.tick(800));
  }
  throw new Error(`Sparring never reached: ${what}`);
}

/** A creature in the human's hand (from the injected fixture cards). */
async function creatureInHand(page: Page): Promise<{ id: string; power: number }> {
  return page.evaluate(() => {
    const sec = window.__spellplane!.secrets!();
    const cards = window.__spellplaneFixtures!.cards;
    for (const id of sec.hand) {
      const c = cards.find((x) => x.id === sec.identities[id]?.card.sid);
      if (c && /Creature/.test(c.type_line) && /^\d+$/.test(c.power ?? '')) return { id, power: Number(c.power) };
    }
    throw new Error('no creature in hand');
  });
}

async function openHarness(page: Page, profile: string): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  await page.goto(`./?faces=placeholder&harness=computer&profile=${profile}`);
  await expect.poll(() => page.evaluate(() => typeof window.__computerHarness === 'object' && typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
  await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
  await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'computer');
  await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active())).toBe(true);
}

test.describe('Sparring on the computer harness', () => {
  test('a game against Sparring: deal, land, cues, coach, leave and resume, concede', async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openHarness(page, `computer-${test.info().project.name}-${Date.now()}`);

    await test.step('seven cards in hand, Sparring labelled COMPUTER, no invite entry', async () => {
      await expect.poll(async () => (await view(page)).hand).toBe(7);
      await expect.poll(async () => (await view(page)).cards.filter((c) => c.zone === 'hand:s1').length).toBe(7);
      await expect(page.getByTestId('computer-badge').first()).toHaveText('COMPUTER');
      await expect(page.getByRole('button', { name: /invite|spectator link|talk/i })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: /invite/i })).toHaveCount(0);
      await expect(page.getByTestId('menu-invite')).toHaveCount(0);
      // The human's browser holds nothing of Sparring's hand (computer.md 12.1 scenario 5).
      const leak = await page.evaluate(() => {
        const s = window.__spellplane!.state!();
        const sec = window.__spellplane!.secrets!();
        return s.zones['hand:s1']!.ids.filter((id) => sec.identities[id] !== undefined || s.cards[id]?.identity !== undefined);
      });
      expect(leak).toEqual([]);
      // No text on the page names a card of Sparring's hand (computer.md 12.1 scenario 5; Sparring is red, you are green).
      const names = await page.evaluate(() => window.__computerHarness!.botHandNames());
      expect(names).toHaveLength(7);
      const text = await page.evaluate(() => document.body.innerText);
      for (const n of names) expect(text, n).not.toContain(n);
    });

    let attacker = { id: '', power: 0 };
    await test.step('marking an attacker before any combat step offers ATTACK, with the coach mark once', async () => {
      // Sparring has nothing on the battlefield yet, so it cannot block and the damage is the attacker's power.
      attacker = await creatureInHand(page);
      await page.evaluate((id) => window.__spellplane!.dispatch!({ type: 'move', card: id, to: 'battlefield:s0', pose: { x: -60, y: -300, rot: 0 } } as never), attacker.id);
      await expect.poll(async () => (await view(page)).cards.find((c) => c.id === attacker.id)?.zone).toBe('battlefield:s0');
      await expect(cueShown(page, /attack/i)).toHaveCount(0);
      await page.evaluate((id) => window.__spellplane!.dispatch!({ type: 'moveTemp', card: id, pose: { x: -60, y: -150, rot: 0 }, combat: 'attack', tap: true } as never), attacker.id);
      expect((await view(page)).phase).not.toBe('combat'); // any phase (contracts.md Part G "Computer opponent" item 1)
      await expect(primary(page)).toHaveText(/attack/i);
      await expect(page.getByTestId('coach-sparring')).toContainText('Press ATTACK so Sparring can block and count the damage.');
      await primary(page).click();
      await expect(page.getByTestId('coach-sparring')).toHaveCount(0);
    });

    await test.step('Sparring answers, DAMAGE follows and life totals change', async () => {
      const before = (await view(page)).life.s1!;
      await drive(page, (x) => !x.confirm || x.confirm.responses.s1 !== undefined, 'answering the Attack cue');
      await expect(primary(page)).toHaveText(/damage/i);
      await primary(page).click();
      const after = await drive(page, (x) => x.life.s1 !== before, 'booking the damage');
      expect(after.cards.filter((c) => c.controller === 's1' && c.combat === 'block')).toEqual([]);
      expect(after.life.s1).toBe(before - attacker.power);
      await expect(cueShown(page, /damage|attack/i)).toHaveCount(0);
      // The combat was counted: Main 2 brings the attacker home and moves on.
      await expect(primary(page)).toHaveText(/main 2/i);
      await primary(page).click();
      await expect.poll(async () => (await view(page)).cards.find((c) => c.id === attacker.id)?.combat ?? null).toBeNull();
      const now = await view(page);
      if (now.active === 's0') expect(now.phase).toBe('main2');
      await expect(cueShown(page, /main 2/i)).toHaveCount(0);
    });

    await test.step('Sparring plays a land on its turn', async () => {
      const v = await view(page);
      if (v.active === 's0') await page.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
      await drive(page, (x) => x.cards.some((c) => c.zone === 'battlefield:s1' && c.owner === 's1'), 'a land on its battlefield');
      await drive(page, (x) => x.active === 's0', 'passing the turn back');
      expect(await steps(page)).toBeGreaterThan(3);
    });

    let saved: string | null = null;
    await test.step('leaving goes Home with the solo toast and releases the game', async () => {
      await drive(page, (x) => !x.confirm || x.confirm.responses.s1 !== undefined, 'the Damage round answered');
      saved = await hash(page);
      expect(saved).not.toBeNull();
      await page.locator('[data-testid="frame-leave"], [data-testid="leave"]').first().click();
      await expect(page.getByTestId('harness-home')).toBeVisible();
      await expect(page.getByTestId('toast').first()).toContainText('Game saved. Continue any time.');
      await expect
        .poll(() => page.evaluate(() => window.__computerHarness!.live()))
        .toMatchObject({ botRunners: 0, sessions: 0, engines: 0, transports: 0, timers: 0 });
    });

    await test.step('mounting again restores the state hash, Sparring goes on, the coach mark stays seen', async () => {
      await page.getByTestId('harness-continue').click();
      await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'computer');
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active())).toBe(true);
      await expect.poll(() => hash(page)).toBe(saved);
      await page.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
      expect(await steps(page)).toBe(0);
      await drive(page, (x) => x.active === 's1' && x.steps > 0, 'Sparring taking its turn');
      await drive(page, (x) => x.active === 's0' || x.cards.some((c) => c.controller === 's1' && c.combat === 'attack'), 'Sparring finishing its turn or attacking');
      if ((await view(page)).active === 's1') {
        // Sparring attacks: the cue is Blocks done; no block from the human.
        await expect(primary(page)).toHaveText(/no blocks|done blocking/i);
        await primary(page).click();
        await drive(page, (x) => x.active === 's0', 'Sparring passing after combat');
      }
      const other = await page.evaluate(() => window.__spellplane!.secrets!().hand[0]!);
      await page.evaluate((id) => window.__spellplane!.dispatch!({ type: 'move', card: id, to: 'battlefield:s0', pose: { x: 60, y: -300, rot: 0 } } as never), other);
      await page.evaluate((id) => window.__spellplane!.dispatch!({ type: 'moveTemp', card: id, pose: { x: 60, y: -150, rot: 0 }, combat: 'attack', tap: true } as never), other);
      await expect(primary(page)).toHaveText(/attack/i);
      await expect(page.getByTestId('coach-sparring')).toHaveCount(0);
    });

    await test.step('Sparring concedes from its menu: the result is set', async () => {
      const chip = page.getByTestId('sparring-menu');
      if (await chip.count()) await chip.click();
      else await page.getByTestId('plate-more').last().click();
      await page.getByTestId('sparring-sparringConcedes').click();
      await expect.poll(async () => (await view(page)).result).toEqual({ winners: ['s0'] });
    });
    expect(errors).toEqual([]);
  });

  test('Pause Sparring stops its steps until Resume', async ({ page }) => {
    await openHarness(page, `computer-pause-${test.info().project.name}-${Date.now()}`);
    await expect.poll(async () => (await view(page)).hand).toBe(7);
    const v = await view(page);
    if (v.active === 's0') await page.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
    const chip = page.getByTestId('sparring-menu');
    const openMenu = async () => ((await chip.count()) ? chip.click() : page.getByTestId('plate-more').last().click());
    await openMenu();
    await page.getByTestId('sparring-pauseSparring').click();
    await expect(page.getByTestId('computer-paused').first()).toHaveText('PAUSED');
    const before = await steps(page);
    for (let i = 0; i < 10; i++) await page.evaluate(() => window.__spellplane!.bot!.tick(1000));
    expect(await steps(page)).toBe(before);
    await openMenu();
    await page.getByTestId('sparring-resumeSparring').click();
    await drive(page, (x) => x.cards.some((c) => c.zone === 'battlefield:s1'), 'a land after resuming');
    expect(await steps(page)).toBeGreaterThan(before);
  });
});
