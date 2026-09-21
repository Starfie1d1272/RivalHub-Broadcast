import { expect, test, type Page } from '@playwright/test';

const SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixels: 0,
  omitBackground: true,
  scale: 'css' as const,
  threshold: 0,
};

async function assertRailGeometry(page: Page) {
  for (const side of ['CT', 'T'] as const) {
    const rail = page.locator(`[data-player-rail="${side}"]`);
    await expect(rail).toHaveCount(1);
    await expect(rail).toHaveCSS('width', '300px');
    await expect(rail).toHaveCSS('height', '640px');
    await expect(rail.locator('[data-player-card]')).toHaveCount(5);
  }
}

test.describe('Player Rails HUD', () => {
  test('freezetime keeps the fixed five-card geometry and visible team summary', async ({
    page,
  }) => {
    await page.goto('/__visual/program/series-bo1');
    await assertRailGeometry(page);
    await expect(page.locator('[data-player-rail="CT"] [data-team-summary="CT"]')).toHaveAttribute(
      'data-summary-visible',
      'true',
    );
    await expect(page.locator('[data-player-rail="T"] [data-team-summary="T"]')).toHaveAttribute(
      'data-summary-visible',
      'true',
    );
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'freezetime-ct.png',
      SCREENSHOT_OPTIONS,
    );
    await expect(page.locator('[data-player-rail="T"]')).toHaveScreenshot(
      'freezetime-t.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('live stress coverage keeps observed and dead states inside the same rail geometry', async ({
    page,
  }) => {
    await page.goto('/__visual/program/stress-long-labels');
    await assertRailGeometry(page);
    await expect(page.locator('[data-player-rail="CT"] [data-life-state="dead"]')).toHaveCount(1);
    await expect(page.locator('[data-player-rail="CT"] [data-observed="true"]')).toHaveCount(1);
    await expect(page.locator('[data-player-rail="CT"] [data-player-card]')).toHaveCount(5);
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'live-stress-ct.png',
      SCREENSHOT_OPTIONS,
    );
    await expect(page.locator('[data-player-rail="T"]')).toHaveScreenshot(
      'live-stress-t.png',
      SCREENSHOT_OPTIONS,
    );
  });
});
