import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createCaptureRecorder,
  type CaptureFileHandle,
  type CaptureFrameInput,
  type CaptureRecorder,
  type RecorderDiagnostic,
} from '../src/telemetry/capture-recorder.js';
import { serializeCaptureFrame } from '../src/telemetry/capture-storage.js';

const CREATED_AT = '2026-09-14T06:00:00.000Z';
const GSI_CONFIG = { uri: 'http://127.0.0.1:3000/gsi', buffer: 0, throttle: 0 };

class MemoryWriter implements CaptureFileHandle {
  truncateCalls = 0;
  syncCalls = 0;
  closeCalls = 0;
  activeWrites = 0;
  maxActiveWrites = 0;
  maxActiveOperations = 0;

  private firstWriteRelease: (() => void) | undefined;
  private writeCount = 0;
  private activeOperations = 0;
  private bytesWritten = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly maxBytesPerWrite = Number.POSITIVE_INFINITY,
    private readonly blockFirstWrite = false,
    private readonly failWriteAt: number | undefined = undefined,
  ) {}

  private async track<T>(operation: () => T | Promise<T>): Promise<T> {
    this.activeOperations += 1;
    this.maxActiveOperations = Math.max(this.maxActiveOperations, this.activeOperations);
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('file handle is closed');
  }

  private writeAt(buffer: Buffer, position: number): void {
    const end = position + buffer.length;
    if (end > this.bytesWritten.length) {
      const expanded = Buffer.alloc(end);
      this.bytesWritten.copy(expanded);
      this.bytesWritten = expanded;
    }
    buffer.copy(this.bytesWritten, position);
  }

  async write(buffer: Buffer, position: number): Promise<number> {
    return this.track(async () => {
      this.ensureOpen();
      this.writeCount += 1;
      this.activeWrites += 1;
      this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
      try {
        if (this.failWriteAt === this.writeCount) {
          throw new Error('disk write failed');
        }
        if (this.blockFirstWrite && this.writeCount === 1) {
          await new Promise<void>((resolve) => {
            this.firstWriteRelease = resolve;
          });
        }
        const chunk = buffer.subarray(0, Math.min(buffer.length, this.maxBytesPerWrite));
        this.writeAt(chunk, position);
        return chunk.length;
      } finally {
        this.activeWrites -= 1;
      }
    });
  }

  releaseFirstWrite(): void {
    const release = this.firstWriteRelease;
    this.firstWriteRelease = undefined;
    release?.();
  }

  sync(): Promise<void> {
    return this.track(() => {
      this.ensureOpen();
      this.syncCalls += 1;
    });
  }

  truncate(length: number): Promise<void> {
    return this.track(() => {
      this.ensureOpen();
      this.truncateCalls += 1;
      if (length < this.bytesWritten.length) {
        this.bytesWritten = this.bytesWritten.subarray(0, length);
      } else if (length > this.bytesWritten.length) {
        const expanded = Buffer.alloc(length);
        this.bytesWritten.copy(expanded);
        this.bytesWritten = expanded;
      }
    });
  }

  close(): Promise<void> {
    return this.track(() => {
      this.ensureOpen();
      this.closeCalls += 1;
      this.closed = true;
    });
  }

  get bytes(): Buffer {
    return this.bytesWritten;
  }
}

class FailingWriter extends MemoryWriter {
  constructor() {
    super(Number.POSITIVE_INFINITY, false, 1);
  }
}

class PartialLineFailureWriter implements CaptureFileHandle {
  private writeCount = 0;
  private bytesWritten = Buffer.alloc(0);

  readonly truncateLengths: number[] = [];
  syncCalls = 0;
  closeCalls = 0;

  write(buffer: Buffer, position: number): Promise<number> {
    return Promise.resolve().then(() => {
      this.writeCount += 1;
      if (this.writeCount === 3) throw new Error('disk write failed after partial line');

      const chunk =
        this.writeCount === 2
          ? buffer.subarray(0, Math.max(1, Math.floor(buffer.length / 2)))
          : buffer;
      const end = position + chunk.length;
      if (end > this.bytesWritten.length) {
        const expanded = Buffer.alloc(end);
        this.bytesWritten.copy(expanded);
        this.bytesWritten = expanded;
      }
      chunk.copy(this.bytesWritten, position);
      return chunk.length;
    });
  }

  truncate(length: number): Promise<void> {
    return Promise.resolve().then(() => {
      this.truncateLengths.push(length);
      this.bytesWritten = this.bytesWritten.subarray(0, length);
    });
  }

  sync(): Promise<void> {
    return Promise.resolve().then(() => {
      this.syncCalls += 1;
    });
  }

  close(): Promise<void> {
    return Promise.resolve().then(() => {
      this.closeCalls += 1;
    });
  }

  get bytes(): Buffer {
    return this.bytesWritten;
  }
}

class DeferredTruncateFailureWriter implements CaptureFileHandle {
  private writeFailed = false;
  private activeOperations = 0;
  private readonly truncateGate: Promise<void>;
  private truncateGateRelease: (() => void) | undefined;
  private truncateStartedResolve: (() => void) | undefined;

  readonly truncateStarted: Promise<void>;
  maxActiveOperations = 0;
  truncateCalls = 0;
  syncCalls = 0;
  closeCalls = 0;

  constructor() {
    this.truncateStarted = new Promise<void>((resolve) => {
      this.truncateStartedResolve = resolve;
    });
    this.truncateGate = new Promise<void>((resolve) => {
      this.truncateGateRelease = resolve;
    });
  }

  private async track<T>(operation: () => T | Promise<T>): Promise<T> {
    this.activeOperations += 1;
    this.maxActiveOperations = Math.max(this.maxActiveOperations, this.activeOperations);
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
    }
  }

  write(buffer: Buffer, position: number): Promise<number> {
    void position;
    return this.track(() => {
      if (!this.writeFailed) {
        this.writeFailed = true;
        throw Object.assign(new Error('disk write failed'), { code: 'ENOSPC' });
      }
      return buffer.length;
    });
  }

  truncate(length: number): Promise<void> {
    void length;
    return this.track(async () => {
      this.truncateCalls += 1;
      this.truncateStartedResolve?.();
      await this.truncateGate;
    });
  }

  sync(): Promise<void> {
    return this.track(() => {
      this.syncCalls += 1;
    });
  }

  close(): Promise<void> {
    return this.track(() => {
      this.closeCalls += 1;
    });
  }

  releaseTruncate(): void {
    this.truncateGateRelease?.();
    this.truncateGateRelease = undefined;
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
    readonly onDiagnostic?: (diagnostic: RecorderDiagnostic) => void;
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
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  });
}

function frameInput(sequence: number, filler = ''): CaptureFrameInput {
  return {
    sequence,
    receivedAt: `2026-09-14T06:00:${String(sequence).padStart(2, '0')}.000Z`,
    receivedMonotonicMs: 100 + sequence,
    payload: { provider: { name: 'CS2' }, filler },
  };
}

function frameBytes(sequence: number, filler = ''): Buffer {
  return serializeCaptureFrame(frameInput(sequence, filler), sequence * 1_000);
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
    const first = frameBytes(0, 'first');
    const second = frameBytes(1, 'second');

    expect(recorder.tryRecord(frameInput(0, 'first'))).toBe(true);
    expect(recorder.tryRecord(frameInput(1, 'second'))).toBe(true);
    await recorder.finalize();

    expect(writer.maxActiveWrites).toBe(1);
    expect(writer.maxActiveOperations).toBe(1);
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
    const filler = 'x'.repeat(64 * 1024);
    let accepted = 0;

    while (recorder.tryRecord(frameInput(accepted, filler))) {
      accepted += 1;
    }
    const pending = recorder.getHealth();
    const nextBufferSize = frameBytes(accepted, filler).byteLength;
    expect(accepted).toBeLessThan(128);
    expect(pending.pendingFrames).toBe(accepted);
    expect(pending.pendingBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(pending.pendingBytes + nextBufferSize).toBeGreaterThan(2 * 1024 * 1024);
    expect(recorder.getHealth()).toMatchObject({
      state: 'degraded',
      droppedFrames: 1,
      incomplete: true,
      lastErrorCode: 'recorder_overflow',
    });

    writer.releaseFirstWrite();
    await waitFor(() => recorder.getHealth().pendingFrames === 0);
    expect(recorder.tryRecord(frameInput(accepted + 1, 'future'))).toBe(true);
    await recorder.finalize();
    expect(recorder.getHealth()).toMatchObject({ frameCount: accepted + 1, droppedFrames: 1 });
  });

  it('enforces the 128-frame item cap while an active write is in flight', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(Number.POSITIVE_INFINITY, true);
    const recorder = await makeRecorder(root, writer, { captureId: 'item-cap-capture' });

    for (let index = 0; index < 128; index += 1) {
      expect(recorder.tryRecord(frameInput(index))).toBe(true);
    }
    expect(recorder.getHealth().pendingFrames).toBe(128);
    expect(recorder.tryRecord(frameInput(128))).toBe(false);
    expect(recorder.getHealth()).toMatchObject({
      pendingFrames: 128,
      droppedFrames: 1,
      incomplete: true,
      lastErrorCode: 'recorder_overflow',
    });

    writer.releaseFirstWrite();
    await recorder.finalize();
  });

  it('terminally fails on writer error and counts active plus queued frames as dropped', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new FailingWriter();
    const recorder = await makeRecorder(root, writer);

    expect(recorder.tryRecord(frameInput(0))).toBe(true);
    expect(recorder.tryRecord(frameInput(1))).toBe(true);
    expect(recorder.tryRecord(frameInput(2))).toBe(true);
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

  it('truncates a partially written line back to the confirmed offset before publishing', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new PartialLineFailureWriter();
    const recorder = await makeRecorder(root, writer, { captureId: 'partial-line-capture' });
    const first = frameBytes(0, 'confirmed');

    expect(recorder.tryRecord(frameInput(0, 'confirmed'))).toBe(true);
    expect(recorder.tryRecord(frameInput(1, 'partial'))).toBe(true);
    await recorder.finalize();

    expect(writer.bytes).toEqual(first);
    expect(writer.truncateLengths).toEqual([first.length]);
    expect(writer.syncCalls).toBe(1);
    expect(writer.closeCalls).toBe(1);
    const manifest = JSON.parse(
      await readFile(join(root, 'partial-line-capture', 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      complete: false,
      frameCount: 1,
      droppedFrames: 1,
      framesSha256: createHash('sha256').update(first).digest('hex'),
    });
  });

  it('serializes failure cleanup and finalize operations on one file handle', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new DeferredTruncateFailureWriter();
    const diagnostics: RecorderDiagnostic[] = [];
    const recorder = await makeRecorder(root, writer, {
      captureId: 'deferred-truncate-capture',
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(recorder.tryRecord(frameInput(0))).toBe(true);
    expect(recorder.tryRecord(frameInput(1))).toBe(true);
    await waitFor(() => recorder.getHealth().state === 'failed');

    const finalizePromise = recorder.finalize();
    await writer.truncateStarted;
    expect(writer.maxActiveOperations).toBe(1);
    expect(writer.truncateCalls).toBe(1);
    expect(writer.syncCalls).toBe(0);
    expect(writer.closeCalls).toBe(0);
    expect(diagnostics).toContainEqual({
      code: 'recorder_writer_failed',
      operation: 'write',
      causeCode: 'ENOSPC',
    });

    writer.releaseTruncate();
    await finalizePromise;
    expect(writer.maxActiveOperations).toBe(1);
    expect(writer.syncCalls).toBe(1);
    expect(writer.closeCalls).toBe(1);
  });

  it('leaves partial capture untouched when active write remains unresolved at shutdown timeout', async () => {
    const root = await makeRoot();
    roots.push(root);
    const writer = new MemoryWriter(Number.POSITIVE_INFINITY, true);
    const recorder = await makeRecorder(root, writer, { shutdownDrainTimeoutMs: 5 });

    expect(recorder.tryRecord(frameInput(0))).toBe(true);
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
