import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('Companion health endpoint', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns recorder process health without exposing secrets', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({
      status: 'degraded',
      recorder: {
        state: 'degraded',
        pendingFrames: 0,
        pendingBytes: 0,
        maxPendingFrames: 128,
        maxPendingBytes: 2 * 1024 * 1024,
        frameCount: 0,
        droppedFrames: 0,
        incomplete: true,
        lastErrorCode: 'recorder_not_configured',
      },
    });
  });
});
