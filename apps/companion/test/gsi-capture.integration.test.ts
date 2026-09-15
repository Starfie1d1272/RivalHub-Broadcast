import { access, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  iterateCaptureFrames,
  verifyCapture,
  type CaptureFrameV1,
} from '@rivalhub-broadcast/testkit';

import { buildApp } from '../src/app.js';
import {
  createCaptureRecorder,
  type CaptureFileHandle,
  type CaptureRecorder,
} from '../src/telemetry/capture-recorder.js';
import { PRODUCTION_GSI_CONFIG, type GsiClock } from '../src/telemetry/gsi-ingress.js';

const TOKEN = 'integration-gsi-token';
const RICH_OBSERVER_FIXTURE = resolve(
  process.cwd(),
  'fixtures/gsi/semantic/observer/rich-live-state',
);

interface BlockedFileWriter extends CaptureFileHandle {
  readonly firstWriteStarted: Promise<void>;
  releaseFirstWrite(): void;
}

async function createBlockedFileWriter(framesPath: string): Promise<BlockedFileWriter> {
  const fileHandle = await open(framesPath, 'wx');
  let firstWrite = true;
  let firstWriteStartedResolve: (() => void) | undefined;
  let firstWriteRelease: (() => void) | undefined;
  const firstWriteStarted = new Promise<void>((resolvePromise) => {
    firstWriteStartedResolve = resolvePromise;
  });
  const firstWriteGate = new Promise<void>((resolvePromise) => {
    firstWriteRelease = resolvePromise;
  });

  return {
    firstWriteStarted,
    releaseFirstWrite() {
      firstWriteRelease?.();
      firstWriteRelease = undefined;
    },
    async write(buffer, position) {
      if (firstWrite) {
        firstWrite = false;
        firstWriteStartedResolve?.();
        await firstWriteGate;
      }
      const result = await fileHandle.write(buffer, 0, buffer.length, position);
      return result.bytesWritten;
    },
    sync: () => fileHandle.sync(),
    truncate: (length) => fileHandle.truncate(length),
    close: () => fileHandle.close(),
  };
}

async function makeBlockedRecorder(
  root: string,
  captureId: string,
): Promise<{ recorder: CaptureRecorder; writer: BlockedFileWriter }> {
  let writer: BlockedFileWriter | undefined;
  const recorder = await createCaptureRecorder({
    captureDir: root,
    captureId,
    createdAt: '2026-09-14T06:00:00.000Z',
    broadcastCommit: 'integration-commit',
    gsiConfig: PRODUCTION_GSI_CONFIG,
    monotonicNow: () => 100,
    writerFactory: async (framesPath) => {
      writer = await createBlockedFileWriter(framesPath);
      return writer;
    },
  });
  if (writer === undefined) throw new Error('blocked writer was not created');
  return { recorder, writer };
}

function createClock(): GsiClock {
  let index = 0;
  return {
    now: () => {
      const currentIndex = index;
      index += 1;
      return {
        receivedAt: new Date(
          Date.parse('2026-09-14T06:00:00.000Z') + currentIndex * 40,
        ).toISOString(),
        receivedMonotonicMs: 100 + currentIndex * 40,
      };
    },
  };
}

async function postGsi(
  app: FastifyInstance,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number }> {
  return app.inject({
    method: 'POST',
    url: '/gsi',
    payload: { auth: { token: TOKEN }, ...payload },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1));
  }
  throw new Error('condition did not become true');
}

describe('Companion GSI capture integration', () => {
  let app: FastifyInstance | undefined;
  let blockedWriter: BlockedFileWriter | undefined;
  let root: string | undefined;

  afterEach(async () => {
    blockedWriter?.releaseFirstWrite();
    blockedWriter = undefined;
    if (app) {
      await app.close();
      app = undefined;
    }
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('takes a real semantic fixture through Fastify, the recorder, and the adapter', async () => {
    root = await mkdtemp(join(tmpdir(), 'rivalhub-companion-semantic-ingress-'));
    const fixture = await verifyCapture(RICH_OBSERVER_FIXTURE);
    const fixtureFrames: CaptureFrameV1[] = [];
    for await (const frame of iterateCaptureFrames(fixture)) fixtureFrames.push(frame);
    expect(fixtureFrames).toHaveLength(1);
    const fixtureFrame = fixtureFrames[0];
    if (fixtureFrame === undefined) throw new Error('semantic fixture is empty');

    const recorder = await createCaptureRecorder({
      captureDir: root,
      captureId: 'semantic-ingress-capture',
      createdAt: '2026-09-14T06:00:00.000Z',
      broadcastCommit: 'integration-commit',
      gsiConfig: PRODUCTION_GSI_CONFIG,
      monotonicNow: () => 100,
      wallClockNow: () => '2026-09-14T06:00:00.000Z',
    });
    let observedSequence = -1;
    let observedMapName: string | undefined;
    let observedPlayerCount = 0;
    app = buildApp({
      gsiToken: TOKEN,
      recorder,
      clock: {
        now: () => ({
          receivedAt: '2026-09-14T06:00:00.100Z',
          receivedMonotonicMs: 100.1,
        }),
      },
      onObservation: (observation) => {
        observedSequence = observation.receive.sequence;
        observedMapName = observation.telemetry.map?.name;
        observedPlayerCount = observation.telemetry.allPlayers?.length ?? 0;
      },
    });

    const response = await postGsi(app, fixtureFrame.payload);
    expect(response.statusCode).toBe(204);
    expect(observedSequence).toBe(0);
    expect(observedMapName).toBe('de_ancient');
    expect(observedPlayerCount).toBe(10);

    await app.close();
    app = undefined;

    const verified = await verifyCapture(join(root, 'semantic-ingress-capture'));
    expect(verified.manifest).toMatchObject({
      complete: true,
      frameCount: 1,
      droppedFrames: 0,
      gsiConfig: PRODUCTION_GSI_CONFIG,
    });
    expect(await readFile(verified.framesPath, 'utf8')).not.toContain(TOKEN);
    await expect(access(join(root, 'semantic-ingress-capture.partial'))).rejects.toThrow();
  });

  it('publishes an incomplete but valid capture after overflow, recovery, and a sequence gap', async () => {
    root = await mkdtemp(join(tmpdir(), 'rivalhub-companion-overflow-ingress-'));
    const capture = await makeBlockedRecorder(root, 'overflow-ingress-capture');
    blockedWriter = capture.writer;
    app = buildApp({ gsiToken: TOKEN, recorder: capture.recorder, clock: createClock() });

    expect(
      (await postGsi(app, { provider: { name: 'CS2' }, map: { name: 'de_nuke' } })).statusCode,
    ).toBe(204);
    await capture.writer.firstWriteStarted;

    for (let index = 1; index < 128; index += 1) {
      expect(
        (await postGsi(app, { provider: { name: 'CS2' }, map: { name: 'de_nuke' }, index }))
          .statusCode,
      ).toBe(204);
    }
    expect(capture.recorder.getHealth()).toMatchObject({
      pendingFrames: 128,
    });
    expect(capture.recorder.getHealth().pendingBytes).toBeGreaterThan(0);

    expect(
      (await postGsi(app, { provider: { name: 'CS2' }, map: { name: 'de_nuke' }, dropped: true }))
        .statusCode,
    ).toBe(204);
    expect(capture.recorder.getHealth()).toMatchObject({ droppedFrames: 1, incomplete: true });

    capture.writer.releaseFirstWrite();
    await waitFor(() => capture.recorder.getHealth().pendingFrames === 0);
    expect(
      (await postGsi(app, { provider: { name: 'CS2' }, map: { name: 'de_nuke' }, recovered: true }))
        .statusCode,
    ).toBe(204);

    await app.close();
    app = undefined;
    blockedWriter = undefined;

    const verified = await verifyCapture(join(root, 'overflow-ingress-capture'));
    expect(verified.manifest).toMatchObject({
      complete: false,
      frameCount: 129,
      droppedFrames: 1,
    });
    const sequences: number[] = [];
    for await (const frame of iterateCaptureFrames(verified)) sequences.push(frame.sequence);
    expect(sequences[0]).toBe(0);
    expect(sequences.at(-1)).toBe(129);
    expect(sequences).not.toContain(128);
  });

  it('keeps 25 Hz HTTP ingress responsive while a real recorder writer is blocked', async () => {
    root = await mkdtemp(join(tmpdir(), 'rivalhub-companion-http-backpressure-'));
    const capture = await makeBlockedRecorder(root, 'http-backpressure-capture');
    blockedWriter = capture.writer;
    let sinkCalls = 0;
    app = buildApp({
      gsiToken: TOKEN,
      recorder: capture.recorder,
      clock: createClock(),
      onObservation: () => {
        sinkCalls += 1;
      },
    });
    const payload = {
      provider: { name: 'CS2' },
      map: { name: 'de_nuke', phase: 'live' },
      filler: 'x'.repeat(1024),
    };

    expect((await postGsi(app, payload)).statusCode).toBe(204);
    await capture.writer.firstWriteStarted;
    for (let index = 1; index < 1_000; index += 1) {
      expect((await postGsi(app, payload)).statusCode).toBe(204);
    }

    expect(sinkCalls).toBe(1_000);
    expect(capture.recorder.getHealth()).toMatchObject({
      pendingFrames: 128,
      droppedFrames: 872,
      incomplete: true,
    });

    capture.writer.releaseFirstWrite();
    await app.close();
    app = undefined;
    blockedWriter = undefined;
    const verified = await verifyCapture(join(root, 'http-backpressure-capture'));
    expect(verified.manifest).toMatchObject({
      complete: false,
      frameCount: 128,
      droppedFrames: 872,
    });
  });
});
