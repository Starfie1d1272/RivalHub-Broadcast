import { expect, test } from '@playwright/test';

test.describe('Gameplay HUD console', () => {
  test('renders the shared editor preview and keeps Current Live disabled without a baseline', async ({
    page,
  }) => {
    await page.goto('/operator/hud');

    await expect(page.getByRole('heading', { name: '把画面边界交给可验证的配置。' })).toBeVisible();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget]')).toHaveCount(9);
    await expect(page.locator('option[value="current-live"]')).toHaveAttribute('disabled', '');

    await page.getByRole('button', { name: 'HUD 布局' }).click();
    await expect(page.getByRole('heading', { name: '用逻辑坐标安排节目结构' })).toBeVisible();
    await page.locator('[data-hud-widget="radar"]').click();
    await expect(page.getByRole('button', { name: '调整雷达大小' })).toBeVisible();
    await expect(page.getByText('只有 Radar 支持保持正方形的尺寸调整。')).toBeVisible();
  });
});
