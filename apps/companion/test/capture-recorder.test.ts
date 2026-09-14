import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createCaptureRecorder,
  type CaptureFileHandle,
  type CaptureRecorder,
} from '../src/telemetry/capture-recorder.js';

const CREATED_AT = '2026-09-14T06:00:00.000Z';
const GSI_CONFIG = { uri: 'http://127.0.0.1:3000/gsi', buffer: 0, throttle: 0 };

class MemoryWriter implements CaptureFileHandle {
  readonly chunks: Buffer[] = [];
  readonly positions: number[] = [];
  truncateCalls = 0;
  syncCalls = 0;
  closeCalls = 0;
  activeWrites = 0;
  maxActiveWrites = 0;

  private firstWriteRelease: (() => void) | undefined;
  private writeCount = 0;

  constructor(
    private readonly maxBytesPerWrite = Number.POSITIVE_INFINITY,
    private readonly blockFirstWrite = false,
  ) {}

  async write(buffer: Buffer, position: number): Promise<number> {
    this.writeCount += 1;
    this.activeWrites += 1;
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
    try {
      if (this.blockFirstWrite && this.writeCount === 1) {
        await new Promise<void>((resolve) => {
          this.firstWriteRelease = resolve;
        });
      }
      const chunk = buffer.subarray(0, Math.min(buffer.length, this.maxBytesPerWrite));
      this.chunks.push(Buffer.from(chunk));
      this.positions.push(position);
      return chunk.length;
    } finally {
      this.activeWrites -= 1;
    }
  }

  releaseFirstWrite(): void {
    const release = this.firstWriteRelease;
    this.firstWriteRelease = undefined;
    release?.();
  }

  sync(): Promise<void> {
    this.syncCalls += 1;
    return Promise.resolve();
  }

  truncate(): Promise<void> {
    this.truncateCalls += 1;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }

  get bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

class FailingWriter extends MemoryWriter {
  private failed = false;

  override write(buffer: Buffer, position: number): Promise<number> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new Error('disk write failed'));
    }
    return super.write(buffer, position);
  }
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rivalhub-companion-recorder-'));
}

async function makeRecorder(
  root: string,
  writer: CaptureFileHandle,
  options: {
    readonly shutdownDrainTimeoutMs?: number;
    readonly captureId?: string;
  } = {},
): Promise<CaptureRecorder> {
  return createCaptureRecorder({
    captureDir: root,
    captureId: options.captureId ?? 'test-capture',
    createdAt: CREATED_AT,
    broadcastCommit: 'test-commit',
    gsiConfig: GSI_CONFIG,
    monotonicNow: () => 100,
    writerFactory: () => Promise.resolve(writer),
    ...(options.shutdownDrainTimeoutMs === undefined
      ? {}
      : { shutdownDrainTimeoutMs: options.shutdownDrainTimeoutMs }),
  });
}

function frame(recorder: CaptureRecorder, sequence: number, filler = ''): Buffer {
  return recorder.serializeFrame({
    sequence,
    receivedAt: `2026-09-14T06:00:${String(sequence).padStart(2, '0')}.000Z`,
    receivedMonotonicMs: 100 + sequence,
    payload: { provider: { name: 'CS2' }, filler },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('condition did not become true');
}

describe('production capture recorder', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('serializes FIFO records with short writes and hashes only confirmed bytes', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(3);
    const recorder = await makeRecorder(root, writer);
    const first = frame(recorder, 0, 'first');
    const second = frame(recorder, 1, 'second');

    expect(recorder.offer(first)).toBe(true);
    expect(recorder.offer(second)).toBe(true);
    await recorder.finalize();

    expect(writer.maxActiveWrites).toBe(1);
    expect(writer.bytes).toEqual(Buffer.concat([first, second]));
    expect(recorder.getHealth()).toMatchObject({
      state: 'closed',
      pendingFrames: 0,
      pendingBytes: 0,
      frameCount: 2,
      droppedFrames: 0,
      incomplete: false,
    });
    const manifest = JSON.parse(
      await readFile(join(root, 'test-capture', 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest.framesSha256).toBe(createHash('sha256').update(writer.bytes).digest('hex'));
    expect(manifest.complete).toBe(true);
  });

  it('counts active and queued buffers against both hard bounds and drops newest', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(Number.POSITIVE_INFINITY, true);
    const recorder = await makeRecorder(root, writer);
    const buffer = Buffer.alloc(64 * 1024, 7);

    for (let index = 0; index < 32; index += 1) {
      expect(recorder.offer(buffer)).toBe(true);
    }
    expect(recorder.getHealth()).toMatchObject({
      pendingFrames: 32,
      pendingBytes: 2 * 1024 * 1024,
    });
    expect(recorder.offer(buffer)).toBe(false);
    expect(recorder.getHealth()).toMatchObject({
      state: 'degraded',
      pendingFrames: 32,
      pendingBytes: 2 * 1024 * 1024,
      droppedFrames: 1,
      incomplete: true,
      lastErrorCode: 'recorder_overflow',
    });

    writer.releaseFirstWrite();
    await waitFor(() => recorder.getHealth().pendingFrames === 0);
    expect(recorder.offer(Buffer.from('future\n'))).toBe(true);
    await recorder.finalize();
    expect(recorder.getHealth()).toMatchObject({ frameCount: 33, droppedFrames: 1 });
  });

  it('enforces the 128-frame item cap while an active write is in flight', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(Number.POSITIVE_INFINITY, true);
    const recorder = await makeRecorder(root, writer, { captureId: 'item-cap-capture' });
    const buffer = Buffer.from('frame\n');

    for (let index = 0; index < 128; index += 1) {
      expect(recorder.offer(buffer)).toBe(true);
    }
    expect(recorder.getHealth().pendingFrames).toBe(128);
    expect(recorder.offer(buffer)).toBe(false);
    expect(recorder.getHealth()).toMatchObject({
      pendingFrames: 128,
      droppedFrames: 1,
      incomplete: true,
      lastErrorCode: 'recorder_overflow',
    });

    writer.releaseFirstWrite();
    await recorder.finalize();
  });

  it('keeps memory bounded under a synthetic 25 Hz equivalent blocked-writer burst', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(Number.POSITIVE_INFINITY, true);
    const recorder = await makeRecorder(root, writer, { captureId: 'adversarial-capture' });
    const buffer = Buffer.alloc(1024, 9);

    for (let index = 0; index < 1_000; index += 1) {
      recorder.offer(buffer);
      const health = recorder.getHealth();
      expect(health.pendingFrames).toBeLessThanOrEqual(128);
      expect(health.pendingBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    }

    expect(recorder.getHealth().droppedFrames).toBeGreaterThan(0);
    writer.releaseFirstWrite();
    await recorder.finalize();
  });

  it('terminally fails on writer error and counts active plus queued frames as dropped', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new FailingWriter();
    const recorder = await makeRecorder(root, writer);

    expect(recorder.offer(frame(recorder, 0))).toBe(true);
    expect(recorder.offer(frame(recorder, 1))).toBe(true);
    expect(recorder.offer(frame(recorder, 2))).toBe(true);
    await recorder.finalize();

    const manifest = JSON.parse(
      await readFile(join(root, 'test-capture', 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      complete: false,
      frameCount: 0,
      droppedFrames: 3,
    });
    expect(recorder.getHealth()).toMatchObject({
      state: 'closed',
      pendingFrames: 0,
      pendingBytes: 0,
      frameCount: 0,
      droppedFrames: 3,
      incomplete: true,
      lastErrorCode: 'recorder_writer_failed',
    });
  });

  it('leaves partial capture untouched when active write remains unresolved at shutdown timeout', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(Number.POSITIVE_INFINITY, true);
    const recorder = await makeRecorder(root, writer, { shutdownDrainTimeoutMs: 5 });

    expect(recorder.offer(frame(recorder, 0))).toBe(true);
    await recorder.finalize();

    await access(join(root, 'test-capture.partial'));
    await expect(access(join(root, 'test-capture'))).rejects.toThrow();
    expect(writer.truncateCalls).toBe(0);
    expect(writer.closeCalls).toBe(0);
    expect(recorder.getHealth()).toMatchObject({
      state: 'failed',
      incomplete: true,
      lastErrorCode: 'recorder_finalize_timeout',
    });

    writer.releaseFirstWrite();
    await waitFor(() => writer.closeCalls === 1);
  });
});
