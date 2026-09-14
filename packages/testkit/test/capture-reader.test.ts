import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCaptureManifest } from '../src/capture/manifest.js';
import { iterateCaptureFrames, verifyCapture } from '../src/capture/reader.js';
import { writeCapture, writeRawCapture, testFrame } from './helpers.js';

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rivalhub-testkit-reader-'));
}

describe('Capture V1 reader and verifier', () => {
  it('verifies a valid capture and streams frames without retaining them', async () => {
    const root = await temporaryDirectory();
    try {
      const frames = [testFrame(1, 1_000), testFrame(2, 2_000)];
      await writeCapture(root, frames);

      const verified = await verifyCapture(root);
      expect(verified.manifest.frameCount).toBe(2);
      expect(verified.firstElapsedUs).toBe(1_000);
      expect(verified.lastElapsedUs).toBe(2_000);
      const streamed = [];
      for await (const frame of iterateCaptureFrames(verified)) streamed.push(frame);
      expect(streamed).toEqual(frames);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts CRLF and tolerates receivedAt regression', async () => {
    const root = await temporaryDirectory();
    try {
      const frames = [
        testFrame(1, 1_000, {}, '2026-09-14T00:00:02.000Z'),
        testFrame(2, 2_000, {}, '2026-09-14T00:00:01.000Z'),
      ];
      await writeCapture(root, frames, { lineEnding: '\r\n' });
      await expect(verifyCapture(root)).resolves.toMatchObject({
        firstElapsedUs: 1_000,
        lastElapsedUs: 2_000,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('tolerates unknown manifest keys while returning the canonical V1 fields', async () => {
    const root = await temporaryDirectory();
    try {
      await writeCapture(root, [testFrame(1, 1_000)], {
        manifest: { providerVersion: 'unknown', futureField: { enabled: true } },
      });
      const manifest = await readCaptureManifest(root);
      expect(manifest).not.toHaveProperty('providerVersion');
      expect(manifest).toMatchObject({ formatVersion: 1, captureId: 'test-capture' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'unsupported formatVersion',
      (root: string) =>
        writeCapture(root, [testFrame(1, 1_000)], { manifest: { formatVersion: 2 } }),
      'UNSUPPORTED_FORMAT_VERSION',
    ],
    [
      'malformed manifest',
      async (root: string) => {
        await writeCapture(root, [testFrame(1, 1_000)]);
        await writeFile(join(root, 'manifest.json'), '{', 'utf8');
      },
      'INVALID_MANIFEST',
    ],
    [
      'malformed JSON line',
      async (root: string) => {
        await writeRawCapture(root, '{not-json}\n');
      },
      'INVALID_FRAME_JSON',
    ],
    [
      'non-object payload',
      async (root: string) => {
        const frame = JSON.stringify({ ...testFrame(1, 1_000), payload: [] });
        await writeRawCapture(root, `${frame}\n`);
      },
      'INVALID_FRAME_SHAPE',
    ],
    [
      'sequence regression',
      async (root: string) => {
        await writeCapture(root, [testFrame(2, 1_000), testFrame(1, 2_000)]);
      },
      'INVALID_SEQUENCE',
    ],
    [
      'elapsed regression',
      async (root: string) => {
        await writeCapture(root, [testFrame(1, 2_000), testFrame(2, 1_000)]);
      },
      'INVALID_ELAPSED_US',
    ],
    [
      'frame count mismatch',
      async (root: string) => {
        await writeCapture(root, [testFrame(1, 1_000)], { frameCount: 2 });
      },
      'FRAME_COUNT_MISMATCH',
    ],
    [
      'frames hash mismatch',
      async (root: string) => {
        await writeCapture(root, [testFrame(1, 1_000)], { framesSha256: '0'.repeat(64) });
      },
      'FRAMES_HASH_MISMATCH',
    ],
    [
      'invalid receivedAt',
      async (root: string) => {
        await writeCapture(root, [testFrame(1, 1_000, {}, '2026-09-14T00:00:00+08:00')]);
      },
      'INVALID_RECEIVED_AT',
    ],
  ])('%s reports a stable format error', async (_label, prepare, code) => {
    const root = await temporaryDirectory();
    try {
      await prepare(root);
      await expect(verifyCapture(root)).rejects.toMatchObject({ code });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
