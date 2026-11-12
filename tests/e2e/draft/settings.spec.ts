/**
 * PLAN M2-P4 acceptance: the lobby settings panel round-trips (DESIGN "Pre-game: draft, sealed and deck building",
 * Lobby settings: acquisition mode, set per pack with core sets first and a different set per pack allowed, packs per
 * player, picks per pass, optional pick timer, pass timer length; "Specification: card data, packs and draft formats":
 * the ten featured sets head the list). The host's panel writes through the real reducer (`lobbySet`, `settings`); the
 * guest's panel shows the same shared state read-only.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FEATURED_SETS } from '../../../src/data/types';
import { dh, openDraft } from './bundle';

const lobby = async (page: Page) => (await dh(page, 'state')).lobby;
const optionValues = (select: Locator) => select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test.describe('lobby settings panel', () => {
  test('the settings panel round-trips: the host’s choices reach shared state and every panel shows them', async ({ page }) => {
    await openDraft(page, { view: 'lobby', seats: 'Anna,Ben,Cleo' });
    const host = page.getByTestId('panel-s0');
    const guest = page.getByTestId('panel-s1');
    await expect(host.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'true');
    await expect(guest.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'false');
    await expect(guest.getByTestId('lobby-settings-readonly')).toHaveText('The host, Anna, chooses these.');
    await expect(guest.getByTestId('lobby-mode')).toBeDisabled();

    // Defaults: booster draft, 3 packs, pick 1, M19, pick timer off, pass timer 5 s.
    await expect(host.getByTestId('lobby-mode')).toHaveValue('booster');
    await expect(host.getByTestId('lobby-packs')).toHaveValue('3');
    await expect(host.getByTestId('lobby-picks')).toHaveValue('1');
    await expect(host.getByTestId('lobby-set')).toHaveValue('M19');
    await expect(host.getByTestId('lobby-pick-timer')).not.toBeChecked();
    await expect(host.getByTestId('lobby-pass-timer')).toHaveValue('5000');

    // The ten featured sets head the list in the design's order, then the others.
    await expect.poll(() => optionValues(host.getByTestId('lobby-set'))).toEqual([...FEATURED_SETS, 'DOM', 'KLD', 'FDN']);
    await expect(host.getByTestId('lobby-set').locator('optgroup').first()).toHaveAttribute('label', 'Core sets');

    // Mode: Rochester with its burn count.
    await host.getByTestId('lobby-mode').selectOption('rochester');
    expect(await lobby(page)).toEqual({ draft: { format: 'rochester', packs: 3, burn: 0 }, sets: ['M19'], pickTimer: false });
    await expect(guest.getByTestId('lobby-mode')).toHaveValue('rochester');
    await host.getByTestId('lobby-burn').fill('2');
    await host.getByTestId('lobby-burn').blur();
    expect((await lobby(page))!.draft).toEqual({ format: 'rochester', packs: 3, burn: 2 });
    await expect(guest.getByTestId('lobby-burn')).toHaveValue('2');
    await expect(guest.getByTestId('lobby-picks')).toHaveCount(0);

    // Booster draft with 4 packs and 2 picks per pass; out-of-range numbers are clamped to what the table accepts.
    await host.getByTestId('lobby-mode').selectOption('booster');
    await host.getByTestId('lobby-packs').fill('4');
    await host.getByTestId('lobby-packs').blur();
    await host.getByTestId('lobby-picks').fill('2');
    await host.getByTestId('lobby-picks').blur();
    expect((await lobby(page))!.draft).toEqual({ format: 'pass', packs: 4, picks: 2 });
    await expect(guest.getByTestId('lobby-packs')).toHaveValue('4');
    await expect(guest.getByTestId('lobby-picks')).toHaveValue('2');
    await host.getByTestId('lobby-packs').fill('99');
    await host.getByTestId('lobby-packs').blur();
    expect((await lobby(page))!.draft).toEqual({ format: 'pass', packs: 12, picks: 2 });
    await expect(host.getByTestId('lobby-packs')).toHaveValue('12');
    await host.getByTestId('lobby-packs').fill('3');
    await host.getByTestId('lobby-packs').blur();
    // 3 packs, 2 picks is the Pick-Two preset.
    await expect(host.getByTestId('lobby-mode')).toHaveValue('pickTwo');
    await expect(guest.getByTestId('lobby-mode')).toHaveValue('pickTwo');
    await expect(guest.getByTestId('lobby-seat-hint')).toContainText('Pick-Two draft is for 4 players; 3 are seated');

    // One set for every pack, then a different set for pack 2.
    await host.getByTestId('lobby-set').selectOption('M20');
    expect((await lobby(page))!.sets).toEqual(['M20']);
    await expect(guest.getByTestId('lobby-set')).toHaveValue('M20');
    await host.getByTestId('lobby-per-pack').check();
    await expect(host.getByTestId('lobby-pack-set')).toHaveCount(3);
    expect((await lobby(page))!.sets).toEqual(['M20']);
    await host.locator('[data-testid="lobby-pack-set"][data-pack="1"]').selectOption('ORI');
    expect((await lobby(page))!.sets).toEqual(['M20', 'ORI', 'M20']);
    await expect(guest.getByTestId('lobby-pack-set')).toHaveCount(3);
    expect(await guest.getByTestId('lobby-pack-set').evaluateAll((ss) => ss.map((s) => (s as HTMLSelectElement).value))).toEqual(['M20', 'ORI', 'M20']);
    await expect(guest.getByTestId('lobby-per-pack')).toBeChecked();
    await host.getByTestId('lobby-per-pack').uncheck();
    expect((await lobby(page))!.sets).toEqual(['M20']);
    await expect(guest.getByTestId('lobby-set')).toHaveValue('M20');

    // Timers: the pick timer (off by default) and the pass timer length.
    await host.getByTestId('lobby-pick-timer').check();
    expect((await lobby(page))!.pickTimer).toBe(true);
    await expect(guest.getByTestId('lobby-pick-timer')).toBeChecked();
    await host.getByTestId('lobby-pass-timer').selectOption('10000');
    expect((await dh(page, 'state')).settings.passTimerMs).toBe(10_000);
    await expect(guest.getByTestId('lobby-pass-timer')).toHaveValue('10000');
    await host.getByTestId('lobby-pass-timer').selectOption('off');
    expect((await dh(page, 'state')).settings.passTimerMs).toBeNull();

    // Every write went through the reducer and none was refused.
    const applied = await dh(page, 'applied');
    expect(applied.every((a) => a.by === 's0' && (a.type === 'lobbySet' || a.type === 'settings'))).toBe(true);
    expect(await dh(page, 'refused')).toEqual([]);

    // A guest's write is refused by the table and changes nothing.
    const before = await lobby(page);
    await dh(page, 'dispatchAs', 's1', { type: 'lobbySet', lobby: { draft: { format: 'sealed', packs: 6 }, sets: ['M10'], pickTimer: false } });
    expect(await lobby(page)).toEqual(before);
    expect((await dh(page, 'refused'))[0]!.reason).toMatch(/host/);

    // Constructed decks: no draft numbers, no set.
    await host.getByTestId('lobby-mode').selectOption('constructed');
    expect((await lobby(page))!.draft).toBeNull();
    await expect(guest.getByTestId('lobby-packs')).toHaveCount(0);
    await expect(guest.getByTestId('lobby-set')).toHaveCount(0);
  });

  test('a refused write leaves every control showing what the table holds, not the rejected choice', async ({ page }) => {
    await openDraft(page, { view: 'lobby', seats: 'Anna,Ben' });
    const host = page.getByTestId('panel-s0');
    await expect(host.getByTestId('lobby-mode')).toHaveValue('booster');
    await expect.poll(() => optionValues(host.getByTestId('lobby-set'))).toContain('M10');
    const before = await lobby(page);
    await dh(page, 'refuseLobby', true);
    await host.getByTestId('lobby-mode').selectOption('rochester');
    await expect(host.getByTestId('lobby-mode')).toHaveValue('booster');
    await host.getByTestId('lobby-set').selectOption('M10');
    await expect(host.getByTestId('lobby-set')).toHaveValue('M19');
    await host.getByTestId('lobby-pick-timer').click();
    await expect(host.getByTestId('lobby-pick-timer')).not.toBeChecked();
    // Per-pack sets: a refused pack set snaps back too.
    await host.getByTestId('lobby-per-pack').check();
    await expect(host.getByTestId('lobby-pack-set')).toHaveCount(3);
    await host.getByTestId('lobby-pack-set').nth(1).selectOption('M10');
    await expect(host.getByTestId('lobby-pack-set').nth(1)).toHaveValue('M19');
    expect(await lobby(page)).toEqual(before);
    // Accepted again: the choice sticks.
    await dh(page, 'refuseLobby', false);
    await host.getByTestId('lobby-pack-set').nth(1).selectOption('M10');
    await expect(host.getByTestId('lobby-pack-set').nth(1)).toHaveValue('M10');
    await host.getByTestId('lobby-mode').selectOption('rochester');
    await expect(host.getByTestId('lobby-mode')).toHaveValue('rochester');
    expect((await lobby(page))!.draft).toMatchObject({ format: 'rochester' });
  });

  test('a remote change of the settings shows in the host’s own panel too', async ({ page }) => {
    await openDraft(page, { view: 'lobby', seats: 'Anna,Ben' });
    const host = page.getByTestId('panel-s0');
    await dh(page, 'dispatchAs', 's0', { type: 'lobbySet', lobby: { draft: { format: 'grid', grids: 9 }, sets: ['M15'], pickTimer: false } });
    await expect(host.getByTestId('lobby-mode')).toHaveValue('grid');
    await expect(host.getByTestId('lobby-grids')).toHaveValue('9');
    await expect(host.getByTestId('lobby-set')).toHaveValue('M15');
    // Grid packs are shuffled together: no per-pack sets, and no pick timer.
    await expect(host.getByTestId('lobby-per-pack')).toHaveCount(0);
    await expect(host.getByTestId('lobby-pick-timer')).toHaveCount(0);
  });

  test('the chosen set stays shown while the set list loads', async ({ page }) => {
    await openDraft(page, { view: 'lobby', seats: 'Anna,Ben', setsDelay: 1500 });
    const host = page.getByTestId('panel-s0');
    await expect(host.getByTestId('lobby-sets-loading')).toBeVisible();
    await expect(host.getByTestId('lobby-set')).toHaveValue('M19');
    await expect(host.getByTestId('lobby-sets-loading')).toHaveCount(0, { timeout: 10_000 });
    await expect(host.getByTestId('lobby-set')).toHaveValue('M19');
    expect((await optionValues(host.getByTestId('lobby-set'))).slice(0, 10)).toEqual([...FEATURED_SETS]);
  });
});
