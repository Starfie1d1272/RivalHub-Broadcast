import { expect, test } from '@playwright/test';
const cases = [
  'real-live-rich',
  'real-bomb-dropped',
  'real-planting',
  'real-planting-late',
  'real-planted',
  'real-defusing',
  'real-paused',
  'real-halftime-after',
  'focused-avatar',
  'focused-long-name',
  'focused-low-health-edge',
  'focused-shells-edge',
  'focused-grenade-edge',
  'focused-unavailable-edge',
  'objective-live-4v5-edge',
  'objective-late-plant-edge',
  'objective-late-planted-edge',
  'objective-unavailable-edge',
  'objective-no-kit-edge',
  'objective-dual-progress-edge',
  'objective-paused-edge',
  'objective-long-defuser',
  'objective-stale-edge',
];
for (const id of cases)
  test(`objective/focused ${id}`, async ({ page }) => {
    await page.goto(`/__visual/program/${id}`);
    await page.addStyleTag({ content: '[data-program-foundation-probe] { display: none; }' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const canvas = page.locator('[data-program-canvas="true"]');
    if (id === 'objective-stale-edge')
      await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(0);
    else {
      await expect(page.locator('[data-hud-widget="focused-player"]')).toHaveCSS('width', '360px');
      await expect(page.locator('[data-hud-widget="focused-player"]')).toHaveCSS('height', '176px');
      if (id === 'focused-avatar') {
        await expect(page.locator('[data-focused-player]')).toHaveAttribute('data-avatar', 'true');
        await expect(page.locator('[data-focused-player]')).toHaveCSS('width', '360px');
      } else await expect(page.locator('[data-focused-player]')).toHaveCSS('width', '360px');
      if (await page.locator('[data-objective-mode]').count())
        await expect(page.locator('[data-objective-mode]')).not.toContainText(/\d+\.\d/);
      if (id === 'real-defusing' || id === 'objective-dual-progress-edge')
        await expect(page.locator('[data-objective-track]')).toHaveCount(2);
      await expect(page.locator('[data-team="a"] [data-series-win-slot]')).toHaveCount(2);
      if (id === 'real-planting' || id === 'real-planting-late') {
        const progress = page.locator('.objective-center__plant-progress');
        const bomb = page.locator('.objective-center__icon');
        const progressBox = await progress.boundingBox();
        const bombBox = await bomb.boundingBox();
        expect(progressBox!.x + progressBox!.width / 2).toBeCloseTo(
          bombBox!.x + bombBox!.width / 2,
          0,
        );
        await expect(
          page.locator('.objective-center[data-objective-mode="planting"] .objective-center__icon'),
        ).toHaveCSS('background-color', 'rgb(11, 17, 25)');
      }
      if (id === 'objective-dual-progress-edge') {
        await expect(page.locator('.objective-center__ring-fill')).toHaveAttribute(
          'transform',
          'translate(32 32) scale(-1 1) rotate(-90)',
        );
        const fuse = page.locator('.objective-center__fuse');
        const track = await fuse.boundingBox();
        const fill = await fuse.locator('span').boundingBox();
        expect(fill!.x).toBeCloseTo(track!.x, 1);
        expect(fill!.width).toBeGreaterThan(0);
        expect(fill!.width).toBeLessThan(track!.width);
      }
      if (id === 'real-live-rich')
        await expect(page.locator('[data-focused-player]')).toContainText('MAG ×3');
      if (id === 'focused-shells-edge')
        await expect(page.locator('[data-focused-player]')).toContainText('SHELL 12');
      if (id === 'real-planted')
        await expect(page.locator('[data-focused-player]')).toContainText('DEAD');
    }
    await expect(canvas).toHaveScreenshot(`${id}.png`, {
      omitBackground: true,
    });
  });
