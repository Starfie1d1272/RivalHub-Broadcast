import { open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CaptureFrameInput {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly receivedMonotonicMs: number;
  readonly payload: Record<string, unknown>;
}

/** Mirrors Capture V1; testkit verifyCapture validates the persisted contract. */
export interface ProductionCaptureFrameV1 {
  readonly version: 1;
  readonly sequence: number;
  readonly elapsedUs: number;
  readonly receivedAt: string;
  readonly payload: Record<string, unknown>;
}

/** Mirrors Capture V1; testkit verifyCapture validates the persisted contract. */
export interface ProductionCaptureManifestV1 {
  readonly formatVersion: 1;
  readonly captureId: string;
  readonly createdAt: string;
  readonly platform: string;
  readonly broadcastCommit: string;
  readonly scenario: string;
  readonly gsiConfig: Record<string, unknown>;
  readonly complete: boolean;
  readonly frameCount: number;
  readonly droppedFrames: number;
  readonly framesSha256: string;
}

export interface CaptureFileHandle {
  write(buffer: Buffer, position: number): Promise<number>;
  sync(): Promise<void>;
  truncate(length: number): Promise<void>;
  close(): Promise<void>;
}

export type CaptureWriterFactory = (framesPath: string) => Promise<CaptureFileHandle>;

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

export async function openCaptureFile(framesPath: string): Promise<CaptureFileHandle> {
  return adaptFileHandle(await open(framesPath, 'wx', 0o600));
}

export function serializeCaptureFrame(input: CaptureFrameInput, elapsedUs: number): Buffer {
  const frame: ProductionCaptureFrameV1 = {
    version: 1,
    sequence: input.sequence,
    elapsedUs,
    receivedAt: input.receivedAt,
    payload: input.payload,
  };
  return Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8');
}

export async function writeFully(
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

export function createCaptureManifest(
  captureId: string,
  createdAt: string,
  broadcastCommit: string,
  gsiConfig: Record<string, unknown>,
  complete: boolean,
  frameCount: number,
  droppedFrames: number,
  framesSha256: string,
): ProductionCaptureManifestV1 {
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

export async function writeCaptureManifest(
  partialDir: string,
  manifest: ProductionCaptureManifestV1,
): Promise<void> {
  await writeFile(
    join(partialDir, 'manifest.json'),
    Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'),
    { flag: 'wx', mode: 0o600, flush: true },
  );
}

export async function renameCapture(partialDir: string, finalDir: string): Promise<void> {
  await rename(partialDir, finalDir);
}
