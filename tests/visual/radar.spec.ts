import { expect, test } from '@playwright/test';
import { RADAR_VISUAL_FIXTURES } from '../../apps/web/src/program/fixtures/radar-fixtures.js';

for (const id of RADAR_VISUAL_FIXTURES) {
  test(`Radar ${id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/__visual/radar/${id}`);
    await page.evaluate(() => document.fonts.ready);
    const radar = page.locator('canvas.radar');
    await expect(radar).toHaveAttribute(
      'data-radar-state',
      id === 'stale' || id === 'unsupported' ? 'unavailable' : 'live',
    );
    await expect(radar).toHaveScreenshot(`${id}.png`);
    expect(errors).toEqual([]);
  });
}

test('dense utility maintains frame progress with bounded presentation history', async ({
  page,
}) => {
  await page.goto('/__visual/radar/dense-utility');
  await expect(page.locator('canvas.radar')).toHaveAttribute('data-radar-players', '10');
  const samples = await page.evaluate(async () => {
    const times: number[] = [];
    await new Promise<void>((resolve) => {
      let previous = performance.now();
      const sample = (now: number) => {
        times.push(now - previous);
        previous = now;
        if (times.length === 120) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return times.slice(1).sort((a, b) => a - b);
  });
  const p95FrameMs = samples[Math.floor(samples.length * 0.95)];
  // rAF timestamps can cross the exact decimal boundary by IEEE-754 rounding.
  const floatingPointToleranceMs = 1e-9;
  expect(p95FrameMs).toBeLessThanOrEqual(100 + floatingPointToleranceMs);
  expect(
    Number(await page.locator('canvas.radar').getAttribute('data-radar-trails')),
  ).toBeLessThanOrEqual(128 * 32);
});
