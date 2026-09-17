import { expect, test, type Page } from '@playwright/test';

const CANVAS_SELECTOR = '[data-program-canvas="true"]';
const FOUNDATION_SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixels: 0,
  omitBackground: true,
  scale: 'css' as const,
  threshold: 0,
};

async function assertFoundationLayout(page: Page, fixtureId: string) {
  const canvas = page.locator(CANVAS_SELECTOR);
  await expect(canvas).toHaveAttribute('data-program-canvas', 'true');
  await expect(canvas).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(canvas).toHaveCSS('box-sizing', 'border-box');
  await expect(canvas).toHaveCSS('isolation', 'isolate');
  await expect(canvas).toHaveCSS('overflow', 'hidden');
  await expect(canvas).toHaveCSS('pointer-events', 'none');
  await expect(canvas).toHaveCSS('position', 'relative');
  const probe = page.locator('[data-program-foundation-probe="true"]');
  await expect(probe).toHaveCount(1);
  await expect(probe).toHaveAttribute('data-fixture-id', fixtureId);

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const layout = await page.evaluate(() => ({
    bodyHeight: document.body.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    canvasHeight: document
      .querySelector<HTMLElement>('[data-program-canvas="true"]')
      ?.getBoundingClientRect().height,
    canvasX: document
      .querySelector<HTMLElement>('[data-program-canvas="true"]')
      ?.getBoundingClientRect().x,
    canvasWidth: document
      .querySelector<HTMLElement>('[data-program-canvas="true"]')
      ?.getBoundingClientRect().width,
    canvasY: document
      .querySelector<HTMLElement>('[data-program-canvas="true"]')
      ?.getBoundingClientRect().y,
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(layout).toEqual({
    bodyHeight: 1080,
    bodyWidth: 1920,
    canvasHeight: 1080,
    canvasX: 0,
    canvasWidth: 1920,
    canvasY: 0,
    documentHeight: 1080,
    documentWidth: 1920,
  });
}

function collectUnexpectedExternalRequests(page: Page) {
  const unexpected: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !(url.hostname === '127.0.0.1' && url.port === '4173')
    ) {
      unexpected.push(request.url());
    }
  });
  return unexpected;
}

test.describe('Program presentation foundation', () => {
  test('awaiting-neutral has a deterministic foundation baseline', async ({ page }) => {
    const unexpectedRequests = collectUnexpectedExternalRequests(page);
    await page.goto('/__visual/program/awaiting-neutral');
    await assertFoundationLayout(page, 'awaiting-neutral');

    await expect(page.locator(CANVAS_SELECTOR)).toHaveScreenshot(
      'awaiting-neutral.png',
      FOUNDATION_SCREENSHOT_OPTIONS,
    );
    expect(unexpectedRequests).toEqual([]);
  });

  test('stress-long-labels stays inside the logical canvas', async ({ page }) => {
    const unexpectedRequests = collectUnexpectedExternalRequests(page);
    await page.goto('/__visual/program/stress-long-labels');
    await assertFoundationLayout(page, 'stress-long-labels');

    await expect(page.locator(CANVAS_SELECTOR)).toHaveScreenshot(
      'stress-long-labels.png',
      FOUNDATION_SCREENSHOT_OPTIONS,
    );
    expect(unexpectedRequests).toEqual([]);
  });

  test('production Program route never renders the visual probe', async ({ page }) => {
    await page.goto('/program?fixture=awaiting-neutral');
    await expect(page.locator(CANVAS_SELECTOR)).toHaveCount(1);
    await expect(page.locator('[data-program-foundation-probe="true"]')).toHaveCount(0);
    await expect(page.locator(CANVAS_SELECTOR)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});
