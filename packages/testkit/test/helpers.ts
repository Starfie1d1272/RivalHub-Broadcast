import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CaptureFrameV1, CaptureManifestV1 } from '../src/capture/types.js';

export const BASE_CREATED_AT = '2026-09-14T00:00:00.000Z';

export function testFrame(
  sequence: number,
  elapsedUs: number,
  payload: Record<string, unknown> = {},
  receivedAt = `2026-09-14T00:00:${String(sequence).padStart(2, '0')}.000Z`,
): CaptureFrameV1 {
  return { version: 1, sequence, elapsedUs, receivedAt, payload };
}

export function replayPayload(index: number): Record<string, unknown> {
  return {
    provider: { timestamp: 1_700_000_000 + index },
    map: { name: 'de_mirage', phase: 'live' },
    player: {
      steamid: '76561198000000001',
      name: 'Fixture Player Source',
      team: 'CT',
      state: { health: 100 },
      position: '0, 0, 0',
      forward: '1, 0, 0',
    },
  };
}

export interface RawCaptureOptions {
  readonly frameCount?: number;
  readonly framesSha256?: string;
  readonly manifest?: Record<string, unknown>;
}

export async function writeRawCapture(
  captureDir: string,
  framesText: string,
  options: RawCaptureOptions = {},
): Promise<void> {
  await mkdir(captureDir, { recursive: true });
  const frameCount =
    options.frameCount ??
    (framesText.length === 0 ? 0 : framesText.replace(/\r\n/g, '\n').trimEnd().split('\n').length);
  const framesSha256 =
    options.framesSha256 ?? createHash('sha256').update(framesText, 'utf8').digest('hex');
  const manifest: CaptureManifestV1 = {
    formatVersion: 1,
    captureId: 'test-capture',
    createdAt: BASE_CREATED_AT,
    platform: 'test',
    broadcastCommit: 'test-commit',
    scenario: 'test-scenario',
    gsiConfig: {
      parameters: { timeout: 5 },
      components: ['provider', 'map'],
    },
    complete: true,
    frameCount,
    droppedFrames: 0,
    framesSha256,
    ...options.manifest,
  };
  await writeFile(join(captureDir, 'frames.jsonl'), framesText, 'utf8');
  await writeFile(join(captureDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

export async function writeCapture(
  captureDir: string,
  frames: readonly CaptureFrameV1[],
  options: RawCaptureOptions & { readonly lineEnding?: '\n' | '\r\n' } = {},
): Promise<void> {
  const lineEnding = options.lineEnding ?? '\n';
  const framesText = `${frames.map((frame) => JSON.stringify(frame)).join(lineEnding)}${
    frames.length === 0 ? '' : lineEnding
  }`;
  await writeRawCapture(captureDir, framesText, options);
}
