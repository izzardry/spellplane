import { test, expect } from '@playwright/test';

// Module test pages (src/main.ts): ?harness=<name> mounts src/<name>/harness.ts instead of the app.
for (const name of ['scene', 'ui']) {
  test(`?harness=${name} mounts the ${name} harness instead of the app`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`./?faces=placeholder&harness=${name}`);
    await expect(page.locator('#app')).toContainText('harness');
    await expect(page.getByTestId('table')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
