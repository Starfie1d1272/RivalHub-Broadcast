import { expect, test } from '@playwright/test';
import { DEFAULT_HUD_COMPOSITE_FIXTURES } from '../../apps/web/src/program/fixtures/default-hud-composite-ids.js';

for (const fixtureId of DEFAULT_HUD_COMPOSITE_FIXTURES) {
  test(`Default V1 full HUD ${fixtureId}`, async ({ page }) => {
    await page.goto(`/__visual/program/${fixtureId}`);
    await expect(page.locator(`[data-program-fixture-id="${fixtureId}"]`)).toHaveCount(1);
    await expect(page.locator('canvas.radar')).toHaveAttribute('data-radar-state', 'live');
    await expect(page.locator('canvas.radar')).toHaveAttribute('data-radar-artwork', 'ready');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      `${fixtureId}.png`,
      {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 0,
        omitBackground: true,
        scale: 'css',
        threshold: 0,
      },
    );
  });
}
