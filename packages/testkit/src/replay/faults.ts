import { FaultPlanError } from '../capture/errors.js';
import type { ReplayFaultPlanV1 } from './types.js';

export interface NormalizedFaultPlan {
  readonly drop: ReadonlySet<number>;
  readonly duplicate: ReadonlyMap<number, number>;
  readonly reorderAdjacent: ReadonlySet<number>;
  readonly timeGap: readonly { readonly afterCaptureIndex: number; readonly gapUs: number }[];
  readonly sourceGenerationBoundary: ReadonlySet<number>;
}

function assertIndex(value: unknown, label: string, maxExclusive: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= maxExclusive
  ) {
    throw new FaultPlanError(`${label} must be an in-range non-negative safe integer`);
  }
  return value;
}

function uniqueIndexSet(
  values: readonly number[] | undefined,
  label: string,
  maxExclusive: number,
) {
  const result = new Set<number>();
  for (const value of [...(values ?? [])].sort((left, right) => left - right)) {
    const index = assertIndex(value, label, maxExclusive);
    if (result.has(index)) throw new FaultPlanError(`${label} contains duplicate index ${index}`);
    result.add(index);
  }
  return result;
}

export function normalizeFaultPlan(
  plan: ReplayFaultPlanV1 | undefined,
  frameCount: number,
): NormalizedFaultPlan {
  if (plan === undefined) {
    return {
      drop: new Set(),
      duplicate: new Map(),
      reorderAdjacent: new Set(),
      timeGap: [],
      sourceGenerationBoundary: new Set(),
    };
  }
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
    throw new FaultPlanError('frameCount must be a non-negative safe integer');
  }

  const drop = uniqueIndexSet(plan.drop, 'drop', frameCount);
  const reorderAdjacent = uniqueIndexSet(
    plan.reorderAdjacent,
    'reorderAdjacent',
    Math.max(frameCount - 1, 0),
  );
  const sourceGenerationBoundary = uniqueIndexSet(
    plan.sourceGenerationBoundary?.map((entry) => entry.beforeCaptureIndex),
    'sourceGenerationBoundary.beforeCaptureIndex',
    frameCount,
  );

  const duplicate = new Map<number, number>();
  for (const entry of [...(plan.duplicate ?? [])].sort(
    (left, right) => left.captureIndex - right.captureIndex,
  )) {
    if (duplicate.has(entry.captureIndex)) {
      throw new FaultPlanError(`duplicate contains duplicate index ${entry.captureIndex}`);
    }
    const index = assertIndex(entry.captureIndex, 'duplicate.captureIndex', frameCount);
    if (!Number.isSafeInteger(entry.copies) || entry.copies < 1 || entry.copies > 8) {
      throw new FaultPlanError('duplicate.copies must be a safe integer from 1 through 8');
    }
    duplicate.set(index, entry.copies);
  }

  const timeGap = [...(plan.timeGap ?? [])]
    .map((entry) => {
      const afterCaptureIndex = assertIndex(
        entry.afterCaptureIndex,
        'timeGap.afterCaptureIndex',
        frameCount,
      );
      if (!Number.isSafeInteger(entry.gapUs) || entry.gapUs <= 0 || entry.gapUs % 1000 !== 0) {
        throw new FaultPlanError('timeGap.gapUs must be a positive safe integer divisible by 1000');
      }
      return { afterCaptureIndex, gapUs: entry.gapUs };
    })
    .sort((left, right) => left.afterCaptureIndex - right.afterCaptureIndex);
  for (let index = 1; index < timeGap.length; index += 1) {
    if (timeGap[index]?.afterCaptureIndex === timeGap[index - 1]?.afterCaptureIndex) {
      throw new FaultPlanError(
        `timeGap contains duplicate boundary ${timeGap[index]?.afterCaptureIndex ?? ''}`,
      );
    }
  }

  const structuralOwners = new Map<number, string>();
  const claim = (index: number, owner: string) => {
    const previous = structuralOwners.get(index);
    if (previous !== undefined) {
      throw new FaultPlanError(
        `captureIndex ${index} has conflicting structural faults: ${previous}, ${owner}`,
      );
    }
    structuralOwners.set(index, owner);
  };
  for (const index of drop) claim(index, 'drop');
  for (const index of duplicate.keys()) claim(index, 'duplicate');
  for (const index of reorderAdjacent) {
    claim(index, 'reorderAdjacent');
    claim(index + 1, 'reorderAdjacent');
  }
  for (const index of sourceGenerationBoundary) claim(index, 'sourceGenerationBoundary');

  return {
    drop,
    duplicate,
    reorderAdjacent,
    timeGap,
    sourceGenerationBoundary,
  };
}
