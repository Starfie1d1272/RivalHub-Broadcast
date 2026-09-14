import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { digestReplayEvents } from '../src/replay/digest.js';
import { replayCapture } from '../src/replay/runner.js';
import { iterateCaptureFrames, verifyCapture } from '../src/capture/reader.js';

const GOLD_FIXTURES = [
  {
    name: 'observer-demo-warmup',
    frameCount: 157,
    firstSequence: 0,
    lastSequence: 156,
    sourceFramesSha256: '519cec4f94f93b2cbc3b34d5e32d60e428039a94b3999d058a56910afcd7c5f9',
    framesSha256: '03d3941307f8c7e5c7ab9a575e7b594ea33efe748554c967f033c57a1875c003',
    digest: '1227e024eee4b304dfe770e81890bfd9f7c5e85b39e9ce67b9e02cb831eb61ea',
    selection: { kind: 'all' },
  },
  {
    name: 'local-bot-spectator-live',
    frameCount: 261,
    firstSequence: 540,
    lastSequence: 800,
    sourceFramesSha256: 'e34505e2626dfa6f0941b8b4ed675dbea38e2ff53e29e3240c36ad7a2673d218',
    framesSha256: 'ccf207ecd8b86c5a14f6f8901fff1688ee7e4892542013540fc2a8add2fb81b2',
    digest: 'ad623f2e0212f4bedcb8858c1aa924f301b1524c44a303d48e72ad76d44c5589',
    selection: { kind: 'sequence-range', firstSequence: 540, lastSequence: 800 },
  },
] as const;

describe('real sanitized gold capture replay', () => {
  it.each(GOLD_FIXTURES)('$name verifies provenance and semantic digest', async (fixture) => {
    const capture = await verifyCapture(resolve(process.cwd(), 'fixtures/gsi/gold', fixture.name));
    expect(capture.manifest.frameCount).toBe(fixture.frameCount);
    expect(capture.manifest.framesSha256).toBe(fixture.framesSha256);
    expect(capture.manifest.provenance).toMatchObject({
      fixtureKind: 'sanitized-real-capture',
      sourceFramesSha256: fixture.sourceFramesSha256,
      sourceFrameSelection: fixture.selection,
      sanitizerVersion: 1,
    });

    const firstAndLast: number[] = [];
    for await (const frame of iterateCaptureFrames(capture)) {
      if (firstAndLast.length === 0) firstAndLast.push(frame.sequence);
      firstAndLast[1] = frame.sequence;
    }
    expect(firstAndLast).toEqual([fixture.firstSequence, fixture.lastSequence]);

    const digest = await digestReplayEvents(replayCapture(capture, { mode: { kind: 'step' } }));
    expect(digest).toEqual({
      frameCount: fixture.frameCount,
      boundaryCount: 0,
      digest: fixture.digest,
    });
  });

  it('contains no raw identity or auth material in committed gold bytes', async () => {
    for (const fixture of GOLD_FIXTURES) {
      const dir = resolve(process.cwd(), 'fixtures/gsi/gold', fixture.name);
      const [manifest, frames] = await Promise.all([
        readFile(resolve(dir, 'manifest.json'), 'utf8'),
        readFile(resolve(dir, 'frames.jsonl'), 'utf8'),
      ]);
      const bytes = `${manifest}\n${frames}`;
      expect(bytes).not.toMatch(/\b\d{17}\b/);
      expect(bytes).not.toMatch(/auth|token|password|secret|endpoint|uri/i);
    }
  });
});
