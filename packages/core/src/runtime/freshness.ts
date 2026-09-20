import type { RuntimeContinuityPolicy, RuntimeState } from './types.js';
import {
  DEFAULT_OBJECTIVE_CLOCK_LEASE_MS,
  MAX_OBJECTIVE_CLOCK_LEASE_MS,
} from './objective-timing.js';

export type ProgramSourceFreshness = 'awaiting' | 'fresh' | 'stale';

export function assertRuntimeContinuityPolicy(policy: RuntimeContinuityPolicy): void {
  if (!Number.isFinite(policy.staleAfterMs) || policy.staleAfterMs < 0) {
    throw new RangeError('staleAfterMs must be a finite non-negative number');
  }
  const objectiveClockLeaseMs = policy.objectiveClockLeaseMs ?? DEFAULT_OBJECTIVE_CLOCK_LEASE_MS;
  if (
    !Number.isFinite(objectiveClockLeaseMs) ||
    objectiveClockLeaseMs <= 0 ||
    objectiveClockLeaseMs > MAX_OBJECTIVE_CLOCK_LEASE_MS
  ) {
    throw new RangeError(
      `objectiveClockLeaseMs must be a finite number between 1 and ${MAX_OBJECTIVE_CLOCK_LEASE_MS} ms`,
    );
  }
}

export function getObjectiveClockLeaseMs(policy: RuntimeContinuityPolicy): number {
  assertRuntimeContinuityPolicy(policy);
  return policy.objectiveClockLeaseMs ?? DEFAULT_OBJECTIVE_CLOCK_LEASE_MS;
}

export function getProgramSourceFreshness(
  state: RuntimeState,
  nowMonotonicMs: number,
  policy: RuntimeContinuityPolicy,
): ProgramSourceFreshness {
  assertRuntimeContinuityPolicy(policy);
  if (!Number.isFinite(nowMonotonicMs)) {
    throw new RangeError('nowMonotonicMs must be a finite number');
  }

  const cursor = state.programSource.lastAccepted;
  if (cursor !== undefined && nowMonotonicMs < cursor.receivedMonotonicMs) {
    throw new RangeError(
      'nowMonotonicMs must not precede the program source receive monotonic time',
    );
  }
  if (
    state.programTelemetry === undefined ||
    cursor === undefined ||
    cursor.generation !== state.programSource.generation
  ) {
    return 'awaiting';
  }

  return nowMonotonicMs - cursor.receivedMonotonicMs > policy.staleAfterMs ? 'stale' : 'fresh';
}
