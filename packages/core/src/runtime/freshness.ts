import type { RuntimeContinuityPolicy, RuntimeState } from './types.js';

export type ProgramSourceFreshness = 'awaiting' | 'fresh' | 'stale';

export function assertRuntimeContinuityPolicy(policy: RuntimeContinuityPolicy): void {
  if (!Number.isFinite(policy.staleAfterMs) || policy.staleAfterMs < 0) {
    throw new RangeError('staleAfterMs must be a finite non-negative number');
  }
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
  if (
    state.programTelemetry === undefined ||
    cursor === undefined ||
    cursor.generation !== state.programSource.generation
  ) {
    return 'awaiting';
  }

  return nowMonotonicMs - cursor.receivedMonotonicMs > policy.staleAfterMs ? 'stale' : 'fresh';
}
