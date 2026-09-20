import type {
  MapPlayerStatsAccumulator,
  RuntimeContinuityPolicy,
  RuntimeObjectiveTimingState,
  RuntimeState,
} from '../runtime/index.js';
import type { TelemetryObservation } from '../telemetry/observation.js';
import { projectionCursorFromRuntimeState, type ProjectionCursor } from './cursor.js';

export type ProgramSafeRuntimeFreshness = 'awaiting' | 'fresh' | 'stale';

export interface ProgramSafeRuntimeView {
  readonly cursor: ProjectionCursor;
  readonly programSourceLastAccepted: null | {
    readonly receivedAt: string;
    readonly receivedMonotonicMs: number;
  };
  readonly playerStats: MapPlayerStatsAccumulator;
  readonly objectiveTiming: RuntimeObjectiveTimingState;
  readonly telemetry: TelemetryObservation | null;
}

export function selectProgramSafeRuntimeView(state: RuntimeState): ProgramSafeRuntimeView {
  const lastAccepted = state.programSource.lastAccepted;
  const currentGenerationLastAccepted =
    lastAccepted?.generation === state.programSource.generation ? lastAccepted : undefined;
  return {
    cursor: projectionCursorFromRuntimeState(state),
    programSourceLastAccepted:
      currentGenerationLastAccepted === undefined
        ? null
        : {
            receivedAt: currentGenerationLastAccepted.receivedAt,
            receivedMonotonicMs: currentGenerationLastAccepted.receivedMonotonicMs,
          },
    objectiveTiming: state.objectiveTiming,
    playerStats: state.playerStats,
    telemetry:
      currentGenerationLastAccepted === undefined ? null : (state.programTelemetry ?? null),
  };
}

function assertPolicy(policy: RuntimeContinuityPolicy): void {
  if (!Number.isFinite(policy.staleAfterMs) || policy.staleAfterMs < 0) {
    throw new RangeError('staleAfterMs must be a finite non-negative number');
  }
}

export function getProgramSafeRuntimeFreshness(
  view: ProgramSafeRuntimeView,
  nowMonotonicMs: number,
  policy: RuntimeContinuityPolicy,
): ProgramSafeRuntimeFreshness {
  assertPolicy(policy);
  if (!Number.isFinite(nowMonotonicMs)) {
    throw new RangeError('nowMonotonicMs must be a finite number');
  }

  const lastAccepted = view.programSourceLastAccepted;
  if (lastAccepted !== null && nowMonotonicMs < lastAccepted.receivedMonotonicMs) {
    throw new RangeError(
      'nowMonotonicMs must not precede the program source receive monotonic time',
    );
  }
  if (view.telemetry === null || lastAccepted === null) {
    return 'awaiting';
  }

  return nowMonotonicMs - lastAccepted.receivedMonotonicMs > policy.staleAfterMs
    ? 'stale'
    : 'fresh';
}
