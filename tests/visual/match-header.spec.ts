import { expect, test, type Page } from '@playwright/test';

const SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixels: 0,
  omitBackground: true,
  scale: 'css' as const,
  threshold: 0,
};

async function openFixture(page: Page, fixtureId: string) {
  await page.goto(`/__visual/program/${fixtureId}`);
  await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
  await expect(page.locator('[data-match-header-widget="top-score-bar"]')).toHaveCount(1);
  await expect(page.locator('[data-match-header-widget="series-strip"]')).toHaveCount(1);
}

test.describe('Match Header HUD', () => {
  test('normal live BO3 renders the shared three-widget composition', async ({ page }) => {
    await openFixture(page, 'live-canonical');
    await expect(page.locator('[data-match-header-widget="round-history"]')).toHaveCount(0);
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'live-bo3.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('halftime side swap keeps entrant order and remaps current score', async ({ page }) => {
    await openFixture(page, 'series-halftime-swap');
    await expect(page.locator('[data-team="a"]')).toHaveAttribute('data-side', 'T');
    await expect(page.locator('[data-team="b"]')).toHaveAttribute('data-side', 'CT');
    await expect(page.locator('[data-team="a"] [data-score="a"]')).toHaveText('7');
    await expect(page.locator('[data-team="b"] [data-score="b"]')).toHaveText('5');
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'halftime-swap.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('BO5 keeps five compact map cells inside the fixed series strip', async ({ page }) => {
    await openFixture(page, 'series-bo5');
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order]'),
    ).toHaveCount(5);
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order="1"]'),
    ).toContainText('13–11');
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order="2"]'),
    ).toContainText('13–8');
    await expect(
      page.locator(
        '[data-match-header-widget="series-strip"] .match-header__series-map-winner-name',
      ),
    ).toHaveCount(0);
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'bo5.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('series cells use bundled in-game scenes and the CT/T mark instead of side text', async ({
    page,
  }) => {
    await openFixture(page, 'series-bo3-map1');
    await expect(page.locator('.match-header__series-map-art-image').first()).not.toHaveCSS(
      'background-image',
      'none',
    );
    const sideMark = page.locator('.match-header__series-map-start-side').first();
    await expect(sideMark).toHaveAttribute('data-side', 'CT');
    await expect(sideMark).toHaveAttribute('aria-label', /starts CT$/);
    await expect(sideMark).toHaveText('');
    expect(
      await sideMark.evaluate((node) => getComputedStyle(node, '::before').maskImage),
    ).toContain('/assets/cs2/sides/ct.');

    await page.goto('/__visual/program/series-bo5');
    const bPick = page.locator(
      '[data-match-header-widget="series-strip"] [data-map-order="2"]',
    );
    await expect(bPick).toHaveAttribute('data-picker', 'b');
    await expect(bPick).toHaveAttribute('data-start-side', 'CT');
    await expect(bPick.locator('.match-header__series-map-start-side')).toHaveAttribute(
      'data-side',
      'CT',
    );
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order="5"] .match-header__series-map-start-side'),
    ).toHaveCount(0);
  });

  test('tactical timeout identifies the entrant only when side mapping resolves', async ({
    page,
  }) => {
    await openFixture(page, 'series-timeout-a');
    await expect(page.locator('[data-timeout-panel="true"][data-timeout-owner="a"]')).toContainText(
      'TACTICAL TIMEOUT',
    );
    await expect(page.locator('[data-timeout-panel="true"][data-timeout-owner="a"]')).toContainText(
      '2 LEFT',
    );
    await expect(page.locator('[data-clock="true"]')).toContainText('0:30');
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'tactical-timeout.png',
      SCREENSHOT_OPTIONS,
    );

    await page.goto('/__visual/program/series-mapping-unavailable');
    await expect(page.locator('[data-timeout-panel="true"]')).toHaveCount(0);
    await expect(page.locator('[data-clock="true"]')).toContainText('0:22');
  });

  test('round history remains hidden in the default program composition', async ({ page }) => {
    await openFixture(page, 'series-partial-history');
    await expect(page.locator('[data-match-header-widget="round-history"]')).toHaveCount(0);
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'partial-history.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('long labels stay ellipsized within the frozen composition', async ({ page }) => {
    await openFixture(page, 'series-long-labels');
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order]'),
    ).toHaveCount(5);
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'long-labels.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('unavailable history fails closed without a production placeholder', async ({ page }) => {
    await openFixture(page, 'series-history-unavailable');
    await expect(page.locator('[data-match-header-widget="round-history"]')).toHaveCount(0);
  });

  test('OT history truth remains available to the hidden renderer', async ({ page }) => {
    await openFixture(page, 'series-overtime-history');
    await expect(page.locator('[data-match-header-widget="round-history"]')).toHaveCount(0);
  });

  test('frozen fixture matrix keeps Map 1, not-played, logos, and unavailable rounds explicit', async ({
    page,
  }) => {
    await openFixture(page, 'series-bo3-map1');
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order="1"]'),
    ).toHaveAttribute('data-map-status', 'current');
    await expect(
      page.locator(
        '[data-match-header-widget="series-strip"] [data-map-order="1"] .match-header__series-map-status',
      ),
    ).toHaveText('PLAYING');

    await page.goto('/__visual/program/series-not-played');
    await expect(
      page.locator(
        '[data-match-header-widget="series-strip"] [data-map-status="not_played"] .match-header__series-map-status',
      ),
    ).toHaveText('');

    await page.goto('/__visual/program/series-logo-mixed');
    await expect(page.locator('[data-team-logo-slot="a"] .match-header__team-logo')).toHaveCount(1);
    await expect(page.locator('[data-team-logo-slot="b"] .match-header__team-logo')).toHaveCount(0);

    await page.goto('/__visual/program/series-round-unavailable');
    await expect(
      page.locator('[data-match-header-widget="top-score-bar"] [data-round-label="true"]'),
    ).toHaveCount(0);
    await expect(page.locator('.match-header__round-meta')).not.toContainText('回合编号不可用');
  });
});
