import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEFAULT_HUD_COMPOSITE_FIXTURES } from '../../apps/web/src/program/fixtures/default-hud-composite-ids.js';

async function assertBox(
  locator: Locator,
  expected: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
) {
  const actual = await locator.boundingBox();
  expect(actual).not.toBeNull();
  expect(actual!.x).toBe(expected.x);
  expect(actual!.y).toBe(expected.y);
  expect(actual!.width).toBe(expected.width);
  expect(actual!.height).toBe(expected.height);
}

async function assertHudGeometry(page: Page, requireBothUtilitySides = false) {
  await assertBox(page.locator('[data-program-canvas="true"]'), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  await assertBox(page.locator('[data-hud-widget="series-strip"]'), {
    x: 44,
    y: 36,
    width: 400,
    height: 72,
  });
  await assertBox(page.locator('[data-hud-widget="radar"]'), {
    x: 44,
    y: 116,
    width: 400,
    height: 400,
  });
  await assertBox(page.locator('[data-hud-widget="team-ct-rail"]'), {
    x: 0,
    y: 524,
    width: 440,
    height: 478,
  });
  await assertBox(page.locator('[data-hud-widget="team-t-rail"]'), {
    x: 1480,
    y: 524,
    width: 440,
    height: 478,
  });
  await assertBox(page.locator('[data-hud-widget="top-score-bar"]'), {
    x: 720,
    y: 36,
    width: 480,
    height: 152,
  });
  await assertBox(page.locator('[data-hud-widget="focused-player"]'), {
    x: 780,
    y: 876,
    width: 360,
    height: 176,
  });

  const scoreWidget = page.locator('[data-match-header-widget="top-score-bar"]');
  await assertBox(scoreWidget.locator('.match-header__score-shell'), {
    x: 720,
    y: 36,
    width: 480,
    height: 74,
  });
  await assertBox(scoreWidget.locator('.match-header__score-zone--logo-a'), {
    x: 720,
    y: 36,
    width: 72,
    height: 74,
  });
  await assertBox(scoreWidget.locator('.match-header__score-zone--score-a'), {
    x: 792,
    y: 36,
    width: 104,
    height: 74,
  });
  await assertBox(scoreWidget.locator('.match-header__center'), {
    x: 896,
    y: 36,
    width: 128,
    height: 74,
  });
  await assertBox(scoreWidget.locator('.match-header__score-zone--score-b'), {
    x: 1024,
    y: 36,
    width: 104,
    height: 74,
  });
  await assertBox(scoreWidget.locator('.match-header__score-zone--logo-b'), {
    x: 1128,
    y: 36,
    width: 72,
    height: 74,
  });

  const mapCards = page.locator('[data-match-header-widget="series-strip"] [data-map-order]');
  const mapRows = await mapCards.evaluateAll((cards) =>
    cards.map((card) => {
      const art = card.querySelector('.match-header__series-map-art')!.getBoundingClientRect();
      const name = card.querySelector('.match-header__series-map-name')!.getBoundingClientRect();
      const status = card
        .querySelector('.match-header__series-map-status')!
        .getBoundingClientRect();
      const box = card.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        art: { x: art.x, y: art.y, width: art.width, height: art.height },
        name: { x: name.x, y: name.y, height: name.height },
        status: { x: status.x, y: status.y, height: status.height },
      };
    }),
  );
  expect(mapRows.length).toBeGreaterThan(0);
  for (const map of mapRows) {
    expect(map.height).toBe(72);
    expect(map.art).toEqual({ x: map.x, y: map.y, width: map.width, height: 44 });
    expect(map.name).toEqual({ x: map.x, y: map.y + 44, height: 14 });
    expect(map.status).toEqual({ x: map.x, y: map.y + 58, height: 14 });
  }

  for (const side of ['CT', 'T'] as const) {
    const rail = page.locator(`[data-player-rail="${side}"]`);
    const cards = rail.locator('[data-player-card], .player-rail__empty-card');
    await expect(cards).toHaveCount(5);
    const cardBoxes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    expect(cardBoxes.map(({ height }) => height)).toEqual([78, 78, 78, 78, 78]);
    expect(cardBoxes.map(({ y }) => y)).toEqual([600, 681, 762, 843, 924]);
  }

  const utilityEdges = await page.locator('[data-player-card]').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const utility = card.querySelector('.player-rail__utility-icons');
      const health = card.querySelector('.player-rail__health-bar');
      const icons = Array.from(
        card.querySelectorAll('.player-rail__utility-item .player-rail__icon'),
      ).filter((icon) => {
        const style = getComputedStyle(icon);
        return (
          icon.getClientRects().length > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
        );
      });
      if (utility === null || health === null || icons.length === 0) return [];
      const side = card.getAttribute('data-physical-side');
      const healthRect = health.getBoundingClientRect();
      const iconRects = icons.map((icon) => icon.getBoundingClientRect());
      const edge =
        side === 'left'
          ? Math.max(...iconRects.map((rect) => rect.right))
          : Math.min(...iconRects.map((rect) => rect.left));
      const target = side === 'left' ? healthRect.right : healthRect.left;
      return [{ side, edge, target, delta: edge - target }];
    }),
  );
  for (const measured of utilityEdges) {
    expect(
      Math.abs(measured.delta),
      `${measured.side} utility edge ${measured.edge} should align with HP track ${measured.target}`,
    ).toBeLessThanOrEqual(1);
  }
  if (requireBothUtilitySides) {
    expect(new Set(utilityEdges.map(({ side }) => side))).toEqual(new Set(['left', 'right']));
  }

  const liveBody = page
    .locator('[data-hud-widget="team-ct-rail"] [data-life-state="alive"] .player-rail__body')
    .first();
  const bodyRows = await liveBody.evaluate((body) => {
    const names = [
      '.player-rail__identity',
      '.player-rail__health-bar',
      '.player-rail__combat',
      '.player-rail__bottom',
    ];
    return names.map((selector) => {
      const rect = body.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
  });
  expect(bodyRows.map(({ height }) => height)).toEqual([32, 3, 25, 18]);
  expect(bodyRows.map(({ top }) => top)).toEqual([
    bodyRows[0]!.top,
    bodyRows[0]!.top + 32,
    bodyRows[0]!.top + 35,
    bodyRows[0]!.top + 60,
  ]);

  await assertBox(page.locator('.focused-player__identity'), {
    x: 780,
    y: 876,
    width: 360,
    height: 42,
  });
  const focusedDead = (await page.locator('.focused-player').getAttribute('data-dead')) === 'true';
  if (!focusedDead) {
    await assertBox(page.locator('.focused-player__action'), {
      x: 780,
      y: 918,
      width: 360,
      height: 82,
    });
    await assertBox(page.locator('.focused-player__media'), {
      x: 792,
      y: 918,
      width: 82,
      height: 82,
    });
    await assertBox(page.locator('.focused-player__active'), {
      x: 882,
      y: 918,
      width: 148,
      height: 82,
    });
    await assertBox(page.locator('.focused-player__ammo'), {
      x: 1038,
      y: 918,
      width: 90,
      height: 82,
    });
    await assertBox(page.locator('.focused-player__vitals'), {
      x: 780,
      y: 1000,
      width: 360,
      height: 52,
    });
  } else {
    await assertBox(page.locator('.focused-player__action'), {
      x: 780,
      y: 918,
      width: 360,
      height: 134,
    });
    await assertBox(page.locator('.focused-player__media'), {
      x: 792,
      y: 944,
      width: 82,
      height: 82,
    });
    await assertBox(page.locator('.focused-player__dead-state'), {
      x: 882,
      y: 918,
      width: 246,
      height: 134,
    });
    await expect(page.locator('.focused-player__vitals')).toBeHidden();
  }
}

test.setTimeout(180_000);

test('Default V1 composite matrix uses the frozen 1920 by 1080 geometry', async ({ page }) => {
  for (const fixtureId of DEFAULT_HUD_COMPOSITE_FIXTURES) {
    await page.goto(`/__visual/program/${fixtureId}`);
    await expect(page.locator(`[data-program-fixture-id="${fixtureId}"]`)).toHaveCount(1);
    await expect(page.locator('[data-gameplay-hud="true"]')).toHaveCount(1);
    for (const widget of [
      'series-strip',
      'radar',
      'team-ct-rail',
      'team-t-rail',
      'top-score-bar',
      'focused-player',
    ]) {
      await expect(page.locator(`[data-hud-widget="${widget}"]`)).toHaveCount(1);
    }
    await expect(page.locator('canvas.radar')).toHaveAttribute('data-radar-state', 'live');
    await expect(page.locator('canvas.radar')).toHaveAttribute('data-radar-artwork', 'ready');
    await assertHudGeometry(page, fixtureId === 'default-live-5v5');

    if (fixtureId === 'default-missing-logo') {
      await expect(page.locator('[data-team-logo-slot] img')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-team-logo-slot] img')).toHaveCount(2);
    }

    if (fixtureId === 'default-avatar-present') {
      await expect(page.locator('[data-player-card][data-avatar="true"]')).toHaveCount(10);
      await expect(page.locator('.player-rail__avatar img')).toHaveCount(10);
      const left = page.locator('[data-hud-widget="team-ct-rail"] [data-player-card]').first();
      const right = page.locator('[data-hud-widget="team-t-rail"] [data-player-card]').first();
      await assertBox(left.locator('[data-card-part="avatar"]'), {
        x: 0,
        y: 600,
        width: 78,
        height: 78,
      });
      await assertBox(left.locator('[data-card-part="body"]'), {
        x: 78,
        y: 600,
        width: 362,
        height: 78,
      });
      await assertBox(left.locator('[data-card-part="observer-endcap"]'), {
        x: 412,
        y: 604,
        width: 24,
        height: 24,
      });
      await assertBox(right.locator('[data-card-part="observer-endcap"]'), {
        x: 1484,
        y: 604,
        width: 24,
        height: 24,
      });
      await assertBox(right.locator('[data-card-part="body"]'), {
        x: 1480,
        y: 600,
        width: 362,
        height: 78,
      });
      await assertBox(right.locator('[data-card-part="avatar"]'), {
        x: 1842,
        y: 600,
        width: 78,
        height: 78,
      });
    }
    if (fixtureId === 'default-avatar-missing') {
      await expect(page.locator('[data-player-card][data-avatar="false"]')).toHaveCount(10);
      await expect(page.locator('.player-rail__avatar')).toHaveCount(10);
      await expect(page.locator('.player-rail__avatar img')).toHaveCount(0);
      await expect(page.locator('.player-rail__avatar-placeholder')).toHaveCount(0);
      await assertBox(
        page
          .locator('[data-hud-widget="team-ct-rail"] [data-player-card]')
          .first()
          .locator('[data-card-part="avatar"]'),
        { x: 0, y: 600, width: 78, height: 78 },
      );
      await assertBox(
        page
          .locator('[data-hud-widget="team-ct-rail"] [data-player-card]')
          .first()
          .locator('[data-card-part="body"]'),
        { x: 78, y: 600, width: 362, height: 78 },
      );
      await assertBox(
        page
          .locator('[data-hud-widget="team-ct-rail"] [data-player-card]')
          .first()
          .locator('[data-card-part="observer-endcap"]'),
        { x: 412, y: 604, width: 24, height: 24 },
      );
      await assertBox(
        page
          .locator('[data-hud-widget="team-t-rail"] [data-player-card]')
          .first()
          .locator('[data-card-part="observer-endcap"]'),
        { x: 1484, y: 604, width: 24, height: 24 },
      );
      await assertBox(
        page
          .locator('[data-hud-widget="team-t-rail"] [data-player-card]')
          .first()
          .locator('[data-card-part="body"]'),
        { x: 1480, y: 600, width: 362, height: 78 },
      );
      await assertBox(
        page
          .locator('[data-hud-widget="team-t-rail"] [data-player-card]')
          .first()
          .locator('[data-card-part="avatar"]'),
        { x: 1842, y: 600, width: 78, height: 78 },
      );
    }
    if (fixtureId === 'default-freezetime') {
      await expect(page.locator('[data-team-summary][data-summary-visible="true"]')).toHaveCount(2);
      expect(
        await page
          .locator('.player-rail__summary')
          .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).height)),
      ).toEqual(['48px', '48px']);
      const summaries = page.locator('.player-rail__summary');
      await assertBox(summaries.first(), { x: 0, y: 524, width: 440, height: 48 });
      await assertBox(summaries.nth(1), { x: 1480, y: 524, width: 440, height: 48 });
    }
    if (fixtureId === 'default-observed') {
      await expect(page.locator('[data-player-card][data-observed="true"]')).toHaveCount(1);
      expect(
        await page
          .locator('.player-rail__card.is-observed .player-rail__endcap')
          .first()
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      ).toBe('rgb(243, 246, 250)');
    }
    if (fixtureId === 'default-dead') {
      const dead = page.locator('[data-player-card][data-life-state="dead"]');
      await expect(dead).not.toHaveCount(0);
      const firstDead = dead.first();
      await expect(firstDead.locator('[data-dead-stats]')).toContainText('ADR');
      await expect(firstDead.locator('[data-dead-stats]')).toContainText('DMG');
      await expect(firstDead.locator('.player-rail__kd')).toHaveCount(1);
      await expect(firstDead.locator('.player-rail__combat')).toHaveCount(0);
      await expect(firstDead.locator('.player-rail__kad')).toHaveCount(0);
    }
    if (fixtureId === 'default-low-hp') {
      await expect(
        page.locator('.player-rail__card.is-low-health [data-health-value="true"]'),
      ).toHaveText('20');
    }
    if (fixtureId === 'default-planted' || fixtureId === 'default-critical') {
      await expect(page.locator('[data-objective-mode="planted"]')).toHaveCount(1);
      await expect(page.locator('[data-objective-track="fuse"]')).toHaveCount(1);
      await assertBox(page.locator('[data-objective-track="fuse"]'), {
        x: 728,
        y: 116,
        width: 464,
        height: 6,
      });
    }
    if (fixtureId === 'default-critical') {
      await expect(
        page.locator('.objective-center[data-danger="true"] .objective-center__led'),
      ).toHaveCount(1);
    }
    if (fixtureId === 'default-defusing') {
      await expect(page.locator('[data-objective-mode="defusing"]')).toHaveCount(1);
      await expect(page.locator('[data-objective-track]')).toHaveCount(2);
    }
    if (fixtureId === 'default-timeout') {
      const timeout = page.locator('[data-timeout-panel="true"]');
      await expect(timeout).toHaveCount(1);
      await expect(timeout).toContainText('TACTICAL TIMEOUT');
      await expect(timeout).toContainText('LEFT');
    }
    if (fixtureId === 'default-tech-pause') {
      await expect(page.locator('[data-tech-pause="true"]')).toContainText('TECH PAUSE');
    }
    if (fixtureId === 'default-halftime') {
      await expect(
        page.locator('[data-hud-widget="team-ct-rail"] [data-player-rail]'),
      ).toHaveAttribute('data-entrant', 'a');
      await expect(
        page.locator('[data-hud-widget="team-t-rail"] [data-player-rail]'),
      ).toHaveAttribute('data-entrant', 'b');
    }
    if (fixtureId === 'default-nuke-multifloor') {
      await expect(page.locator('canvas.radar')).toHaveAttribute(
        'data-radar-compositor',
        'ewc-detached-floor-shared-calibration',
      );
      await expect(page.locator('canvas.radar')).toHaveAttribute(
        'data-radar-coordinate-space',
        'overview-1024',
      );
      await expect(page.locator('canvas.radar')).toHaveAttribute(
        'data-radar-layers',
        'simultaneous',
      );
      await expect(page.locator('canvas.radar')).toHaveAttribute(
        'data-radar-visible-floors',
        'upper,lower',
      );
    }
    if (fixtureId === 'default-missing-logo') {
      await expect(page.locator('[data-team-logo-slot] img')).toHaveCount(0);
      await expect(page.locator('.match-header__team-logo-placeholder')).toHaveCount(0);
    }
  }
});
