import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeObjectiveTimingCapture, renderObjectiveTimingReport } from './objective-timing.mjs';

const CREATED_AT = '2026-09-21T00:00:00.000Z';
const BROADCAST_COMMIT = 'a'.repeat(40);

function frame(sequence, elapsedMs, payload) {
  return {
    version: 1,
    sequence,
    elapsedUs: elapsedMs * 1_000,
    receivedAt: new Date(Date.parse(CREATED_AT) + elapsedMs).toISOString(),
    payload,
  };
}

async function createCapture(frames, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rivalhub-objective-timing-'));
  const captureDir = join(root, 'capture-1');
  await mkdir(captureDir, { recursive: true });
  const content = `${frames.map((value) => JSON.stringify(value)).join('\n')}\n`;
  await writeFile(join(captureDir, 'frames.jsonl'), content, 'utf8');
  await writeFile(
    join(captureDir, 'manifest.json'),
    `${JSON.stringify({
      formatVersion: 1,
      captureId: 'capture-1',
      createdAt: CREATED_AT,
      platform: 'win32-x64',
      broadcastCommit: BROADCAST_COMMIT,
      scenario: 'objective-timing-test',
      gsiConfig: {
        parameters: {
          precision_time: '3',
          timeout: '1.1',
          buffer: '0',
          throttle: '0',
          heartbeat: '10',
        },
      },
      complete: options.complete ?? true,
      frameCount: frames.length,
      droppedFrames: options.droppedFrames ?? 0,
      framesSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    })}\n`,
    'utf8',
  );
  return { root, captureDir };
}

describe('objective timing capture analyzer', () => {
  it('measures active cadence, semantic clock residuals, transitions, and terminals', async () => {
    const run = await createCapture([
      frame(0, 0, {
        bomb: { state: 'planting', countdown: '3.0' },
        phase_countdowns: { phase: 'live', phase_ends_in: '10.0' },
      }),
      frame(1, 100, {
        bomb: { state: 'planted', countdown: '30.0' },
        phase_countdowns: { phase: 'bomb', phase_ends_in: '30.0' },
      }),
      frame(2, 200, {
        bomb: { state: 'planted', countdown: '29.9' },
        phase_countdowns: { phase: 'bomb', phase_ends_in: '29.9' },
      }),
      frame(3, 300, {
        bomb: { state: 'defusing', countdown: '5.0' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '5.0' },
      }),
      frame(4, 400, {
        bomb: { state: 'defusing', countdown: '4.9' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '4.9' },
      }),
      frame(5, 500, { bomb: { state: 'defused' } }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.activeFrameCount).toBe(5);
      expect(result.capture.gsiConfig).toMatchObject({ precision_time: '3', timeout: '1.1' });
      expect(result.metrics.activePacketIntervalMs.p99).toBe(100);
      expect(result.metrics.countdownDeltaResidualMs.max).toBeCloseTo(0, 8);
      expect(result.metrics.stateTransitionToFirstCountMs.p95).toBe(0);
      expect(result.metrics.phaseComparisonResidualMs.max).toBeCloseTo(0, 8);
      expect(result.metrics.terminalEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'plant', to: 'planted' }),
          expect.objectContaining({ kind: 'defuse', remainingAtTerminalMs: 4_800 }),
        ]),
      );
      expect(result.qualification.numeric01s.result).toBe('PASS');
      expect(result.qualification.numeric001s.result).toBe('NOT_PROMISED');
      expect(renderObjectiveTimingReport(result)).toContain('precision_time');
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('reports reconnect gaps and refuses complete qualification for incomplete capture evidence', async () => {
    const run = await createCapture(
      [
        frame(0, 0, { bomb: { state: 'planted', countdown: '30' } }),
        frame(1, 100, { bomb: { state: 'planted', countdown: '29.9' } }),
        frame(2, 1_500, { bomb: { state: 'planted', countdown: '28.5' } }),
      ],
      { complete: false, droppedFrames: 1 },
    );

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.reconnectGaps).toMatchObject({ count: 1, maxMs: 1_400 });
      expect(result.qualification.numeric01s.result).toBe('FAIL');
      expect(result.qualification.numeric01s.gates.captureComplete).toBe(false);
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });
});
