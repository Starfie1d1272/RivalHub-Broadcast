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
    await expect(page.locator('[data-match-header-widget="round-history"]')).toHaveCount(1);
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'live-bo3.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('halftime side swap keeps entrant order and remaps current score', async ({ page }) => {
    await openFixture(page, 'series-halftime-swap');
    await expect(page.locator('[data-team="a"] .match-header__side-badge')).toHaveText('T');
    await expect(page.locator('[data-team="b"] .match-header__side-badge')).toHaveText('CT');
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
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'bo5.png',
      SCREENSHOT_OPTIONS,
    );
  });

  test('tactical timeout identifies the entrant only when side mapping resolves', async ({
    page,
  }) => {
    await openFixture(page, 'series-timeout-a');
    await expect(page.locator('[data-timeout-panel="true"][data-timeout-owner="a"]')).toContainText(
      'Northstar',
    );
    await expect(page.locator('[data-timeout-remaining]')).toHaveText('剩余 1 次');
    await expect(page.locator('[data-timeout-countdown]')).toHaveText('0:22');
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'tactical-timeout.png',
      SCREENSHOT_OPTIONS,
    );

    await page.goto('/__visual/program/series-mapping-unavailable');
    await expect(
      page.locator('[data-timeout-panel="true"][data-timeout-owner="unknown"]'),
    ).toContainText('战术暂停');
    await expect(page.locator('[data-timeout-remaining]')).toHaveText('剩余 1 次');
    await expect(page.locator('[data-timeout-countdown]')).toHaveText('0:22');
    await expect(page.locator('[data-timeout-panel="true"]')).not.toContainText('Northstar');
    await expect(page.locator('[data-timeout-panel="true"]')).not.toContainText('Southpoint');
  });

  test('partial history shows bounded hollow gaps without changing the widget box', async ({
    page,
  }) => {
    await openFixture(page, 'series-partial-history');
    await expect(page.locator('[data-match-header-widget="round-history"]')).toHaveAttribute(
      'data-completeness',
      'partial',
    );
    await expect(
      page.locator('[data-match-header-widget="round-history"] [data-round-state="missing"]'),
    ).toHaveCount(6);
    await expect(page.locator('[data-program-canvas="true"]')).toHaveScreenshot(
      'partial-history.png',
      SCREENSHOT_OPTIONS,
    );
    await expect(
      page.locator(
        '[data-match-header-widget="round-history"] [data-entrant="b"] .match-header__round-marker.is-empty',
      ),
    ).toHaveCount(1);
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

  test('OT density keeps 36 rounds inside the fixed round-history widget', async ({ page }) => {
    await openFixture(page, 'series-overtime-history');
    const tracks = page.locator('[data-match-header-widget="round-history"] [data-entrant]');
    await expect(tracks.first().locator('[data-round-number]')).toHaveCount(36);
    const metrics = await tracks.evaluateAll((elements) =>
      elements.map((element) => {
        const track = element.getBoundingClientRect();
        const markers = Array.from(
          element.querySelectorAll<HTMLElement>('.match-header__round-marker'),
        ).map((marker) => marker.getBoundingClientRect());
        const sorted = [...markers].sort((left, right) => left.left - right.left);
        return {
          maxDimension: Math.max(...markers.map((marker) => Math.max(marker.width, marker.height))),
          overflow: markers.some(
            (marker) => marker.left < track.left || marker.right > track.right,
          ),
          overlap: sorted.some((marker, index) => {
            const next = sorted[index + 1];
            return next === undefined ? false : marker.right > next.left;
          }),
        };
      }),
    );
    expect(metrics).toHaveLength(2);
    for (const metric of metrics) {
      expect(metric.maxDimension).toBeLessThanOrEqual(10);
      expect(metric.overflow).toBe(false);
      expect(metric.overlap).toBe(false);
    }
  });

  test('frozen fixture matrix keeps Map 1, not-played, logos, and unavailable rounds explicit', async ({
    page,
  }) => {
    await openFixture(page, 'series-bo3-map1');
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-order="1"]'),
    ).toContainText('当前');

    await page.goto('/__visual/program/series-not-played');
    await expect(
      page.locator('[data-match-header-widget="series-strip"] [data-map-status="not_played"]'),
    ).toContainText('未进行');

    await page.goto('/__visual/program/series-logo-mixed');
    await expect(page.locator('img[alt="Northstar 标志"]')).toHaveCount(1);
    await expect(page.locator('img[alt="Southpoint 标志"]')).toHaveCount(0);

    await page.goto('/__visual/program/series-round-unavailable');
    await expect(
      page.locator('[data-match-header-widget="top-score-bar"] [data-round-label="true"]'),
    ).toHaveCount(0);
    await expect(page.locator('.match-header__round-meta')).not.toContainText('回合编号不可用');
  });
});
