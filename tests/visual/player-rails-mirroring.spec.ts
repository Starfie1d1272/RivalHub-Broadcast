import { expect, test } from '@playwright/test';

test('alive and dead PlayerCard geometry mirrors across the two fixed rails', async ({ page }) => {
  await page.goto('/__visual/program/default-dead');
  for (const [cardIndex, selectors] of [
    [
      0,
      [
        '.player-rail__avatar',
        '.player-rail__body',
        '.player-rail__endcap',
        '.player-rail__name',
        '.player-rail__health-value',
        '.player-rail__health-bar',
        '.player-rail__weapons',
        '.player-rail__equipment',
        '.player-rail__utility-icons',
        '.player-rail__kd',
        '.player-rail__money',
        '.player-rail__round-kills',
      ],
    ],
    [
      2,
      [
        '.player-rail__avatar',
        '.player-rail__body',
        '.player-rail__endcap',
        '.player-rail__name',
        '.player-rail__dead-stats',
        '.player-rail__death-mark',
        '.player-rail__money',
      ],
    ],
  ] as const) {
    for (const selector of selectors) {
      const left = await page
        .locator('[data-hud-widget="team-ct-rail"] [data-player-card]')
        .nth(cardIndex)
        .locator(selector)
        .first()
        .boundingBox();
      const right = await page
        .locator('[data-hud-widget="team-t-rail"] [data-player-card]')
        .nth(cardIndex)
        .locator(selector)
        .first()
        .boundingBox();
      expect(left, selector).not.toBeNull();
      expect(right, selector).not.toBeNull();
      expect(right!.x - 1480, selector).toBe(440 - left!.x - left!.width);
      expect(right!.y, selector).toBe(left!.y);
      expect(right!.width, selector).toBe(left!.width);
      expect(right!.height, selector).toBe(left!.height);
    }
  }
});
