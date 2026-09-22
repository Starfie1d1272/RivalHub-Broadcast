import type { BombState } from '../telemetry/bomb.js';
import type { TelemetryObservation } from '../telemetry/observation.js';
import policy from './objective-timing-policy.json' with { type: 'json' };

export const DEFAULT_OBJECTIVE_CLOCK_LEASE_MS = policy.defaultLeaseMs;
export const MAX_OBJECTIVE_CLOCK_LEASE_MS = policy.maxLeaseMs;

export type ObjectiveTimingContinuity = 'baseline' | 'contiguous' | 'gap-resync' | 'stale-recovery';

export interface RuntimeObjectiveTimingAnchor {
  readonly remainingSecondsAtSample: number;
  readonly sampledAtMonotonicMs: number;
  readonly source: 'bomb-planted-countdown';
}

/**
 * Core-owned objective timing continuity. The anchor is intentionally not a
 * wire field; ProgramProjection turns it into a current semantic clock.
 */
export interface RuntimeObjectiveTimingState {
  readonly sourceGeneration: number;
  readonly mapEpoch: number;
  readonly lastAcceptedReceiveSequence: number | null;
  readonly explosionAnchor: RuntimeObjectiveTimingAnchor | null;
  readonly lastBombState: BombState | null;
  readonly explosionDurationSeconds: number | null;
  readonly plantActionDurationSeconds: number | null;
}

export function createObjectiveTimingState(
  sourceGeneration: number,
  mapEpoch: number,
): RuntimeObjectiveTimingState {
  return {
    sourceGeneration,
    mapEpoch,
    lastAcceptedReceiveSequence: null,
    explosionAnchor: null,
    lastBombState: null,
    explosionDurationSeconds: null,
    plantActionDurationSeconds: null,
  };
}

function finiteCountdown(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function roundIsOver(observation: TelemetryObservation): boolean {
  return observation.coverage.round === 'present' && observation.telemetry.round?.phase === 'over';
}

/**
 * Reduce only the stateful objective timing seam. Raw bomb semantics remain
 * in telemetry-gsi; this function is the first place allowed to retain an
 * explosion countdown across the GSI state-dependent countdown overload.
 */
export function reduceObjectiveTiming(
  previous: RuntimeObjectiveTimingState,
  observation: TelemetryObservation,
  sourceGeneration: number,
  mapEpoch: number,
  continuity: ObjectiveTimingContinuity,
): RuntimeObjectiveTimingState {
  const canRetainPreviousAnchor = continuity === 'contiguous';
  const previousAnchor =
    canRetainPreviousAnchor &&
    previous.sourceGeneration === sourceGeneration &&
    previous.mapEpoch === mapEpoch
      ? previous.explosionAnchor
      : null;
  const bomb = observation.coverage.bomb === 'present' ? observation.telemetry.bomb : undefined;

  let explosionAnchor: RuntimeObjectiveTimingAnchor | null = null;
  if (!roundIsOver(observation) && bomb !== undefined) {
    switch (bomb.state ?? 'unknown') {
      case 'planted': {
        const countdown = finiteCountdown(bomb.countdownSeconds);
        explosionAnchor =
          countdown === undefined
            ? previousAnchor
            : {
                remainingSecondsAtSample: countdown,
                sampledAtMonotonicMs: observation.receive.receivedMonotonicMs,
                source: 'bomb-planted-countdown',
              };
        break;
      }
      case 'defusing':
        // bomb.countdown is the defuse action countdown in this state. It
        // must never replace the persistent detonation anchor.
        explosionAnchor = previousAnchor;
        break;
      default:
        explosionAnchor = null;
        break;
    }
  }

  const contiguous =
    canRetainPreviousAnchor &&
    previous.sourceGeneration === sourceGeneration &&
    previous.mapEpoch === mapEpoch;
  const state = !roundIsOver(observation) ? (bomb?.state ?? null) : null;
  const countdown = finiteCountdown(bomb?.countdownSeconds);
  const denominator = countdown !== undefined && countdown >= 0 ? countdown : null;
  let explosionDurationSeconds: number | null = null;
  let plantActionDurationSeconds: number | null = null;
  if (contiguous) {
    if (state === 'planting') {
      plantActionDurationSeconds =
        previous.lastBombState === 'planting'
          ? previous.plantActionDurationSeconds
          : previous.lastBombState === 'carried' || previous.lastBombState === 'dropped'
            ? denominator
            : null;
    }
    if (state === 'planted' || state === 'defusing') {
      explosionDurationSeconds = previous.explosionDurationSeconds;
      if (state === 'planted' && previous.lastBombState === 'planting')
        explosionDurationSeconds = denominator;
      else if (state === 'planted' && explosionDurationSeconds !== null && denominator !== null)
        explosionDurationSeconds = Math.max(explosionDurationSeconds, denominator);
    }
  }
  return {
    sourceGeneration,
    mapEpoch,
    lastBombState: state,
    explosionDurationSeconds,
    plantActionDurationSeconds,
    lastAcceptedReceiveSequence: observation.receive.sequence,
    explosionAnchor,
  };
}

export function remainingFromObjectiveAnchor(
  anchor: RuntimeObjectiveTimingAnchor,
  referenceMonotonicMs: number,
): number {
  return Math.max(
    0,
    anchor.remainingSecondsAtSample - (referenceMonotonicMs - anchor.sampledAtMonotonicMs) / 1_000,
  );
}
