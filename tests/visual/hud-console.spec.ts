import { expect, test } from '@playwright/test';

const CURRENT_LIVE_BASELINE = {
  type: 'snapshot',
  protocolVersion: 1,
  channel: 'program',
  schemaVersion: 5,
  channelSeq: 1,
  cursor: {
    producerInstanceId: 'visual-program-producer',
    liveSessionId: 'visual-live-session',
    runtimeSeq: 1,
    programSourceGeneration: 0,
    programReceiveSequence: 1,
    mapEpoch: 0,
  },
  payload: {
    status: { telemetry: 'fresh', context: 'unbound', identity: 'unbound' },
    match: null,
    teams: {
      ct: { mode: 'neutral', entryId: null, name: 'CT', logoUrl: null, seriesScore: null },
      t: { mode: 'neutral', entryId: null, name: 'T', logoUrl: null, seriesScore: null },
    },
    series: null,
    map: {
      name: 'de_mirage',
      mode: null,
      phase: 'live',
      roundNumber: 1,
      score: { ct: 0, t: 0 },
      timeoutsRemaining: { ct: null, t: null },
    },
    round: null,
    clock: null,
    observedPlayerSourceId: null,
    players: [],
    bomb: null,
    coverage: {
      map: 'present',
      round: 'absent',
      phaseCountdowns: 'absent',
      player: 'absent',
      allPlayers: 'absent',
      bomb: 'absent',
    },
  },
} as const;

const STALE_CURRENT_LIVE_SNAPSHOT = {
  ...CURRENT_LIVE_BASELINE,
  channelSeq: 2,
  cursor: { ...CURRENT_LIVE_BASELINE.cursor, runtimeSeq: 2 },
  payload: {
    ...CURRENT_LIVE_BASELINE.payload,
    status: { ...CURRENT_LIVE_BASELINE.payload.status, telemetry: 'stale' },
  },
} as const;

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
    await expect(page.locator('body')).not.toContainText(
      /\b(renderer|snapshot|baseline|schema|recipe|SeriesProgress|OperatorCommand|credential)\b/i,
    );
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(1);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    const fixtureSelect = page.locator('select[aria-label="测试场景"]');
    await expect(fixtureSelect).toHaveValue('live-canonical');
    await expect(page.locator('option[value="current-live"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('.hud-console')).toHaveScreenshot(
      'hud-console-preset.png',
      HUD_SCREENSHOT_OPTIONS,
    );
  });

  test('覆盖当前实时节目从等待、接收、重连到新初始状态的状态机', async ({ page }) => {
    await page.addInitScript(() => {
      class MockWebSocket {
        static readonly instances: MockWebSocket[] = [];
        readonly protocol: string;
        readyState = 0;
        onopen: (() => void) | null = null;
        onmessage: ((event: { readonly data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null =
          null;

        constructor(_url: string, protocol: string) {
          this.protocol = protocol;
          MockWebSocket.instances.push(this);
          window.setTimeout(() => {
            if (this.readyState !== 0) return;
            this.readyState = 1;
            this.onopen?.();
          }, 0);
        }

        close(code = 1000, reason = ''): void {
          this.readyState = 3;
          this.onclose?.({ code, reason });
        }

        send(): void {}

        emit(data: string): void {
          this.onmessage?.({ data });
        }

        disconnect(): void {
          this.readyState = 3;
          this.onclose?.({ code: 1006, reason: '' });
        }
      }

      Object.defineProperty(window, '__rhProgramSockets', {
        configurable: true,
        value: MockWebSocket.instances,
      });
      Object.defineProperty(window, 'WebSocket', {
        configurable: true,
        value: MockWebSocket,
      });
    });

    await page.goto('/operator/hud');
    const sourceSelect = page.getByLabel('选择预览来源');
    const liveOption = page.locator('option[value="current-live"]');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.locator('.hud-console__source-status')).toContainText('等待初始状态');

    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      sockets.at(-1)?.emit(JSON.stringify(snapshot));
    }, CURRENT_LIVE_BASELINE);
    await expect(page.locator('.hud-console__source-status')).toContainText('已接收初始状态');
    await expect(liveOption).not.toHaveAttribute('disabled');
    await sourceSelect.selectOption('current-live');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);

    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      sockets.at(-1)?.emit(JSON.stringify(snapshot));
    }, STALE_CURRENT_LIVE_SNAPSHOT);
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(0);

    await page.evaluate(() => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ disconnect(): void }>;
        }
      ).__rhProgramSockets;
      sockets.at(-1)?.disconnect();
    });
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.getByText('当前实时节目不可用')).toBeVisible();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(0);

    await page.waitForTimeout(350);
    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      sockets.at(-1)?.emit(JSON.stringify(snapshot));
    }, CURRENT_LIVE_BASELINE);
    await expect(liveOption).not.toHaveAttribute('disabled');
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);

    await page.evaluate(() => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      sockets.at(-1)?.emit('{not-json');
    });
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.getByText('当前实时节目不可用')).toBeVisible();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(0);
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

  test('非法品牌色在本地标记并保留上一次有效预览', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: 'HUD 外观' }).click();

    const colorInput = page.getByLabel('品牌色十六进制值');
    await colorInput.fill('#ff00aa');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveAttribute(
      'style',
      /--rh-hud-brand: #ff00aa/,
    );

    await colorInput.fill('not-a-color');
    await expect(colorInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('请输入 6 位十六进制颜色');
    await expect(page.getByRole('button', { name: '另存为' })).toBeDisabled();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveAttribute(
      'style',
      /--rh-hud-brand: #ff00aa/,
    );
  });

  test('切换工作区保留三套独立草稿', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: 'HUD 外观' }).click();
    await page.getByLabel('品牌色十六进制值').fill('#ff00aa');
    await page.getByRole('button', { name: 'HUD 布局' }).click();
    await page.getByLabel('名称').fill('临时布局草稿');
    await page.getByRole('button', { name: 'HUD 外观' }).click();
    await expect(page.getByLabel('品牌色十六进制值')).toHaveValue('#ff00aa');
    await page.getByRole('button', { name: 'HUD 布局' }).click();
    await expect(page.getByLabel('名称')).toHaveValue('临时布局草稿');
  });

  test('正式节目路由不包含编辑辅助层', async ({ page }) => {
    await page.goto('/__visual/program/live-canonical');
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(0);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget]')).toHaveCount(0);
  });
});
