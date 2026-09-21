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
    await expect(rail.locator('[data-player-card], .player-rail__empty-card')).toHaveCount(5);
    const cardHeights = await rail
      .locator('[data-player-card], .player-rail__empty-card')
      .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
    expect(cardHeights).toEqual([100, 100, 100, 100, 100]);
  }
}

async function assertDeadCardGeometry(page: Page, side: 'CT' | 'T' = 'CT') {
  const deadCard = page.locator(`[data-player-rail="${side}"] [data-life-state="dead"]`);
  await expect(deadCard).toHaveCount(1);
  await expect(deadCard.locator('[data-health-spacer="true"]')).toHaveCount(1);
  const geometry = await deadCard.evaluate((card) => ({
    cardHeight: card.getBoundingClientRect().height,
    deadStatsHeight: card
      .querySelector<HTMLElement>('.player-rail__dead-stats')
      ?.getBoundingClientRect().height,
    spacerHeight: card
      .querySelector<HTMLElement>('[data-health-spacer="true"]')
      ?.getBoundingClientRect().height,
  }));
  expect(geometry.cardHeight).toBe(100);
  expect(geometry.spacerHeight).toBe(3);
  expect(geometry.deadStatsHeight).toBe(34);
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
    await expect(
      page.locator(
        '[data-player-rail="CT"] [data-player-card="stress-player-1"] [aria-label="护甲"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-player-rail="CT"] [data-player-card="stress-player-1"] [aria-label="拆弹器"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-player-rail="CT"] [data-player-card="stress-player-1"] [aria-label="C4"]',
      ),
    ).toHaveCount(1);
    await assertDeadCardGeometry(page);
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'live-stress-ct.png',
      SCREENSHOT_OPTIONS,
    );
    await expect(page.locator('[data-player-rail="T"]')).toHaveScreenshot(
      'live-stress-t.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('eco and low-equipment fixture keeps the fixed rail readable', async ({ page }) => {
    await page.goto('/__visual/program/player-rails-eco');
    await assertRailGeometry(page);
    await expect(page.locator('[data-player-rail="CT"] [data-team-summary="CT"]')).toHaveAttribute(
      'data-summary-visible',
      'true',
    );
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'eco-low-equipment-ct.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('dead observed fixture keeps observation emphasis and dead geometry', async ({ page }) => {
    await page.goto('/__visual/program/player-rails-dead-observed');
    await assertRailGeometry(page);
    await expect(
      page.locator('[data-player-rail="CT"] [data-life-state="dead"][data-observed="true"]'),
    ).toHaveCount(1);
    await assertDeadCardGeometry(page);
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'dead-observed-ct.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('missing summary evidence fails closed while preserving the visible slot', async ({
    page,
  }) => {
    await page.goto('/__visual/program/player-rails-missing-summary');
    await assertRailGeometry(page);
    const summary = page.locator('[data-player-rail="CT"] [data-team-summary="CT"]');
    await expect(summary).toHaveAttribute('data-summary-visible', 'true');
    await expect(summary.locator('.player-rail__economy strong').first()).toHaveText('—');
    await expect(summary.locator('.player-rail__utility > strong')).toHaveText('—');
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'missing-summary-ct.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('freezetime-to-live carryover shows the current live summary for five seconds', async ({
    page,
  }) => {
    await page.goto('/__visual/program/player-rails-carryover');
    const summary = page.locator('[data-player-rail="CT"] [data-team-summary="CT"]');
    await expect(summary).toHaveAttribute('data-summary-phase', 'live');
    await expect(summary).toHaveAttribute('data-summary-visible', 'true');
    await expect(summary.locator('.player-rail__economy strong').first()).toHaveText('$5,000');
    await expect(page.locator('[data-player-rail="CT"]')).toHaveScreenshot(
      'carryover-ct.png',
      SCREENSHOT_OPTIONS,
    );
  });
});
