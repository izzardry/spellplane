/**
 * M8-P5 acceptance, browser (PLAN Milestone 8 "M8-P5 Rejoin", E2E on `?harness=gather`; journey.md 4.11, 4.12;
 * contracts.md Part G "Rejoin"): Gathering in every row state, `PLAY ON WITHOUT …` only after the page clock ran 8 s,
 * `PLAY ON WITH THIS TABLE`, the seat menu for an own, a present, an away and a team seat (and a matched table), the
 * claim page with its warning and no filled button, every refusal screen, the team prompt; axe on each scene; no blur.
 */
import { expect, test, type Page } from '@playwright/test';
import { seriousViolations } from '../a11y/helpers';
import { designAudit } from '../helpers/design-audit';
import { pauseClock } from '../feel/helpers';

async function openGather(page: Page, scene: string, extra: Record<string, string> = {}): Promise<void> {
  const q = new URLSearchParams({ faces: 'placeholder', harness: 'gather', scene, ...extra });
  await page.goto(`./?${q.toString()}`);
  await expect(page.getByTestId('gather-harness')).toHaveAttribute('data-scene', scene);
}

/** No element under the page uses a CSS blur or a backdrop filter (visual.md: never blurred). */
async function noBlur(page: Page): Promise<void> {
  const blurred = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return /blur\(/.test(cs.filter) || (cs.backdropFilter !== undefined && cs.backdropFilter !== 'none' && cs.backdropFilter !== '');
    }).length,
  );
  expect(blurred).toBe(0);
}

/** Filled (primary) buttons in `scope`. */
const filled = (page: Page, scope: string) => page.getByTestId(scope).locator('.ds-btn--primary');

test.describe('Gathering (journey.md 4.12)', () => {
  test('every row state, the newest-copy line, read-only, PLAY ON WITHOUT only after 8 s', async ({ page }) => {
    await page.clock.install();
    await openGather(page, 'gathering');
    const card = page.getByTestId('gathering-card');
    await test.step('the card over the dimmed table', async () => {
      await expect(card).toBeVisible();
      await expect(page.getByTestId('gathering-title')).toHaveText('Getting everyone back');
      // The format as players name it, not the raw id (gate M8 F13).
      await expect(card.locator('.meta')).toContainText('4 FFA');
      await expect(card.locator('.meta')).not.toContainText('FFA4');
      // A sheet, not a pill: in Plain the button radius is 9999 px and clipped the card into an ellipse (gate M8 F1).
      const radius = await card.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
      expect(radius).toBeLessThanOrEqual(32);
      const rows = page.getByTestId('gathering-row');
      await expect(rows).toHaveCount(4);
      await expect(page.locator('[data-testid="gathering-row"][data-seat="s0"]')).toContainText('Ann (you)');
      await expect(page.locator('[data-testid="gathering-row"][data-seat="s0"]')).toContainText('Here');
      await expect(page.locator('[data-testid="gathering-row"][data-seat="s1"]')).toContainText('Not here');
      await expect(page.locator('[data-testid="gathering-row"][data-seat="s2"]')).toContainText('Connecting…');
      await expect(page.locator('[data-testid="gathering-row"][data-seat="s3"]')).toContainText('Left before you');
      // Only Left before you (the seat the table marks away) carries BRING BACK: a link opens only for an away seat.
      await expect(page.getByTestId('gathering-bring')).toHaveCount(1);
      await expect(page.locator('[data-testid="gathering-row"][data-seat="s3"]').getByTestId('gathering-bring')).toBeVisible();
      await expect(page.getByTestId('gathering-newest')).toHaveText('Newest table: yours · turn 6');
      expect(await page.evaluate(() => window.__gather!.readOnly())).toBe(true);
      await expect(filled(page, 'gathering-card')).toHaveCount(0);
      await noBlur(page);
      await designAudit(page);
      expect(await seriousViolations(page)).toEqual([]);
    });
    await test.step('PLAY ON WITHOUT appears only after 8 s on the page clock', async () => {
      // Only the page clock may count the 8 s: it is paused first and the card mounted afresh, so the real time the
      // audit above took (seconds on a CI runner) does not count.
      await pauseClock(page);
      await page.evaluate(() => window.__gather!.scene('gathering'));
      await expect(card).toBeVisible();
      await expect(page.getByTestId('gathering-play-on')).toHaveCount(0);
      await page.clock.runFor(7000);
      await expect(page.getByTestId('gathering-play-on')).toHaveCount(0);
      await page.clock.runFor(1500);
      await expect(page.getByTestId('gathering-play-on')).toHaveText('PLAY ON WITHOUT BEN AND CY');
      await expect(page.getByTestId('gathering-play-on-line')).toHaveText("The table with more moves is kept; the other side's moves are played again on top where they still fit.");
    });
    await test.step('LOOK AT THE TABLE hides the card and shows the banner; the table can be looked at (not inert)', async () => {
      await page.getByTestId('gathering-look').click();
      await expect(card).toHaveCount(0);
      await expect(page.getByTestId('gathering-banner')).toContainText('Waiting for Ben and Cy');
      expect(await page.evaluate(() => document.querySelector('[data-testid="fake-table"]')!.closest('[inert]') === null)).toBe(true);
      expect(await page.evaluate(() => window.__gather!.readOnly())).toBe(true);
      await page.getByTestId('gathering-back-to-card').click();
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.querySelector('[data-testid="fake-table"]')!.closest('[inert]') !== null)).toBe(true);
    });
    await test.step('BRING BACK and HOME reach the frame', async () => {
      await page.getByTestId('gathering-bring').first().click();
      await page.getByTestId('gathering-home').click();
      expect(await page.evaluate(() => window.__gather!.calls())).toEqual(['bring s3', 'home']);
    });
    await test.step('PLAY ON WITHOUT BEN AND CY plays on, the table goes live and the scrim leaves', async () => {
      await page.getByTestId('gathering-play-on').click();
      await expect(page.getByTestId('gathering')).toHaveAttribute('data-live', 'true');
      await expect(card).toHaveCount(0);
      expect(await page.evaluate(() => window.__gather!.calls())).toContain('playOn s1,s2');
      expect(await page.evaluate(() => window.__gather!.readOnly())).toBe(false);
    });
  });

  test('two players: Waiting for Ben; PLAY ON WITH THIS TABLE when only a newer head holds it', async ({ page }) => {
    await openGather(page, 'gathering');
    await page.evaluate(() =>
      window.__gather!.setStatus({
        waitingFor: ['s1'],
        playOnHere: true,
        knownHead: { play: 12, seq: 50, peer: 'p1', seat: 's1' },
        seats: [
          { seat: 's0', name: 'Ann', me: true, state: 'here' },
          { seat: 's1', name: 'Ben', me: false, state: 'leftBefore' },
        ],
      }),
    );
    await expect(page.getByTestId('gathering-title')).toHaveText('Waiting for Ben');
    await expect(page.getByTestId('gathering-newest')).toHaveText('Ben has a newer table. Waiting for Ben.');
    await page.getByTestId('gathering-play-here').click();
    expect(await page.evaluate(() => window.__gather!.calls())).toEqual(['playOn ']);
    await expect(page.getByTestId('gathering')).toHaveAttribute('data-live', 'true');
  });
});

test.describe('the seat menu (persistence.md section 7)', () => {
  test('own, present, away, team and matched seats; BRING BEN BACK shows the link with its footer', async ({ page }) => {
    await openGather(page, 'menus');
    await test.step('own seat: saved and Leave table', async () => {
      await expect(page.getByTestId('menu-own').getByTestId('seat-menu-saved')).toHaveText(/^Saved · \d+ s ago$/);
      await page.getByTestId('menu-own').getByTestId('seat-menu-leave').click();
    });
    await test.step('present seat: Here', async () => {
      await expect(page.getByTestId('menu-here').getByTestId('seat-menu-here')).toHaveText('Here');
    });
    await test.step('team seat seen by an opponent, and the teammate', async () => {
      await expect(page.getByTestId('menu-team').getByTestId('seat-menu-why')).toHaveText("Only Cy's teammate can bring Cy back.");
      await expect(page.getByTestId('menu-team').getByTestId('seat-menu-bring')).toHaveCount(0);
      await expect(page.getByTestId('menu-teammate').getByTestId('seat-menu-bring')).toHaveText('BRING BEN BACK');
    });
    await test.step('matched table: no bring-back at all', async () => {
      await expect(page.getByTestId('menu-matched').getByTestId('seat-menu-away')).toBeVisible();
      await expect(page.getByTestId('menu-matched').locator('button')).toHaveCount(0);
    });
    await test.step('away seat: Away for 3 min, BRING BEN BACK, the link in place', async () => {
      const away = page.getByTestId('menu-away');
      await expect(away.getByTestId('seat-menu-away')).toHaveText('Away for 3 min');
      await away.getByTestId('seat-menu-bring').click();
      await expect(away.getByTestId('seat-invite')).toHaveAttribute('data-link', /#\/t\/amber-fox-93\/[\w-]{22}\/rejoin\/s1\/[\w-]{22}$/);
      await expect(away.getByTestId('invite-sheet')).toContainText('Bring Ben back');
      // Board 7's compact block (gate M8 N11): the rule is in the two lines beside the code, the actions in one row.
      await expect(away.getByTestId('invite-text')).toHaveText("It opens this game at Ben's seat. Works once, for 24 hours.");
      await expect(away.getByTestId('seat-invite-actions')).toBeVisible();
      await away.getByTestId('seat-invite-new').click();
      await away.getByTestId('seat-invite-back').click();
      await expect(away.getByTestId('seat-menu-bring')).toBeVisible();
      expect(await page.evaluate(() => window.__gather!.calls())).toEqual(['leave', 'invite s1', 'invite s1', 'takeInviteBack s1']);
    });
    await test.step('a refused invite says why', async () => {
      await page.evaluate(() => window.__gather!.failInvite('[invite:soon] Ben has been away for less than 30 seconds'));
      await page.getByTestId('menu-away').getByTestId('seat-menu-bring').click();
      await expect(page.getByTestId('menu-away').getByTestId('seat-menu-failure')).toHaveText('Ben has been away for less than 30 seconds');
    });
    await test.step('the RE-INVITE badge on the away seat', async () => {
      await expect(page.getByTestId('badges').locator('[data-kind="reinvite"]')).toHaveText('RE-INVITE');
      await expect(page.getByTestId('badges').locator('[data-kind="notSaving"]')).toHaveCount(0);
    });
    await noBlur(page);
    await designAudit(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('NOT SAVING shows on the own plate when this browser cannot save', async ({ page }) => {
    await openGather(page, 'menus', { saving: 'no' });
    await expect(page.getByTestId('badges').locator('[data-kind="notSaving"]')).toHaveText('NOT SAVING');
    await expect(page.getByTestId('menu-own').getByTestId('seat-menu-saved')).toHaveText('Not saving');
  });
});

test.describe('the claim page and its refusal screens (journey.md 4.11; contracts.md Part G item 6)', () => {
  test('the warning above WATCH INSTEAD and the filled SIT DOWN AS BEN, last, in one row; sitting down; every refusal screen', async ({ page }) => {
    await openGather(page, 'claim');
    const live = page.getByTestId('claim-live');
    await expect(live.getByTestId('claim-warning')).toHaveText('If another browser of yours still has this game, open the link there. Sitting down here discards that hand.');
    // journey.md 4.11, visual.md A2 (gate M8 finding N8): one filled button, the primary last, beside WATCH INSTEAD.
    await expect(live.getByTestId('claim-sit')).toHaveText('SIT DOWN AS BEN');
    await expect(live.getByTestId('claim-watch')).toHaveText('WATCH INSTEAD');
    await expect(live.getByTestId('claim-notnow')).toHaveAccessibleName('Not now');
    await expect(filled(page, 'claim-live')).toHaveCount(1);
    await expect(filled(page, 'claim-live')).toHaveAttribute('data-testid', 'claim-sit');
    const sit = (await live.getByTestId('claim-sit').boundingBox())!;
    const watch = (await live.getByTestId('claim-watch').boundingBox())!;
    expect(Math.abs(sit.y - watch.y)).toBeLessThan(1);
    expect(sit.x).toBeGreaterThan(watch.x + watch.width);
    await expect(page.getByTestId('claim-looking')).toContainText('Looking for the table…');
    const texts: Record<string, string> = {
      used: 'This link was already used. Ask for a new one.',
      expired: 'This link has expired. Ask for a new one.',
      otherDevice: 'Ben is still connected from his other browser.',
      otherSeat: "This link is for Ben's seat. You are Ann at this table.",
      moved: 'Your seat was taken over from another browser. Your saved hand for this game can no longer be used.',
      locked: "This game has started and every seat is taken. If one of them is yours, ask a player at the table to bring you back from your name's menu.",
    };
    for (const [kind, text] of Object.entries(texts)) {
      const box = page.getByTestId(`claim-refused-${kind}`);
      await expect(box.getByTestId('claim-refusal')).toHaveText(text);
      await expect(box.getByTestId('claim-home')).toBeVisible();
    }
    await expect(page.getByTestId('claim-refused-otherSeat').getByTestId('claim-open-mine')).toBeVisible();
    await expect(page.getByTestId('claim-refused-used').getByTestId('claim-watch')).toBeVisible();
    await noBlur(page);
    await designAudit(page);
    expect(await seriousViolations(page)).toEqual([]);
    // The seat's name seeds the field once; a cleared field stays empty (the player types another name).
    await expect(live.getByTestId('claim-name')).toHaveValue('Ben');
    await live.getByTestId('claim-name').fill('');
    await expect(live.getByTestId('claim-name')).toHaveValue('');
    await live.getByTestId('claim-name').fill('Benjamin');
    await live.getByTestId('claim-sit').click();
    expect(await page.evaluate(() => window.__gather!.calls())).toEqual(['sit Benjamin']);
  });
});

test.describe('the team prompt (contracts.md Part G item 1)', () => {
  test('a frame mounted on a 1v1 table that turns into 2HG shows the prompt for the claimed teammate', async ({ page }) => {
    await openGather(page, 'teamswitch');
    await expect(page.getByTestId('fake-table')).toHaveAttribute('data-format', '1v1');
    await expect(page.getByTestId('team-prompt')).toHaveCount(0);
    await page.evaluate(() => window.__gather!.setFormat('2hg'));
    await expect(page.getByTestId('fake-table')).toHaveAttribute('data-format', '2hg');
    await expect(page.getByTestId('team-prompt')).toBeVisible();
  });

  test('Dana is back from a new browser (link made by Cy). Show him your hand? SHOW', async ({ page }) => {
    await openGather(page, 'team');
    const prompt = page.getByTestId('team-prompt');
    await expect(prompt).toContainText('Dana is back from a new browser (link made by Cy). Show him your hand?');
    expect(await seriousViolations(page)).toEqual([]);
    await prompt.getByTestId('team-prompt-show').click();
    await expect(prompt).toHaveCount(0);
    expect(await page.evaluate(() => window.__gather!.calls())).toEqual(['showHand s3']);
  });
});

test.describe('the claim page over the table (persistence.md section 7)', () => {
  test('a re-invite link shows the claim page over the dimmed table; a refusal replaces it; sitting down ends it', async ({ page }) => {
    await openGather(page, 'gathering');
    await page.evaluate(() => window.__gather!.setStatus({ live: true, rule: 2, waitingFor: [] }));
    await expect(page.getByTestId('gathering-card')).toHaveCount(0);
    await test.step('the claim page, read-only table, SIT DOWN AS BEN the one filled button', async () => {
      await page.evaluate(() => window.__gather!.setClaim({ seat: 's1', name: 'Ben', refusal: null }));
      const claim = page.getByTestId('claim-page');
      await expect(claim).toHaveAttribute('data-phase', 'ready');
      await expect(claim.getByTestId('claim-sit')).toHaveText('SIT DOWN AS BEN');
      await expect(claim.getByTestId('claim-watch')).toBeVisible();
      await expect(claim.getByTestId('claim-warning')).toBeVisible();
      await expect(claim.locator('.ds-btn--primary')).toHaveCount(1);
      expect(await page.evaluate(() => window.__gather!.readOnly())).toBe(true);
      await designAudit(page);
      expect(await seriousViolations(page)).toEqual([]);
    });
    await test.step('a refusal: This link was already used', async () => {
      await page.evaluate(() => window.__gather!.setClaim({ seat: 's1', name: 'Ben', refusal: '[claim:used] this link was already used' }));
      await expect(page.getByTestId('claim-refusal')).toHaveText('This link was already used. Ask for a new one.');
      await expect(page.getByTestId('claim-watch')).toBeVisible();
    });
    await test.step('sitting down ends the claim page and the table is live', async () => {
      await page.evaluate(() => window.__gather!.setClaim({ seat: 's1', name: 'Ben', refusal: null }));
      await page.getByTestId('claim-sit').click();
      await expect(page.getByTestId('claim-page')).toHaveCount(0);
      expect(await page.evaluate(() => window.__gather!.calls())).toEqual(['sitDown Ben']);
      expect(await page.evaluate(() => window.__gather!.readOnly())).toBe(false);
    });
  });
});
