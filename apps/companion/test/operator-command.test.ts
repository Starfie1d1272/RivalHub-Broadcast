import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { registerOperatorCommandRoutes } from '../src/operator/controller.js';

describe('operator SeriesProgress command ingress', () => {
  it('requires the local operator credential and returns a command acknowledgement', async () => {
    const app = Fastify();
    const execute = vi.fn(() => ({
      ok: true,
      progress: null,
      code: 'operator_bind_applied' as const,
    }));
    registerOperatorCommandRoutes(app, {
      controlToken: 'operator-secret',
      execute,
    });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/operator/series/bind',
          payload: {
            kind: 'bind-current-map-execution-to-series-map',
            mapOrder: 1,
            reason: '现场确认当前地图对应第一图',
          },
        })
      ).statusCode,
    ).toBe(401);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/operator/series/bind',
          headers: { 'x-operator-token': 'operator-secret' },
          payload: { kind: 'bind-current-map-execution-to-series-map', mapOrder: 0, reason: 'bad' },
        })
      ).statusCode,
    ).toBe(400);

    const response = await app.inject({
      method: 'POST',
      url: '/operator/series/bind',
      headers: { 'x-operator-token': 'operator-secret' },
      payload: {
        kind: 'bind-current-map-execution-to-series-map',
        mapOrder: 1,
        reason: '现场确认当前地图对应第一图',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      code: 'operator_bind_applied',
      series: null,
    });
    expect(execute).toHaveBeenCalledWith({
      kind: 'bind-current-map-execution-to-series-map',
      mapOrder: 1,
      reason: '现场确认当前地图对应第一图',
    });

    await app.close();
  });

  it('is wired into the Companion app when an operator token is configured', async () => {
    const app = buildApp({ operatorControlToken: 'operator-secret' });
    const response = await app.inject({
      method: 'POST',
      url: '/operator/series/bind',
      headers: {
        origin: 'http://127.0.0.1',
        'x-operator-token': 'operator-secret',
      },
      payload: {
        kind: 'bind-current-map-execution-to-series-map',
        mapOrder: 1,
        reason: '等待比赛上下文时的 ingress smoke',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ ok: false, code: 'series_unbound' });
    await app.close();
  });
});
