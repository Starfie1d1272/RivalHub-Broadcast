import { expect, test } from '@playwright/test';

interface ReplayEventFixture {
  readonly id: string;
  readonly kind: string;
  readonly sequence: number;
  readonly scheduledElapsedUs: number;
  readonly label: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

test.describe('HUD 编辑器 Replay', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows the fixed real identities and locally frozen presentation assets', async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto('/operator/hud');
    await page.getByLabel('预览来源').selectOption('replay');

    const replay = page.getByRole('region', { name: 'Replay 控制' });
    await expect(replay).toHaveAttribute('data-replay-cursor', '587');
    await expect(page.locator('body')).toContainText('FURIA');
    await expect(page.locator('body')).toContainText('G2.Esports');
    for (const displayName of ['FalleN', 'huNter-', 'KSCERATO', 'YEKINDAR']) {
      await expect(page.locator('body')).toContainText(displayName);
    }
    await expect(page.locator('[data-avatar-present="true"]')).toHaveCount(10);
    await expect(page.locator('img[src*="team-furia.svg"]')).not.toHaveCount(0);
    await expect(page.locator('img[src*="team-g2.png"]')).not.toHaveCount(0);
    await expect(page.locator('[data-hud-widget="radar"] canvas.radar')).toHaveAttribute(
      'data-radar-state',
      'live',
    );
  });

  test('uses capture time for smoke windows and renders a seek anchor deterministically', async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto('/operator/hud');
    await page.getByLabel('预览来源').selectOption('replay');
    const replay = page.getByRole('region', { name: 'Replay 控制' });
    await expect(replay).toHaveAttribute('data-replay-cursor', '587');

    const eventsResponse = await page.request.get('/fixtures/ancient-round-03/replay/events.jsonl');
    expect(eventsResponse.ok()).toBe(true);
    const events = (await eventsResponse.text())
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReplayEventFixture);
    const seekAnchor = events.find((event) => event.kind === 'bomb-state');
    const smokeStart = events.filter((event) => event.kind === 'smoke-start').at(-1);
    expect(seekAnchor).toBeDefined();
    expect(smokeStart).toBeDefined();
    const smokeEnd = events.find(
      (event) =>
        event.kind === 'smoke-end' &&
        event.detail.sourceEntityId === smokeStart!.detail.sourceEntityId,
    );
    expect(smokeEnd).toBeDefined();

    const radar = page.locator('[data-hud-widget="radar"] canvas.radar');
    await page.clock.runFor(32);
    await expect(radar).toHaveAttribute('data-radar-smokes', '0');

    const eventSelect = page.getByLabel('语义事件', { exact: true });
    await eventSelect.selectOption(seekAnchor!.id);
    await expect(replay).toHaveAttribute('data-replay-cursor', String(seekAnchor!.sequence));
    await page.clock.runFor(300);
    const directSeekImage = await page
      .locator('[data-hud-widget="team-ct-rail"]')
      .screenshot({ animations: 'disabled' });

    await page.getByRole('button', { name: '重播' }).click();
    await expect(replay).toHaveAttribute('data-replay-cursor', '587');
    await page.getByRole('button', { name: '播放' }).click();
    await page.clock.runFor(seekAnchor!.scheduledElapsedUs / 1_000);
    await expect(replay).toHaveAttribute('data-replay-cursor', String(seekAnchor!.sequence));
    await page.getByRole('button', { name: '暂停' }).click();
    await page.clock.runFor(300);
    const replayToAnchorImage = await page
      .locator('[data-hud-widget="team-ct-rail"]')
      .screenshot({ animations: 'disabled' });
    expect(replayToAnchorImage).toEqual(directSeekImage);

    await eventSelect.selectOption(smokeStart!.id);
    await expect(replay).toHaveAttribute('data-replay-cursor', String(smokeStart!.sequence));
    await page.clock.runFor(32);
    await expect(radar).not.toHaveAttribute('data-radar-smokes', '0');
    await eventSelect.selectOption(smokeEnd!.id);
    await expect(replay).toHaveAttribute('data-replay-cursor', String(smokeEnd!.sequence));
    await page.clock.runFor(32);
    await expect(radar).toHaveAttribute('data-radar-smokes', '0');
  });
});
