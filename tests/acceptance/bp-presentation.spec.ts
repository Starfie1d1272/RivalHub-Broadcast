import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../apps/companion/src/app.js';
import { bpManifestFixture } from './bp-manifest-fixture.js';

for (const key of ['semifinalA', 'final'] as const) {
  test(`BP ${key}: real canonical import, cumulative playback, two hosts, reload, hide and replay`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    const dir = await mkdtemp(join(tmpdir(), 'bp-acceptance-'));
    const app = buildApp({ matchManifestPath: join(dir, 'match.json') });
    let offline = false;
    await context.route(
      /\/(local\/v1\/bp|operator\/bp-command|operator\/bp-manifest)$/,
      async (route) => {
        if (offline) {
          await route.abort();
          return;
        }
        const request = route.request();
        const response = await app.inject({
          method: request.method() as 'GET' | 'POST',
          url: new URL(request.url()).pathname,
          headers: request.headers(),
          ...(request.postData() ? { payload: request.postData()! } : {}),
        });
        await route.fulfill({
          status: response.statusCode,
          headers: {
            'content-type': 'application/json',
            ...(response.headers.etag ? { etag: String(response.headers.etag) } : {}),
          },
          body: response.body,
        });
      },
    );
    // Do not access third-party logo hosts in acceptance; only real map assets are required here.
    await context.route('https://sucokfotkypwqkckfynp.supabase.co/**', (route) => route.abort());
    try {
      await page.goto('/operator/bp');
      await expect(page.getByRole('button', { name: '播放 BP', exact: true })).toBeDisabled();
      if (key === 'semifinalA') {
        await page
          .getByRole('button', { name: "半决赛 BO3（猛男队 vs D'avenir）", exact: true })
          .click();
      } else {
        await page.getByText('导入比赛清单', { exact: true }).click();
        await page.getByLabel('比赛清单 JSON').setInputFiles({
          name: 'rivals.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(bpManifestFixture(key))),
        });
        await page.getByRole('button', { name: '导入并切换比赛', exact: true }).click();
      }
      await expect(page.getByText('比赛清单已导入，请核对两队与 BP。')).toBeVisible();
      const program = await context.newPage();
      await program.goto('/program/bp');
      await expect(program.locator('.bp-scene')).toHaveCount(0);
      await expect(page.locator('.bp-preview .bp-scene')).toHaveCount(0);
      await page.getByRole('button', { name: '播放 BP', exact: true }).click();
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(1);
      await expect(page.locator('.bp-preview .bp-card[data-visible=true]')).toHaveCount(1);
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-state', 'shown', {
        timeout: 23000,
      });
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(7);
      await expect(page.locator('.bp-preview .bp-scene')).toHaveAttribute('data-state', 'shown');
      await expect(page.locator('.bp-preview .bp-card[data-visible=true]')).toHaveCount(7);
      const decider = program.locator('.bp-card[data-kind=decider]');
      await expect(decider).toHaveAttribute('data-entrant', 'none');
      if (key === 'semifinalA') {
        const sideA = decider.locator('.bp-side[data-entrant=a]');
        const sideB = decider.locator('.bp-side[data-entrant=b]');
        await expect(sideA).toHaveText('超级无敌大猛男队CT 开');
        await expect(sideB).toHaveText("Team D'avenirT 开");
        await expect(sideA).toBeVisible();
        await expect(sideB).toBeVisible();
        await expect(sideA).toHaveCSS('font-size', '17px');
        await expect(sideB).toHaveCSS('font-size', '17px');
        const boxA = await sideA.boundingBox();
        const boxB = await sideB.boundingBox();
        expect(boxA).not.toBeNull();
        expect(boxB).not.toBeNull();
        expect(boxA!.width).toBeGreaterThan(50);
        expect(boxB!.width).toBeGreaterThan(50);
        expect(boxB!.y).toBeGreaterThanOrEqual(boxA!.y + boxA!.height - 1);
      } else {
        await expect(decider.locator('.bp-side')).toHaveCount(0);
      }
      await program.reload();
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-state', 'shown');
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-animate', 'false');
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(7);
      offline = true;
      await expect(program.locator('.bp-scene')).toHaveCount(0);
      offline = false;
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-state', 'shown');
      await expect(program.locator('.bp-scene')).toHaveAttribute('data-animate', 'false');
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(7);
      await page.getByRole('button', { name: '收起 BP', exact: true }).click();
      await expect(program.locator('.bp-scene')).toHaveCount(0);
      await expect(page.locator('.bp-preview .bp-scene')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '播放 BP', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '播放 BP', exact: true }).click();
      await expect(program.locator('.bp-card[data-visible=true]')).toHaveCount(1);
      await expect(page.locator('.bp-preview .bp-card[data-visible=true]')).toHaveCount(1);
      await page.getByRole('button', { name: '收起 BP', exact: true }).click();
      await expect(program.locator('.bp-scene')).toHaveCount(0);
      await expect(page.locator('.bp-preview .bp-scene')).toHaveCount(0);
      await program.close();
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
