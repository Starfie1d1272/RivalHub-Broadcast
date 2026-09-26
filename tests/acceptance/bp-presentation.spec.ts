import { expect, test, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toMatchContext, validateBroadcastManifest } from '../../packages/rivalhub/src/index.js';
import { buildApp } from '../../apps/companion/src/app.js';
import type { MatchContextBinding } from '../../apps/companion/src/match-context/index.js';
import { bpManifestFixture } from './bp-manifest-fixture.js';

function bindingFor(key: 'semifinalA' | 'final'): MatchContextBinding {
  const candidate = bpManifestFixture(key);
  const validated = validateBroadcastManifest(candidate);
  if (!validated.ok) throw new Error(`BP acceptance Manifest invalid: ${key}`);
  return {
    manifest: validated.value,
    context: toMatchContext(validated.value),
    origin: 'online',
    freshness: 'fresh',
    diagnostics: validated.diagnostics,
  };
}

async function routeCompanionApi(
  context: BrowserContext,
  getApp: () => ReturnType<typeof buildApp>,
  isOffline: (pathname: string) => boolean = () => false,
) {
  await context.route(
    /\/(?:local\/v1\/bp(?:-workspace)?|operator\/bp-command|operator\/bp-local-save|operator\/bp-rivalhub)$/,
    async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (isOffline(pathname)) {
        await route.abort();
        return;
      }
      const response = await getApp().inject({
        method: request.method() as 'GET' | 'POST',
        url: pathname,
        headers: request.headers(),
        ...(request.postData() ? { payload: request.postData()! } : {}),
      });
      const headers: Record<string, string> = {
        'content-type': String(response.headers['content-type'] ?? 'application/json'),
        'cache-control': String(response.headers['cache-control'] ?? 'no-store'),
      };
      if (response.headers.etag) headers.etag = String(response.headers.etag);
      await route.fulfill({
        status: response.statusCode,
        headers,
        ...(response.statusCode === 304 ? {} : { body: response.body }),
      });
    },
  );
}

for (const key of ['semifinalA', 'final'] as const) {
  test(`BP ${key}: RivalHub context, shared reveal, reload and recovery`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    const directory = await mkdtemp(join(tmpdir(), 'bp-acceptance-'));
    const app = buildApp({
      matchContextBinding: bindingFor(key),
      matchManifestPath: join(directory, 'match.json'),
    });
    let offline = false;
    await routeCompanionApi(
      context,
      () => app,
      (pathname) => offline && pathname === '/local/v1/bp',
    );
    await context.route('https://sucokfotkypwqkckfynp.supabase.co/**', (route) => route.abort());
    try {
      await page.goto('/operator/bp');
      await expect(page.locator('.bp-source-badge')).toHaveAttribute('data-source', 'online');
      await expect(page.getByRole('status').filter({ hasText: 'BP 已就绪' })).toBeVisible();
      await expect(page.locator('.bp-preview-frame .bp-scene')).toHaveCount(0);

      const program = await context.newPage();
      await program.goto('/program/bp');
      await expect(program.locator('.bp-scene')).toHaveCount(0);
      await page.getByRole('button', { name: '播放 BP', exact: true }).click();
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(1);
      await expect(page.locator('.bp-preview-frame .bp-card[data-visible=true]')).toHaveCount(1);
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-state', 'shown', {
        timeout: 30000,
      });
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(7);
      await expect(page.locator('.bp-preview-frame .bp-scene')).toHaveAttribute(
        'data-state',
        'shown',
      );
      await expect(page.locator('.bp-preview-frame .bp-card[data-visible=true]')).toHaveCount(7);

      const decider = program.locator('.bp-card[data-kind="decider"]');
      await expect(decider).toHaveAttribute('data-entrant', 'none');
      if (key === 'semifinalA') {
        const sideChoice = decider.locator('.bp-side-choice');
        await expect(sideChoice).toHaveCount(1);
        await expect(sideChoice).toContainText("Team D'avenir");
        await expect(sideChoice).toContainText('T 开');
        await expect(sideChoice).toBeVisible();
        await expect(decider.locator('.bp-side-choice[data-entrant="a"]')).toHaveCount(0);
      } else {
        await expect(decider.locator('.bp-side-choice')).toHaveCount(0);
      }
      await expect(program.locator('.bp-card .bp-side-choice')).toHaveCount(
        key === 'semifinalA' ? 3 : 4,
      );
      const sceneBounds = await program.locator('.bp-scene').boundingBox();
      expect(sceneBounds?.width).toBe(1920);
      expect(sceneBounds?.height).toBe(1080);
      await expect(program.locator('.bp-scene')).toHaveCSS('background-color', 'rgb(8, 13, 22)');

      await program.reload();
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-state', 'shown');
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-animate', 'false');
      offline = true;
      await expect(program.locator('.bp-scene')).toHaveCount(0, { timeout: 5000 });
      offline = false;
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-state', 'shown');
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-animate', 'false');

      await page.getByRole('button', { name: '收起 BP', exact: true }).click();
      await expect(program.locator('.bp-scene')).toHaveCount(0, { timeout: 5000 });
      await expect(page.locator('.bp-preview-frame .bp-scene')).toHaveCount(0);
      await page.getByRole('button', { name: '播放 BP', exact: true }).click();
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(1);
      await expect(page.locator('.bp-preview-frame .bp-card[data-visible=true]')).toHaveCount(1);
      await program.close();
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('local BP authoring compiles to MatchContext, survives restart, and stays responsive', async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), 'bp-local-acceptance-'));
  const manifestPath = join(directory, 'match.json');
  let app = buildApp({ matchManifestPath: manifestPath });
  await routeCompanionApi(context, () => app);
  try {
    await page.goto('/operator/bp');
    await expect(page.locator('.bp-source-badge')).toHaveAttribute('data-source', 'none');
    await page.getByRole('button', { name: '本地填写 BP', exact: true }).click();
    const editor = page.locator('.bp-local-editor');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.bp-map-pool input[type="checkbox"]:checked')).toHaveCount(7);

    const format = editor.getByRole('combobox', { name: '比赛赛制' });
    await format.selectOption('bo5');
    const bo5Steps = editor.locator('.bp-sequence-step');
    await expect(bo5Steps).toHaveCount(11);
    await expect(bo5Steps.last()).toContainText('DECIDER');
    await expect(bo5Steps.last().locator('select')).toHaveCount(0);
    await format.selectOption('bo3');

    await editor.locator('.bp-editor-match-fields input').nth(0).fill('本地赛事');
    await editor.locator('.bp-editor-match-fields input').nth(1).fill('决赛');
    await editor
      .locator('.bp-editor-team[data-entrant="a"] input')
      .first()
      .fill('本地赛超级无敌大猛男队');
    await editor
      .locator('.bp-editor-team[data-entrant="b"] input')
      .first()
      .fill("Team D'avenir 本地长队");

    const steps = editor.locator('.bp-sequence-step');
    await steps.nth(0).locator('select').selectOption('de_ancient');
    await steps.nth(1).locator('select').selectOption('de_dust2');
    await steps.nth(2).locator('select').selectOption('de_mirage');
    await steps.nth(3).locator('select').selectOption('CT');
    await steps.nth(4).locator('select').selectOption('de_inferno');
    await steps.nth(5).locator('select').selectOption('T');
    await steps.nth(6).locator('select').selectOption('de_anubis');
    await steps.nth(7).locator('select').selectOption('de_cache');
    await steps.nth(9).locator('select').selectOption('T');
    await expect(editor.getByRole('button', { name: '保存本地 BP' })).toBeEnabled();

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
    }
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true);

    await page.getByRole('button', { name: '保存本地 BP', exact: true }).click();
    await expect(page.locator('.bp-source-badge')).toHaveAttribute('data-source', 'local');
    await expect(page.getByRole('heading', { name: '本地 BP 已保存' })).toBeVisible();
    const localWorkspace = await app.inject({ url: '/local/v1/bp-workspace' });
    expect(JSON.parse(localWorkspace.body)).toMatchObject({ source: 'local', readiness: 'ready' });

    await app.close();
    app = buildApp({ matchManifestPath: manifestPath });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.bp-source-badge')).toHaveAttribute('data-source', 'cache');
    await expect(page.getByRole('heading', { name: '本地 BP 已保存' })).toBeVisible();
    await expect(page.locator('.bp-local-summary')).toContainText("Team D'avenir 本地长队");
    await expect(page.locator('.bp-preview-frame .bp-scene')).toHaveCount(0);

    const program = await context.newPage();
    await program.goto('/program/bp');
    await expect(program.locator('.bp-scene')).toHaveCount(0);
    await page.getByRole('button', { name: '播放 BP', exact: true }).click();
    await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(1);
    await expect(page.locator('.bp-preview-frame .bp-card[data-visible=true]')).toHaveCount(1);
    await program.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await program
        .locator('.bp-scene')
        .evaluate((node) => getComputedStyle(node).transitionProperty),
    ).toBe('none');
    await program.close();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
