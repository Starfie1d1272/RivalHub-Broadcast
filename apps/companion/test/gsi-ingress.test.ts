import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  GSI_BODY_LIMIT_BYTES,
  type GsiClock,
  type TelemetrySink,
} from '../src/telemetry/gsi-ingress.js';
import type {
  CaptureFrameInput,
  CaptureRecorder,
  RecorderHealth,
} from '../src/telemetry/capture-recorder.js';

const TOKEN = 'test-gsi-token';

class FakeRecorder implements CaptureRecorder {
  readonly captureId = 'fake-capture';
  readonly inputs: CaptureFrameInput[] = [];
  readonly offered: Buffer[] = [];

  constructor(private readonly admissionResult = true) {}

  serializeFrame(input: CaptureFrameInput): Buffer {
    this.inputs.push(input);
    return Buffer.from(`${JSON.stringify(input)}\n`, 'utf8');
  }

  offer(buffer: Buffer): boolean {
    this.offered.push(buffer);
    return this.admissionResult;
  }

  getHealth(): RecorderHealth {
    return {
      state: this.admissionResult ? 'recording' : 'degraded',
      pendingFrames: 0,
      pendingBytes: 0,
      maxPendingFrames: 128,
      maxPendingBytes: 2 * 1024 * 1024,
      frameCount: 0,
      droppedFrames: this.admissionResult ? 0 : this.offered.length,
      incomplete: !this.admissionResult,
      ...(this.admissionResult ? {} : { lastErrorCode: 'recorder_overflow' }),
    };
  }

  async finalize(): Promise<void> {}
}

function makeBodyOfSize(size: number): string {
  const empty = JSON.stringify({ auth: { token: TOKEN }, filler: '' });
  const fillerLength = size - Buffer.byteLength(empty);
  if (fillerLength < 0) throw new Error('requested body is smaller than its fixed prefix');
  const body = JSON.stringify({ auth: { token: TOKEN }, filler: 'x'.repeat(fillerLength) });
  if (Buffer.byteLength(body) !== size) throw new Error('failed to construct exact body size');
  return body;
}

function createClock(
  samples: Array<{ receivedAt: string; receivedMonotonicMs: number }>,
): GsiClock {
  let index = 0;
  return {
    now: () => {
      const sample = samples[index];
      index += 1;
      if (sample === undefined) throw new Error('unexpected clock sample');
      return sample;
    },
  };
}

describe('Companion GSI ingress', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('accepts authenticated objects, shares one receive sample, and strips top-level auth', async () => {
    const recorder = new FakeRecorder();
    const received: Array<{ sequence: number; receivedAt: string; receivedMonotonicMs: number }> =
      [];
    const sink: TelemetrySink = (result) => {
      if (result.ok) received.push(result.observation.receive);
    };
    app = buildApp({
      gsiToken: TOKEN,
      recorder,
      clock: createClock([{ receivedAt: '2026-09-14T06:00:00.000Z', receivedMonotonicMs: 10 }]),
      telemetrySink: sink,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/gsi',
      payload: {
        auth: { token: TOKEN },
        provider: { name: 'Counter-Strike: Global Offensive', appid: 730 },
        nested: { auth: { token: 'nested-value' } },
      },
    });

    expect(response.statusCode).toBe(204);
    expect(recorder.inputs).toHaveLength(1);
    expect(recorder.inputs[0]).toMatchObject({
      sequence: 0,
      receivedAt: '2026-09-14T06:00:00.000Z',
      receivedMonotonicMs: 10,
    });
    expect(recorder.inputs[0]?.payload).toEqual({
      provider: { name: 'Counter-Strike: Global Offensive', appid: 730 },
      nested: { auth: { token: 'nested-value' } },
    });
    expect(JSON.stringify(recorder.inputs[0])).not.toContain(TOKEN);
    expect(received).toEqual([
      { sequence: 0, receivedAt: '2026-09-14T06:00:00.000Z', receivedMonotonicMs: 10 },
    ]);
  });

  it('does not consume accepted sequence for rejected requests', async () => {
    const recorder = new FakeRecorder();
    app = buildApp({
      gsiToken: TOKEN,
      recorder,
      clock: createClock([
        { receivedAt: '2026-09-14T06:00:00.000Z', receivedMonotonicMs: 10 },
        { receivedAt: '2026-09-14T06:00:01.000Z', receivedMonotonicMs: 20 },
      ]),
    });

    expect(
      (await app.inject({ method: 'POST', url: '/gsi', payload: { provider: {} } })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          payload: { auth: { token: 'wrong' }, provider: {} },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          headers: { 'content-type': 'application/json' },
          payload: '{"auth":',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          headers: { 'content-type': 'text/plain' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (await app.inject({ method: 'POST', url: '/gsi', payload: { auth: { token: TOKEN } } }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          payload: { auth: { token: TOKEN }, provider: {} },
        })
      ).statusCode,
    ).toBe(204);

    expect(recorder.inputs.map((input) => input.sequence)).toEqual([0, 1]);
  });

  it('rejects non-object roots and enforces the 64 KiB route body limit', async () => {
    const recorder = new FakeRecorder();
    app = buildApp({
      gsiToken: TOKEN,
      recorder,
      clock: createClock([{ receivedAt: '2026-09-14T06:00:00.000Z', receivedMonotonicMs: 10 }]),
    });

    expect((await app.inject({ method: 'POST', url: '/gsi', payload: [] })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          headers: { 'content-type': 'application/json' },
          payload: 'null',
        })
      ).statusCode,
    ).toBe(400);

    const atLimit = await app.inject({
      method: 'POST',
      url: '/gsi',
      headers: { 'content-type': 'application/json' },
      payload: makeBodyOfSize(GSI_BODY_LIMIT_BYTES),
    });
    expect(atLimit.statusCode).toBe(204);

    const overLimit = await app.inject({
      method: 'POST',
      url: '/gsi',
      headers: { 'content-type': 'application/json' },
      payload: makeBodyOfSize(GSI_BODY_LIMIT_BYTES + 1),
    });
    expect(overLimit.statusCode).toBe(413);
  });

  it('keeps accepted HTTP and sink delivery alive when recorder admission or sink fails', async () => {
    const recorder = new FakeRecorder(false);
    let sinkCalls = 0;
    app = buildApp({
      gsiToken: TOKEN,
      recorder,
      telemetrySink: () => {
        sinkCalls += 1;
        throw new Error('sink failure');
      },
      clock: createClock([{ receivedAt: '2026-09-14T06:00:00.000Z', receivedMonotonicMs: 10 }]),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/gsi',
      payload: { auth: { token: TOKEN }, map: { name: 'de_nuke' } },
    });

    expect(response.statusCode).toBe(204);
    expect(sinkCalls).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      status: 'degraded',
      recorder: { state: 'degraded', droppedFrames: 1, incomplete: true },
    });
  });
});
