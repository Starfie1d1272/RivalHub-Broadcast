import { expect, test } from '@playwright/test';

const HUD_SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixels: 0,
  omitBackground: true,
  scale: 'css' as const,
  threshold: 0,
};

test.describe('节目 HUD 控制台', () => {
  test('显示中文编辑界面，并在当前实时来源不可用时保持安全隐藏', async ({ page }) => {
    await page.goto('/operator/hud');

    await expect(page.getByRole('heading', { name: '把画面边界交给可验证的配置。' })).toBeVisible();
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(1);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    const fixtureSelect = page.locator('select[aria-label="测试场景"]');
    await expect(fixtureSelect).toHaveValue('live-canonical');
    await expect(page.getByRole('option', { name: /当前实时节目/ })).toBeEnabled();

    await page.getByLabel('选择预览来源').selectOption('current-live');
    await expect(page.getByText('当前实时节目不可用')).toBeVisible();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(0);
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(1);

    await page.getByLabel('选择预览来源').selectOption('fixture');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('.hud-console')).toHaveScreenshot(
      'hud-console-preset.png',
      HUD_SCREENSHOT_OPTIONS,
    );
  });

  test('覆盖测试场景、拖动、尺寸调整与网格吸附开关', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: 'HUD 布局' }).click();

    await expect(page.getByText('请选择一个组件')).toBeVisible();
    const fixtureSelect = page.locator('select[aria-label="测试场景"]');
    await fixtureSelect.selectOption('stress-long-labels');
    await expect(fixtureSelect).toHaveValue('stress-long-labels');
    await page.getByRole('button', { name: '选择雷达' }).click();
    await expect(page.getByRole('button', { name: '调整雷达大小' })).toBeVisible();
    await page.getByRole('checkbox', { name: '吸附到网格' }).uncheck();

    const handle = page.getByRole('button', { name: '调整雷达大小' });
    const box = await handle.boundingBox();
    if (box === null) throw new Error('未找到雷达尺寸控件');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 24, box.y + 24);
    await page.mouse.up();
    await expect(page.getByText('只有雷达支持保持正方形的尺寸调整。')).toBeVisible();

    await expect(page.locator('.hud-console')).toHaveScreenshot(
      'hud-console-layout.png',
      HUD_SCREENSHOT_OPTIONS,
    );
  });

  test('覆盖品牌色十六进制输入、面板和圆角选项', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: 'HUD 外观' }).click();

    await expect(page.getByLabel('品牌色十六进制值')).toHaveValue('#c8ef78');
    await page.getByLabel('品牌色十六进制值').fill('#ff00aa');
    await page.getByRole('radio', { name: '轻量' }).check();
    await page.getByRole('radio', { name: '圆润' }).check();
    await expect(page.getByLabel('品牌色十六进制值')).toHaveValue('#ff00aa');
    await expect(page.locator('.hud-console')).toHaveScreenshot(
      'hud-console-theme.png',
      HUD_SCREENSHOT_OPTIONS,
    );
  });

  test('正式节目路由不包含编辑辅助层', async ({ page }) => {
    await page.goto('/__visual/program/live-canonical');
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(0);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget]')).toHaveCount(0);
  });
});
