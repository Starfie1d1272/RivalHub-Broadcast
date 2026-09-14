import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCapture } from '@rivalhub-broadcast/testkit';

import { buildApp } from '../src/app.js';
import { createCaptureRecorder, type CaptureRecorder } from '../src/telemetry/capture-recorder.js';
import { PRODUCTION_GSI_CONFIG, type GsiClock } from '../src/telemetry/gsi-ingress.js';

const TOKEN = 'integration-gsi-token';

describe('Companion GSI capture integration', () => {
  let app: FastifyInstance | undefined;
  let root: string | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('writes a verifier-compatible final Capture V1 bundle through the real adapter path', async () => {
    root = await mkdtemp(join(tmpdir(), 'rivalhub-companion-integration-'));
    const recorder: CaptureRecorder = await createCaptureRecorder({
      captureDir: root,
      captureId: 'integration-capture',
      createdAt: '2026-09-14T06:00:00.000Z',
      broadcastCommit: 'integration-commit',
      gsiConfig: PRODUCTION_GSI_CONFIG,
      monotonicNow: () => 100,
    });
    const clockSamples = [
      { receivedAt: '2026-09-14T06:00:00.100Z', receivedMonotonicMs: 100.1 },
      { receivedAt: '2026-09-14T06:00:00.200Z', receivedMonotonicMs: 100.2 },
    ];
    let clockIndex = 0;
    const clock: GsiClock = {
      now: () => {
        const sample = clockSamples[clockIndex];
        clockIndex += 1;
        if (sample === undefined) throw new Error('unexpected clock sample');
        return sample;
      },
    };
    const observations: number[] = [];
    app = buildApp({
      gsiToken: TOKEN,
      recorder,
      clock,
      telemetrySink: (result) => {
        if (result.ok) observations.push(result.observation.receive.sequence);
      },
    });

    for (const mapName of ['de_nuke', 'de_ancient']) {
      const response = await app.inject({
        method: 'POST',
        url: '/gsi',
        payload: {
          auth: { token: TOKEN },
          provider: { name: 'CS2', timestamp: '1.25' },
          map: { name: mapName, phase: 'live' },
        },
      });
      expect(response.statusCode).toBe(204);
    }

    await app.close();
    app = undefined;

    const verified = await verifyCapture(join(root, 'integration-capture'));
    expect(verified.manifest).toMatchObject({
      formatVersion: 1,
      captureId: 'integration-capture',
      broadcastCommit: 'integration-commit',
      scenario: 'production-gsi-session',
      complete: true,
      frameCount: 2,
      droppedFrames: 0,
      gsiConfig: PRODUCTION_GSI_CONFIG,
    });
    expect(observations).toEqual([0, 1]);
    expect(await readFile(join(root, 'integration-capture', 'frames.jsonl'), 'utf8')).not.toContain(
      TOKEN,
    );
    await expect(access(join(root, 'integration-capture.partial'))).rejects.toThrow();
  });
});
