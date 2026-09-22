import {
  PROGRAM_SCHEMA_VERSION,
  RADAR_SCHEMA_VERSION,
} from '../../packages/protocol/src/version.js';
import { expect, test } from '@playwright/test';

const CURRENT_LIVE_BASELINE = {
  type: 'snapshot',
  protocolVersion: 1,
  channel: 'program',
  schemaVersion: PROGRAM_SCHEMA_VERSION,
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
      consecutiveRoundLosses: { ct: null, t: null },
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

const CURRENT_LIVE_RADAR = {
  type: 'snapshot',
  protocolVersion: 1,
  channel: 'radar',
  schemaVersion: RADAR_SCHEMA_VERSION,
  channelSeq: 1,
  cursor: CURRENT_LIVE_BASELINE.cursor,
  payload: {
    telemetryFreshness: 'fresh',
    identityState: 'matched',
    mapName: 'de_mirage',
    observedPlayerSourceId: null,
    coverage: { allPlayers: 'present', bomb: 'present', grenades: 'present' },
    players: [],
    bomb: null,
    grenades: [],
  },
} as const;

const UNSUPPORTED_LIVE_RADAR = {
  ...CURRENT_LIVE_RADAR,
  channelSeq: 2,
  cursor: { ...CURRENT_LIVE_RADAR.cursor, runtimeSeq: 2 },
  payload: { ...CURRENT_LIVE_RADAR.payload, mapName: 'de_unsupported_test_map' },
} as const;

const HUD_SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixels: 0,
  omitBackground: true,
  scale: 'css' as const,
  threshold: 0,
};

test.describe('HUD 编辑器', () => {
  test('显示中文编辑界面，并在实时来源不可用时保持安全隐藏', async ({ page }) => {
    await page.goto('/operator/hud');

    await expect(page.getByRole('heading', { name: 'HUD 编辑器' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /\b(renderer|snapshot|baseline|schema|recipe|SeriesProgress|OperatorCommand|credential)\b/i,
    );
    await expect(page.locator('body')).not.toContainText(
      /节目|上屏|冻结|布局引用|外观引用|测试场景|初始状态/,
    );
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(1);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    const fixtureSelect = page.locator('select[aria-label="示例比赛"]');
    await expect(fixtureSelect).toHaveValue('live-canonical');
    await expect(page.locator('option[value="current-live"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('.hud-console')).toHaveScreenshot(
      'hud-console-preset.png',
      HUD_SCREENSHOT_OPTIONS,
    );
  });

  test('覆盖实时数据从等待、接收、重连到恢复可用的状态机', async ({ page }) => {
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

        readonly url: string;
        constructor(url: string, protocol: string) {
          this.url = url;
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
    const sourceSelect = page.getByLabel('预览来源');
    const liveOption = page.locator('option[value="current-live"]');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.locator('.hud-console__source-status')).toContainText('等待实时数据');

    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      const sock =
        sockets.filter((s) => s.url.includes('/local/v1/program')).at(-1) ?? sockets.at(-1);
      sock?.emit(JSON.stringify(snapshot));
    }, CURRENT_LIVE_BASELINE);
    await expect(page.locator('.hud-console__source-status')).toContainText('实时数据可用');
    await expect(liveOption).not.toHaveAttribute('disabled');
    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      const radarSocket = sockets.filter((s) => s.url.includes('/local/v1/radar')).at(-1);
      radarSocket?.emit(JSON.stringify(snapshot));
    }, CURRENT_LIVE_RADAR);
    await sourceSelect.selectOption('current-live');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget="radar"] canvas.radar')).toHaveAttribute(
      'data-radar-state',
      'live',
    );

    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      const sock =
        sockets.filter((s) => s.url.includes('/local/v1/program')).at(-1) ?? sockets.at(-1);
      sock?.emit(JSON.stringify(snapshot));
    }, STALE_CURRENT_LIVE_SNAPSHOT);
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget="radar"]')).toHaveCount(1);
    await expect(page.locator(
        '[data-gameplay-hud="true"] [data-hud-widget]:not([data-hud-widget="radar"])',
      )).toHaveCount(0);

    await page.evaluate(() => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; disconnect(): void }>;
        }
      ).__rhProgramSockets;
      const sock =
        sockets.filter((s) => s.url.includes('/local/v1/program')).at(-1) ?? sockets.at(-1);
      sock?.disconnect();
    });
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.getByText('实时数据不可用')).toBeVisible();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget="radar"]')).toHaveCount(1);
    await expect(page.locator(
        '[data-gameplay-hud="true"] [data-hud-widget]:not([data-hud-widget="radar"])',
      )).toHaveCount(0);

    await page.waitForTimeout(350);
    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      const sock =
        sockets.filter((s) => s.url.includes('/local/v1/program')).at(-1) ?? sockets.at(-1);
      sock?.emit(JSON.stringify(snapshot));
    }, CURRENT_LIVE_BASELINE);
    await expect(liveOption).not.toHaveAttribute('disabled');
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);

    await page.evaluate((snapshot) => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      const radarSocket = sockets.filter((s) => s.url.includes('/local/v1/radar')).at(-1);
      radarSocket?.emit(JSON.stringify(snapshot));
    }, UNSUPPORTED_LIVE_RADAR);
    await expect(page.locator('.hud-console__source-status')).toContainText(
      '雷达不可用：不支持地图 de_unsupported_test_map',
    );
    await expect(page.locator('.hud-console__source-status')).toHaveAttribute(
      'data-radar-diagnostic',
      'unsupported-map',
    );
    await expect(page.locator('canvas.radar')).toHaveAttribute(
      'data-radar-diagnostic',
      'unsupported-map',
    );

    await page.evaluate(() => {
      const sockets = (
        window as unknown as {
          __rhProgramSockets: Array<{ readonly url: string; emit(data: string): void }>;
        }
      ).__rhProgramSockets;
      const sock =
        sockets.filter((s) => s.url.includes('/local/v1/program')).at(-1) ?? sockets.at(-1);
      sock?.emit('{not-json');
    });
    await expect(sourceSelect).toHaveValue('current-live');
    await expect(liveOption).toHaveAttribute('disabled', '');
    await expect(page.getByText('实时数据不可用')).toBeVisible();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget="radar"]')).toHaveCount(1);
    await expect(page.locator(
        '[data-gameplay-hud="true"] [data-hud-widget]:not([data-hud-widget="radar"])',
      )).toHaveCount(0);
  });

  test('覆盖测试场景、拖动、尺寸调整与网格吸附开关', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: '布局', exact: true }).click();

    await expect(page.getByText('选择组件', { exact: true })).toBeVisible();
    const fixtureSelect = page.locator('select[aria-label="示例比赛"]');
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
    await expect(page.getByText('拖动雷达右下角可调整尺寸。')).toBeVisible();

    const moveTarget = page.getByRole('button', { name: '顶部比分条，可拖动' });
    const moveBox = await moveTarget.boundingBox();
    if (moveBox === null) throw new Error('未找到顶部比分条拖动控件');
    await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(moveBox.x + moveBox.width / 2 + 50, moveBox.y + moveBox.height / 2);
    await page.mouse.up();
    await expect(page.getByLabel('X 偏移')).not.toHaveValue('0');

    await page.getByRole('button', { name: '选择雷达' }).click();
    await page.getByRole('checkbox', { name: '显示组件' }).uncheck();
    await expect(page.getByRole('button', { name: '调整雷达大小' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '显示组件' }).check();
    await page.getByRole('checkbox', { name: '安全区' }).check();
    await expect(page.locator('.hud-console__guide--safe')).toBeVisible();

    await expect(page.locator('.hud-console')).toHaveScreenshot(
      'hud-console-layout.png',
      HUD_SCREENSHOT_OPTIONS,
    );
  });

  test('覆盖品牌色十六进制输入、面板和圆角选项', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: '外观', exact: true }).click();

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
    await page.getByRole('button', { name: '外观', exact: true }).click();

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

  test('所有资源名称都使用本地校验并阻止保存', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: '预设', exact: true }).click();
    const name = page.getByLabel('名称');
    await name.fill('');
    await expect(page.getByRole('alert')).toContainText('名称不能为空');
    await expect(page.getByRole('button', { name: '另存为' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '布局', exact: true })).toBeVisible();
  });

  test('跨工作区持续组合未保存的布局与外观草稿', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: '布局', exact: true }).click();
    await page.getByRole('button', { name: '选择顶部比分条' }).click();
    await page.getByLabel('X 偏移').fill('120');
    const topScoreBar = page.locator(
      '[data-hud-editor-overlay="true"] [data-hud-widget="top-score-bar"]',
    );
    await expect(topScoreBar).toHaveCSS('left', '720px');

    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByLabel('品牌色十六进制值').fill('#ff00aa');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveAttribute(
      'style',
      /--rh-hud-brand: #ff00aa/,
    );
    const previewTopScoreBar = page.locator(
      '[data-gameplay-hud="true"] [data-hud-widget="top-score-bar"]',
    );
    await expect(previewTopScoreBar).toHaveCSS('left', '720px');

    await page.getByRole('button', { name: '预设', exact: true }).click();
    await expect(
      page.locator('[data-gameplay-hud="true"] [data-hud-widget="top-score-bar"]'),
    ).toHaveCSS('left', '720px');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveAttribute(
      'style',
      /--rh-hud-brand: #ff00aa/,
    );
  });

  test('名称无效只阻止保存，不冻结其它有效预览修改', async ({ page }) => {
    await page.goto('/operator/hud');
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByLabel('品牌色十六进制值').fill('#ff00aa');
    await page.getByLabel('名称').fill('');
    await expect(page.getByRole('alert')).toContainText('名称不能为空');
    await expect(page.getByRole('button', { name: '另存为' })).toBeDisabled();
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveAttribute(
      'style',
      /--rh-hud-brand: #ff00aa/,
    );

    await page.getByRole('button', { name: '布局', exact: true }).click();
    await page.getByRole('button', { name: '选择顶部比分条' }).click();
    await page.getByLabel('X 偏移').fill('140');
    const topScoreBar = page.locator(
      '[data-hud-editor-overlay="true"] [data-hud-widget="top-score-bar"]',
    );
    await expect(topScoreBar).toHaveCSS('left', '740px');

    await page.getByRole('button', { name: '外观', exact: true }).click();
    await expect(page.getByLabel('名称')).toHaveValue('');
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveAttribute(
      'style',
      /--rh-hud-brand: #ff00aa/,
    );
    await expect(
      page.locator('[data-gameplay-hud="true"] [data-hud-widget="top-score-bar"]'),
    ).toHaveCSS('left', '740px');
  });

  test('输出画面路由不包含编辑辅助层', async ({ page }) => {
    await page.goto('/__visual/program/live-canonical');
    await expect(page.locator('[data-hud-editor-overlay="true"]')).toHaveCount(0);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    await expect(page.locator('[data-hud-widget]')).toHaveCount(6);
  });
});
