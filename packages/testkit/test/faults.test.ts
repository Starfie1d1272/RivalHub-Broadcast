import { describe, expect, it } from 'vitest';

import { FaultPlanError } from '../src/capture/errors.js';
import { normalizeFaultPlan } from '../src/replay/faults.js';

describe('Replay V1 fault plan', () => {
  it('normalizes selector arrays deterministically', () => {
    const normalized = normalizeFaultPlan(
      {
        drop: [4, 0],
        duplicate: [
          { captureIndex: 3, copies: 2 },
          { captureIndex: 1, copies: 1 },
        ],
        reorderAdjacent: [6],
        timeGap: [
          { afterCaptureIndex: 5, gapUs: 3_000 },
          { afterCaptureIndex: 1, gapUs: 1_000 },
        ],
        sourceGenerationBoundary: [{ beforeCaptureIndex: 8 }],
      },
      10,
    );

    expect([...normalized.drop]).toEqual([0, 4]);
    expect([...normalized.duplicate]).toEqual([
      [1, 1],
      [3, 2],
    ]);
    expect(normalized.timeGap).toEqual([
      { afterCaptureIndex: 1, gapUs: 1_000 },
      { afterCaptureIndex: 5, gapUs: 3_000 },
    ]);
  });

  it.each([
    ['drop out of range', { drop: [4] }, 4],
    ['reorder out of range', { reorderAdjacent: [3] }, 4],
    ['boundary out of range', { sourceGenerationBoundary: [{ beforeCaptureIndex: 4 }] }, 4],
    ['duplicate out of range', { duplicate: [{ captureIndex: 4, copies: 1 }] }, 4],
    ['gap out of range', { timeGap: [{ afterCaptureIndex: 4, gapUs: 1_000 }] }, 4],
    ['duplicate copies below one', { duplicate: [{ captureIndex: 1, copies: 0 }] }, 4],
    ['duplicate copies above eight', { duplicate: [{ captureIndex: 1, copies: 9 }] }, 4],
    ['gap is not millisecond-aligned', { timeGap: [{ afterCaptureIndex: 1, gapUs: 1_001 }] }, 4],
  ])('%s is rejected', (_label, plan, frameCount) => {
    expect(() => normalizeFaultPlan(plan, frameCount)).toThrow(FaultPlanError);
  });

  it.each([
    ['overlapping reorder pairs', { reorderAdjacent: [1, 2] }],
    ['drop and duplicate conflict', { drop: [1], duplicate: [{ captureIndex: 1, copies: 1 }] }],
    [
      'reorder and boundary conflict',
      {
        reorderAdjacent: [1],
        sourceGenerationBoundary: [{ beforeCaptureIndex: 2 }],
      },
    ],
    [
      'duplicate selector repeated',
      {
        duplicate: [
          { captureIndex: 1, copies: 1 },
          { captureIndex: 1, copies: 2 },
        ],
      },
    ],
    [
      'gap boundary repeated',
      {
        timeGap: [
          { afterCaptureIndex: 1, gapUs: 1_000 },
          { afterCaptureIndex: 1, gapUs: 2_000 },
        ],
      },
    ],
  ])('%s fails closed', (_label, plan) => {
    expect(() => normalizeFaultPlan(plan, 5)).toThrow(FaultPlanError);
  });
});
