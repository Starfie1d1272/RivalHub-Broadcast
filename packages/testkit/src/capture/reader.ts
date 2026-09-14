import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';

import { CaptureFormatError } from './errors.js';
import { isValidUtcTimestamp, readCaptureManifest } from './manifest.js';
import type { CaptureFrameV1, CaptureManifestV1, VerifiedCapture } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseFrameLine(
  line: string,
  lineNumber: number,
  captureId: string,
  framesPath: string,
): CaptureFrameV1 {
  if (line.length === 0) {
    throw new CaptureFormatError('INVALID_FRAME_SHAPE', 'blank lines are not valid frame records', {
      captureId,
      lineNumber,
      path: framesPath,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    throw new CaptureFormatError('INVALID_FRAME_JSON', `invalid JSON: ${String(error)}`, {
      captureId,
      lineNumber,
      path: framesPath,
    });
  }
  if (!isRecord(raw)) {
    throw new CaptureFormatError('INVALID_FRAME_SHAPE', 'frame record must be an object', {
      captureId,
      lineNumber,
      path: framesPath,
    });
  }

  if (raw.version !== 1) {
    throw new CaptureFormatError('INVALID_FRAME_SHAPE', 'frame.version must be 1', {
      captureId,
      lineNumber,
      path: framesPath,
    });
  }
  if (!isNonNegativeSafeInteger(raw.sequence)) {
    throw new CaptureFormatError(
      'INVALID_SEQUENCE',
      'frame.sequence must be a non-negative safe integer',
      {
        captureId,
        lineNumber,
        path: framesPath,
      },
    );
  }
  if (!isNonNegativeSafeInteger(raw.elapsedUs)) {
    throw new CaptureFormatError(
      'INVALID_ELAPSED_US',
      'frame.elapsedUs must be a non-negative safe integer',
      {
        captureId,
        lineNumber,
        path: framesPath,
      },
    );
  }
  if (!isValidUtcTimestamp(raw.receivedAt)) {
    throw new CaptureFormatError(
      'INVALID_RECEIVED_AT',
      'frame.receivedAt must be an RFC3339 UTC timestamp ending in Z',
      { captureId, lineNumber, path: framesPath },
    );
  }
  if (!isRecord(raw.payload)) {
    throw new CaptureFormatError('INVALID_FRAME_SHAPE', 'frame.payload must be a JSON object', {
      captureId,
      lineNumber,
      path: framesPath,
    });
  }

  return {
    version: 1,
    sequence: raw.sequence,
    elapsedUs: raw.elapsedUs,
    receivedAt: raw.receivedAt,
    payload: raw.payload,
  };
}

interface FrameStreamOptions {
  readonly captureId: string;
  readonly framesPath: string;
  readonly hash?: ReturnType<typeof createHash>;
}

async function* streamFrameRecords({
  captureId,
  framesPath,
  hash,
}: FrameStreamOptions): AsyncGenerator<{ readonly lineNumber: number; readonly line: string }> {
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(framesPath);
  } catch (error) {
    throw new CaptureFormatError(
      'INVALID_FRAME_SHAPE',
      `cannot open ${framesPath}: ${String(error)}`,
      {
        captureId,
        path: framesPath,
      },
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let lineNumber = 0;

  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash?.update(bytes);
      try {
        pending += decoder.decode(bytes, { stream: true });
      } catch (error) {
        throw new CaptureFormatError(
          'INVALID_FRAME_JSON',
          `frames.jsonl is not valid UTF-8: ${String(error)}`,
          {
            captureId,
            path: framesPath,
          },
        );
      }

      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex !== -1) {
        let line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lineNumber += 1;
        yield { lineNumber, line };
        newlineIndex = pending.indexOf('\n');
      }
    }

    try {
      pending += decoder.decode();
    } catch (error) {
      throw new CaptureFormatError(
        'INVALID_FRAME_JSON',
        `frames.jsonl is not valid UTF-8: ${String(error)}`,
        {
          captureId,
          path: framesPath,
        },
      );
    }
    if (pending.length > 0) {
      lineNumber += 1;
      yield { lineNumber, line: pending };
    }
  } catch (error) {
    if (error instanceof CaptureFormatError) throw error;
    throw new CaptureFormatError(
      'INVALID_FRAME_SHAPE',
      `cannot read ${framesPath}: ${String(error)}`,
      {
        captureId,
        path: framesPath,
      },
    );
  }
}

async function* parseFrames(
  manifest: CaptureManifestV1,
  framesPath: string,
  hash?: ReturnType<typeof createHash>,
): AsyncGenerator<CaptureFrameV1> {
  let previousSequence: number | undefined;
  let previousElapsedUs: number | undefined;
  let count = 0;

  for await (const record of streamFrameRecords({
    captureId: manifest.captureId,
    framesPath,
    ...(hash === undefined ? {} : { hash }),
  })) {
    const frame = parseFrameLine(record.line, record.lineNumber, manifest.captureId, framesPath);
    if (previousSequence !== undefined && frame.sequence <= previousSequence) {
      throw new CaptureFormatError(
        'INVALID_SEQUENCE',
        'frame.sequence must be strictly increasing',
        {
          captureId: manifest.captureId,
          lineNumber: record.lineNumber,
          path: framesPath,
        },
      );
    }
    if (previousElapsedUs !== undefined && frame.elapsedUs < previousElapsedUs) {
      throw new CaptureFormatError('INVALID_ELAPSED_US', 'frame.elapsedUs must be non-decreasing', {
        captureId: manifest.captureId,
        lineNumber: record.lineNumber,
        path: framesPath,
      });
    }
    previousSequence = frame.sequence;
    previousElapsedUs = frame.elapsedUs;
    count += 1;
    yield frame;
  }

  if (count !== manifest.frameCount) {
    throw new CaptureFormatError(
      'FRAME_COUNT_MISMATCH',
      `manifest declares ${manifest.frameCount} frames but frames.jsonl contains ${count}`,
      { captureId: manifest.captureId, path: framesPath },
    );
  }
}

export async function verifyCapture(captureDir: string): Promise<VerifiedCapture> {
  const manifest = await readCaptureManifest(captureDir);
  const framesPath = join(captureDir, 'frames.jsonl');
  try {
    await access(framesPath);
  } catch (error) {
    throw new CaptureFormatError(
      'INVALID_FRAME_SHAPE',
      `cannot access ${framesPath}: ${String(error)}`,
      {
        captureId: manifest.captureId,
        path: framesPath,
      },
    );
  }

  const hash = createHash('sha256');
  let firstElapsedUs = 0;
  let lastElapsedUs = 0;
  let isFirst = true;
  for await (const frame of parseFrames(manifest, framesPath, hash)) {
    if (isFirst) {
      firstElapsedUs = frame.elapsedUs;
      isFirst = false;
    }
    lastElapsedUs = frame.elapsedUs;
  }
  const computedFramesSha256 = hash.digest('hex');
  if (manifest.framesSha256 !== undefined && manifest.framesSha256 !== computedFramesSha256) {
    throw new CaptureFormatError(
      'FRAMES_HASH_MISMATCH',
      `manifest framesSha256 ${manifest.framesSha256} does not match ${computedFramesSha256}`,
      { captureId: manifest.captureId, path: framesPath },
    );
  }

  return {
    directory: captureDir,
    framesPath,
    manifest,
    computedFramesSha256,
    firstElapsedUs,
    lastElapsedUs,
  };
}

export async function* iterateCaptureFrames(
  capture: VerifiedCapture,
): AsyncIterable<CaptureFrameV1> {
  yield* parseFrames(capture.manifest, capture.framesPath);
}
