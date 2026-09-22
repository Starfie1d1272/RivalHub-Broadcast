import { expect, test } from '@playwright/test';

for (const fixtureId of [
  'real-live-rich',
  'real-planted',
  'real-defusing',
  'real-halftime-after',
  'program-radar-integrated',
]) {
  test(`real-derived production Program renders ${fixtureId}`, async ({ page }) => {
    await page.goto(`/__visual/program/${fixtureId}`);
    await expect(
      page.locator(
        `[data-program-fixture-kind="real-derived"][data-program-fixture-id="${fixtureId}"]`,
      ),
    ).toHaveCount(1);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-match-header-widget="top-score-bar"]')).toBeVisible();
  });
}
