import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export const RECORDER_MAX_PENDING_FRAMES = 128;
export const RECORDER_MAX_PENDING_BYTES = 2 * 1024 * 1024;
export const RECORDER_SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

export type RecorderState = 'recording' | 'degraded' | 'failed' | 'finalizing' | 'closed';

export interface RecorderHealth {
  readonly state: RecorderState;
  readonly pendingFrames: number;
  readonly pendingBytes: number;
  readonly maxPendingFrames: number;
  readonly maxPendingBytes: number;
  readonly frameCount: number;
  readonly droppedFrames: number;
  readonly incomplete: boolean;
  readonly lastErrorCode?: string;
}

export interface RecorderDiagnostic {
  readonly code:
    | 'recorder_overflow'
    | 'recorder_writer_failed'
    | 'recorder_start_failed'
    | 'recorder_finalize_timeout'
    | 'recorder_finalize_failed';
}

export interface CaptureFrameInput {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly receivedMonotonicMs: number;
  readonly payload: Record<string, unknown>;
}

export interface CaptureFileHandle {
  write(buffer: Buffer, position: number): Promise<number>;
  sync(): Promise<void>;
  truncate(length: number): Promise<void>;
  close(): Promise<void>;
}

export type CaptureWriterFactory = (framesPath: string) => Promise<CaptureFileHandle>;

export interface CaptureRecorder {
  readonly captureId: string;
  serializeFrame(input: CaptureFrameInput): Buffer;
  offer(buffer: Buffer): boolean;
  getHealth(): RecorderHealth;
  finalize(): Promise<void>;
}

export interface CaptureRecorderOptions {
  readonly captureDir: string;
  readonly broadcastCommit?: string;
  readonly gsiConfig: Record<string, unknown>;
  readonly captureId?: string;
  readonly createdAt?: string;
  readonly monotonicNow?: () => number;
  readonly wallClockNow?: () => string;
  readonly writerFactory?: CaptureWriterFactory;
  readonly shutdownDrainTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: RecorderDiagnostic) => void;
}

function defaultCaptureId(createdAt: string): string {
  const timestamp = createdAt.replace(/[-:.TZ]/g, '');
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function adaptFileHandle(fileHandle: Awaited<ReturnType<typeof open>>): CaptureFileHandle {
  return {
    async write(buffer, position) {
      const result = await fileHandle.write(buffer, 0, buffer.length, position);
      return result.bytesWritten;
    },
    sync: () => fileHandle.sync(),
    truncate: (length) => fileHandle.truncate(length),
    close: () => fileHandle.close(),
  };
}

async function openCaptureFile(framesPath: string): Promise<CaptureFileHandle> {
  return adaptFileHandle(await open(framesPath, 'wx'));
}

async function writeFully(
  fileHandle: CaptureFileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const bytesWritten = await fileHandle.write(buffer.subarray(written), position + written);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error('capture writer returned no progress');
    }
    if (bytesWritten > buffer.length - written) {
      throw new Error('capture writer returned an invalid byte count');
    }
    written += bytesWritten;
  }
}

function createManifest(
  captureId: string,
  createdAt: string,
  broadcastCommit: string,
  gsiConfig: Record<string, unknown>,
  complete: boolean,
  frameCount: number,
  droppedFrames: number,
  framesSha256: string,
): Record<string, unknown> {
  return {
    formatVersion: 1,
    captureId,
    createdAt,
    platform: process.platform,
    broadcastCommit,
    scenario: 'production-gsi-session',
    gsiConfig,
    complete,
    frameCount,
    droppedFrames,
    framesSha256,
  };
}

class ProductionCaptureRecorder implements CaptureRecorder {
  readonly captureId: string;

  private readonly captureDir: string;
  private readonly partialDir: string;
  private readonly finalDir: string;
  private readonly framesPath: string;
  private readonly createdAt: string;
  private readonly broadcastCommit: string;
  private readonly gsiConfig: Record<string, unknown>;
  private readonly startedMonotonicMs: number;
  private readonly writerFactory: CaptureWriterFactory;
  private readonly shutdownDrainTimeoutMs: number;
  private readonly onDiagnostic: ((diagnostic: RecorderDiagnostic) => void) | undefined;
  private readonly hash = createHash('sha256');
  private readonly queue: Buffer[] = [];
  private readonly drainWaiters: Array<() => void> = [];
  private readonly emittedDiagnostics = new Set<RecorderDiagnostic['code']>();

  private fileHandle: CaptureFileHandle | undefined;
  private activeBuffer: Buffer | undefined;
  private pumpRunning = false;
  private admissionsStopped = false;
  private writerFailed = false;
  private shutdownAbandoned = false;
  private closed = false;
  private finalizePromise: Promise<void> | undefined;
  private pendingFrames = 0;
  private pendingBytes = 0;
  private frameCount = 0;
  private droppedFrames = 0;
  private confirmedOffset = 0;
  private lastElapsedUs = 0;
  private incomplete = false;
  private lastErrorCode: string | undefined;
  private canPublish = true;

  private constructor(options: CaptureRecorderOptions) {
    this.captureDir = options.captureDir;
    this.createdAt = options.createdAt ?? options.wallClockNow?.() ?? new Date().toISOString();
    this.captureId = options.captureId ?? defaultCaptureId(this.createdAt);
    this.partialDir = join(this.captureDir, `${this.captureId}.partial`);
    this.finalDir = join(this.captureDir, this.captureId);
    this.framesPath = join(this.partialDir, 'frames.jsonl');
    this.broadcastCommit = options.broadcastCommit ?? 'unknown';
    this.gsiConfig = { ...options.gsiConfig };
    delete this.gsiConfig.auth;
    delete this.gsiConfig.token;
    const monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.startedMonotonicMs = monotonicNow();
    this.writerFactory = options.writerFactory ?? openCaptureFile;
    this.shutdownDrainTimeoutMs =
      options.shutdownDrainTimeoutMs ?? RECORDER_SHUTDOWN_DRAIN_TIMEOUT_MS;
    this.onDiagnostic = options.onDiagnostic;
  }

  static async create(options: CaptureRecorderOptions): Promise<ProductionCaptureRecorder> {
    const recorder = new ProductionCaptureRecorder(options);
    try {
      await mkdir(recorder.captureDir, { recursive: true });
      await mkdir(recorder.partialDir);
      recorder.fileHandle = await recorder.writerFactory(recorder.framesPath);
    } catch (error: unknown) {
      try {
        options.onDiagnostic?.({ code: 'recorder_start_failed' });
      } catch {
        // Startup diagnostics must not replace the original startup error.
      }
      throw error;
    }
    return recorder;
  }

  serializeFrame(input: CaptureFrameInput): Buffer {
    const elapsedDelta = (input.receivedMonotonicMs - this.startedMonotonicMs) * 1000;
    const candidateElapsedUs = Number.isFinite(elapsedDelta)
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(elapsedDelta)))
      : this.lastElapsedUs;
    const elapsedUs = Math.max(this.lastElapsedUs, candidateElapsedUs);
    this.lastElapsedUs = elapsedUs;
    return Buffer.from(
      `${JSON.stringify({
        version: 1,
        sequence: input.sequence,
        elapsedUs,
        receivedAt: input.receivedAt,
        payload: input.payload,
      })}\n`,
      'utf8',
    );
  }

  offer(buffer: Buffer): boolean {
    if (
      this.admissionsStopped ||
      this.writerFailed ||
      this.closed ||
      this.fileHandle === undefined
    ) {
      this.dropFrame();
      return false;
    }

    if (
      this.pendingFrames + 1 > RECORDER_MAX_PENDING_FRAMES ||
      this.pendingBytes + buffer.byteLength > RECORDER_MAX_PENDING_BYTES
    ) {
      this.dropFrame('recorder_overflow');
      return false;
    }

    this.queue.push(buffer);
    this.pendingFrames += 1;
    this.pendingBytes += buffer.byteLength;
    void this.pump();
    return true;
  }

  getHealth(): RecorderHealth {
    let state: RecorderState;
    if (this.closed) {
      state = 'closed';
    } else if (this.shutdownAbandoned) {
      state = 'failed';
    } else if (this.finalizePromise !== undefined && this.admissionsStopped) {
      state = 'finalizing';
    } else if (this.writerFailed) {
      state = 'failed';
    } else if (this.incomplete) {
      state = 'degraded';
    } else {
      state = 'recording';
    }

    return {
      state,
      pendingFrames: this.pendingFrames,
      pendingBytes: this.pendingBytes,
      maxPendingFrames: RECORDER_MAX_PENDING_FRAMES,
      maxPendingBytes: RECORDER_MAX_PENDING_BYTES,
      frameCount: this.frameCount,
      droppedFrames: this.droppedFrames,
      incomplete: this.incomplete,
      ...(this.lastErrorCode === undefined ? {} : { lastErrorCode: this.lastErrorCode }),
    };
  }

  finalize(): Promise<void> {
    this.finalizePromise ??= this.finalizeInternal();
    return this.finalizePromise;
  }

  private elapsedDrainPromise(): Promise<void> {
    if (this.pendingFrames === 0 || this.writerFailed) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  private notifyDrainWaiters(): void {
    if (this.pendingFrames !== 0 && !this.writerFailed) return;
    const waiters = this.drainWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private async pump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;

    try {
      while (this.queue.length > 0 && !this.writerFailed && !this.shutdownAbandoned) {
        const buffer = this.queue.shift();
        if (buffer === undefined) break;
        this.activeBuffer = buffer;

        try {
          if (this.fileHandle === undefined) throw new Error('capture file is not open');
          await writeFully(this.fileHandle, buffer, this.confirmedOffset);
        } catch {
          await this.handleWriterFailure();
          break;
        }

        this.frameCount += 1;
        this.confirmedOffset += buffer.byteLength;
        this.hash.update(buffer);
        this.pendingFrames -= 1;
        this.pendingBytes -= buffer.byteLength;
        this.activeBuffer = undefined;
        this.notifyDrainWaiters();
      }
    } finally {
      this.pumpRunning = false;
      if (
        this.shutdownAbandoned &&
        this.activeBuffer === undefined &&
        this.fileHandle !== undefined
      ) {
        const fileHandle = this.fileHandle;
        this.fileHandle = undefined;
        try {
          await fileHandle.truncate(this.confirmedOffset);
          await fileHandle.close();
        } catch {
          this.canPublish = false;
        }
        this.closed = true;
      }
      this.notifyDrainWaiters();
    }
  }

  private async handleWriterFailure(): Promise<void> {
    this.writerFailed = true;
    this.incomplete = true;
    this.lastErrorCode = 'recorder_writer_failed';
    this.emitDiagnostic('recorder_writer_failed');

    this.droppedFrames += 1 + this.queue.length;
    this.queue.length = 0;
    this.pendingFrames = 0;
    this.pendingBytes = 0;
    this.activeBuffer = undefined;

    try {
      if (this.fileHandle !== undefined) {
        await this.fileHandle.truncate(this.confirmedOffset);
      }
    } catch {
      this.canPublish = false;
    }

    this.notifyDrainWaiters();
  }

  private dropFrame(diagnostic?: RecorderDiagnostic['code']): void {
    this.droppedFrames += 1;
    this.incomplete = true;
    if (diagnostic !== undefined) {
      this.lastErrorCode = diagnostic;
      this.emitDiagnostic(diagnostic);
    }
  }

  private emitDiagnostic(code: RecorderDiagnostic['code']): void {
    if (this.emittedDiagnostics.has(code)) return;
    this.emittedDiagnostics.add(code);
    try {
      this.onDiagnostic?.({ code });
    } catch {
      // Diagnostics must never affect the live telemetry path.
    }
  }

  private discardQueuedFrames(): void {
    if (this.queue.length === 0) return;
    this.droppedFrames += this.queue.length;
    this.incomplete = true;
    this.queue.length = 0;
    this.pendingFrames = this.activeBuffer === undefined ? 0 : 1;
    this.pendingBytes = this.activeBuffer?.byteLength ?? 0;
    this.notifyDrainWaiters();
  }

  private async finalizeInternal(): Promise<void> {
    this.admissionsStopped = true;
    if (this.closed || this.fileHandle === undefined) {
      this.closed = true;
      return;
    }

    const timedOut = await new Promise<boolean>((resolve) => {
      let settled = false;
      const timeoutHandle = setTimeout(() => {
        settled = true;
        resolve(true);
      }, this.shutdownDrainTimeoutMs);
      void this.elapsedDrainPromise().then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(false);
      });
    });

    if (timedOut) {
      this.incomplete = true;
      this.lastErrorCode = 'recorder_finalize_timeout';
      this.emitDiagnostic('recorder_finalize_timeout');
      this.discardQueuedFrames();
      if (this.activeBuffer !== undefined) {
        this.shutdownAbandoned = true;
        return;
      }
    }

    if (this.activeBuffer !== undefined) {
      this.shutdownAbandoned = true;
      return;
    }

    const fileHandle = this.fileHandle;
    let safe = this.canPublish;
    try {
      await fileHandle.truncate(this.confirmedOffset);
      await fileHandle.sync();
    } catch {
      safe = false;
    }

    try {
      await fileHandle.close();
    } catch {
      safe = false;
    }
    this.fileHandle = undefined;

    if (!safe) {
      this.incomplete = true;
      this.lastErrorCode ??= 'recorder_finalize_failed';
      this.emitDiagnostic('recorder_finalize_failed');
      this.closed = true;
      return;
    }

    const framesSha256 = this.hash.digest('hex');
    const manifest = createManifest(
      this.captureId,
      this.createdAt,
      this.broadcastCommit,
      this.gsiConfig,
      !this.incomplete && this.droppedFrames === 0,
      this.frameCount,
      this.droppedFrames,
      framesSha256,
    );

    try {
      const manifestHandle = await open(join(this.partialDir, 'manifest.json'), 'wx');
      try {
        await writeFully(
          adaptFileHandle(manifestHandle),
          Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'),
          0,
        );
        await manifestHandle.sync();
      } finally {
        await manifestHandle.close();
      }
      await rename(this.partialDir, this.finalDir);
      this.closed = true;
    } catch {
      this.incomplete = true;
      this.lastErrorCode ??= 'recorder_finalize_failed';
      this.emitDiagnostic('recorder_finalize_failed');
      this.closed = true;
    }
  }
}

class DisabledCaptureRecorder implements CaptureRecorder {
  readonly captureId = 'disabled';

  private droppedFrames = 0;
  private closed = false;

  constructor(private readonly lastErrorCode: string) {}

  serializeFrame(input: CaptureFrameInput): Buffer {
    return Buffer.from(
      `${JSON.stringify({
        version: 1,
        sequence: input.sequence,
        elapsedUs: 0,
        receivedAt: input.receivedAt,
        payload: input.payload,
      })}\n`,
      'utf8',
    );
  }

  offer(): boolean {
    this.droppedFrames += 1;
    return false;
  }

  getHealth(): RecorderHealth {
    return {
      state: this.closed ? 'closed' : 'degraded',
      pendingFrames: 0,
      pendingBytes: 0,
      maxPendingFrames: RECORDER_MAX_PENDING_FRAMES,
      maxPendingBytes: RECORDER_MAX_PENDING_BYTES,
      frameCount: 0,
      droppedFrames: this.droppedFrames,
      incomplete: true,
      lastErrorCode: this.lastErrorCode,
    };
  }

  finalize(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

export async function createCaptureRecorder(
  options: CaptureRecorderOptions,
): Promise<CaptureRecorder> {
  return ProductionCaptureRecorder.create(options);
}

export function createDisabledRecorder(lastErrorCode = 'recorder_start_failed'): CaptureRecorder {
  return new DisabledCaptureRecorder(lastErrorCode);
}
