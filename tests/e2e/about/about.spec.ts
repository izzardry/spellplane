/**
 * PLAN M5-P5 acceptance: the About panel's content — the Wizards Fan Content Policy notice and the Scryfall and MTGJSON
 * credits (DESIGN "Card data and images", Legal position: "shows the policy's disclaimer in its About panel"; card data
 * and images from Scryfall, booster composition from MTGJSON). Reachable from the start page, at #/about, and in the
 * settings panel on the table. Links are only checked, never followed (tests never use the network).
 */
import { expect, test, type Locator } from '@playwright/test';
import { openApp } from '../helpers/app';
import { openHud } from '../ui/harness';

async function expectAbout(about: Locator): Promise<void> {
  await expect(about.getByTestId('fan-content-notice')).toHaveText(
    'Spellplane is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
  );
  const policy = about.getByTestId('fan-content-link');
  await expect(policy).toHaveAttribute('href', 'https://company.wizards.com/en/legal/fancontentpolicy');
  await expect(policy).toHaveAttribute('rel', /noopener/);
  const scryfall = about.locator('[data-testid="credit"][data-credit="scryfall"]');
  await expect(scryfall).toContainText('Scryfall');
  await expect(scryfall).toContainText('Card data, card images');
  await expect(scryfall.getByRole('link', { name: 'Scryfall' })).toHaveAttribute('href', 'https://scryfall.com');
  const mtgjson = about.locator('[data-testid="credit"][data-credit="mtgjson"]');
  await expect(mtgjson).toContainText('Booster contents');
  await expect(mtgjson).toContainText('MIT');
  await expect(mtgjson.getByRole('link', { name: 'MTGJSON' })).toHaveAttribute('href', 'https://mtgjson.com');
  for (const a of await about.locator('a').all()) await expect(a).toHaveAttribute('target', '_blank');
}

test('the start page links to About, which shows the Fan Content notice and the credits', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await openApp(page, { hash: '/lobby' });
  await page.getByTestId('link-about').click();
  await expect(page).toHaveURL(/#\/about$/);
  await expectAbout(page.getByTestId('about'));
  await expect(page.getByTestId('about')).toContainText('no rules engine');
});

test('the settings panel on the table has the same About section', async ({ page }) => {
  await openHud(page);
  await page.getByTestId('open-settings').click();
  await page.locator('[data-testid="settings-tab"][data-section="about"]').click();
  await expectAbout(page.getByTestId('settings').getByTestId('about'));
});
