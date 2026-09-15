import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type {
  CaptureFrameInput,
  CaptureRecorder,
  RecorderHealth,
} from '../src/telemetry/capture-recorder.js';

const GSI_TOKEN = 'qualification-gsi-token';
const CONTROL_TOKEN = 'qualification-control-token';

class FakeRecorder implements CaptureRecorder {
  readonly captureId = 'qualification-test-capture';
  readonly inputs: CaptureFrameInput[] = [];
  private closed = false;

  tryRecord(input: CaptureFrameInput): boolean {
    this.inputs.push(input);
    return true;
  }

  getHealth(): RecorderHealth {
    return {
      state: this.closed ? 'closed' : 'recording',
      pendingFrames: 0,
      pendingBytes: 0,
      maxPendingFrames: 128,
      maxPendingBytes: 2 * 1024 * 1024,
      frameCount: this.inputs.length,
      droppedFrames: 0,
      incomplete: false,
    };
  }

  finalize(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function payload(mapName = 'de_ancient'): Record<string, unknown> {
  return {
    map: { name: mapName, phase: 'live' },
    round: { phase: 'freezetime' },
  };
}

async function closeApp(app: FastifyInstance | undefined): Promise<void> {
  if (app !== undefined) await app.close();
}

describe('qualification-only Companion surface', () => {
  let app: FastifyInstance | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
    if (temporaryDirectory !== undefined)
      await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  });

  it('is absent unless qualification mode is explicitly enabled', async () => {
    app = buildApp({ gsiToken: GSI_TOKEN, recorder: new FakeRecorder() });

    expect((await app.inject({ method: 'GET', url: '/qualification' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: '/qualification/next-map-execution' })).statusCode,
    ).toBe(404);
  });

  it('authenticates the local control surface and rejects unbounded markers', async () => {
    app = buildApp({
      gsiToken: GSI_TOKEN,
      recorder: new FakeRecorder(),
      qualificationMode: true,
      qualificationControlToken: CONTROL_TOKEN,
      qualificationRunId: 'qualification-test-run',
    });

    expect((await app.inject({ method: 'GET', url: '/qualification' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/qualification/status' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/qualification/marker',
          headers: { 'x-qualification-token': CONTROL_TOKEN },
          payload: { kind: 'free-form-not-allowed' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('hands the final runtime snapshot to the qualification launcher before shutdown', async () => {
    let finishDebug: unknown;
    app = buildApp({
      gsiToken: GSI_TOKEN,
      recorder: new FakeRecorder(),
      qualificationMode: true,
      qualificationControlToken: CONTROL_TOKEN,
      qualificationRunId: 'qualification-finish-run',
      onQualificationFinish: ({ debug }) => {
        finishDebug = debug;
      },
    });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          payload: { auth: { token: GSI_TOKEN }, ...payload() },
        })
      ).statusCode,
    ).toBe(204);
    const response = await app.inject({
      method: 'POST',
      url: '/qualification/finish',
      headers: { 'x-qualification-token': CONTROL_TOKEN },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'stopping',
      finalizationPath: '/qualification/finalization',
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finishDebug).toMatchObject({ freshness: 'fresh', raw: { current: { sequence: 0 } } });
  });

  it('records the page stop boundary before freshness becomes stale', async () => {
    app = buildApp({
      gsiToken: GSI_TOKEN,
      recorder: new FakeRecorder(),
      qualificationMode: true,
      qualificationControlToken: CONTROL_TOKEN,
      qualificationRunId: 'qualification-stop-run',
    });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          payload: { auth: { token: GSI_TOKEN }, ...payload() },
        })
      ).statusCode,
    ).toBe(204);
    const headers = { 'x-qualification-token': CONTROL_TOKEN };
    await app.inject({
      method: 'POST',
      url: '/qualification/marker',
      headers,
      payload: { kind: 'demo-a-live' },
    });

    const stopped = await app.inject({
      method: 'POST',
      url: '/qualification/stop',
      headers,
    });
    expect(stopped.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/qualification/status',
          headers,
        })
      ).json(),
    ).toMatchObject({
      markers: ['demo-a-live', 'demo-a-stopped', 'cs2-closed'],
      freshness: 'fresh',
    });
  });

  it('records the explicit reset and clears old debug telemetry without changing identity', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'rivalhub-qualification-'));
    let monotonicMs = 100;
    const recorder = new FakeRecorder();
    app = buildApp({
      gsiToken: GSI_TOKEN,
      recorder,
      producerInstanceId: 'qualification-producer',
      qualificationMode: true,
      qualificationControlToken: CONTROL_TOKEN,
      qualificationRunId: 'qualification-test-run',
      qualificationScenarioPath: join(temporaryDirectory, 'scenario.jsonl'),
      qualificationClock: {
        now: () => ({
          monotonicMs,
          utc: new Date(Date.parse('2026-09-15T00:00:00.000Z') + monotonicMs).toISOString(),
        }),
      },
      debugClock: { nowMonotonicMs: () => monotonicMs },
      clock: {
        now: () => {
          return {
            receivedAt: new Date(
              Date.parse('2026-09-15T00:00:00.000Z') + monotonicMs,
            ).toISOString(),
            receivedMonotonicMs: monotonicMs,
          };
        },
      },
    });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/gsi',
          payload: { auth: { token: GSI_TOKEN }, ...payload() },
        })
      ).statusCode,
    ).toBe(204);

    monotonicMs = 20_101;
    const stale = await app.inject({
      method: 'GET',
      url: '/qualification/status',
      headers: { 'x-qualification-token': CONTROL_TOKEN },
    });
    expect(stale.json()).toMatchObject({
      runId: 'qualification-test-run',
      gsi: 'silent',
      freshness: 'stale',
      markers: ['runtime-stale'],
    });

    monotonicMs = 20_200;
    const reset = await app.inject({
      method: 'POST',
      url: '/qualification/next-map-execution',
      headers: { 'x-qualification-token': CONTROL_TOKEN },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      ok: true,
      reason: 'operator-correction',
      producerInstanceId: 'qualification-producer',
      sourceGeneration: 0,
      previousMapEpoch: 1,
      mapEpoch: 2,
      runtimeSeq: 2,
      programTelemetryCleared: true,
      disposition: { kind: 'accepted', reason: 'map-execution-reset' },
    });

    const debug = await app.inject({ method: 'GET', url: '/debug/runtime' });
    const debugBody = debug.json<{
      readonly raw: { readonly current: unknown };
      readonly normalized: { readonly current: unknown };
      readonly runtime: { readonly current: Record<string, unknown> };
    }>();
    expect(debugBody).toMatchObject({
      producerInstanceId: 'qualification-producer',
      sourceGeneration: 0,
      raw: { current: null },
      normalized: { current: null },
      runtime: { current: { map: { epoch: 2 } } },
    });
    expect(debugBody.runtime.current.programTelemetry).toBeUndefined();

    const scenario = await readFile(join(temporaryDirectory, 'scenario.jsonl'), 'utf8');
    const markers = scenario
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            kind: string;
            phase?: string;
            mapEpoch: number;
            reset?: { programTelemetryCleared?: boolean };
          },
      );
    expect(markers).toEqual([
      expect.objectContaining({ kind: 'runtime-stale' }),
      expect.objectContaining({ kind: 'next-execution', phase: 'before', mapEpoch: 1 }),
      expect.objectContaining({
        kind: 'next-execution',
        phase: 'after',
        mapEpoch: 2,
      }),
    ]);
    expect(markers[2]?.reset?.programTelemetryCleared).toBe(true);
  });
});
