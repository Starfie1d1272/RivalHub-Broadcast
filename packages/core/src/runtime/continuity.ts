import type {
  RuntimeContinuityPolicy,
  RuntimeDisposition,
  RuntimeInput,
  RuntimeState,
} from './types.js';

export type ProgramTelemetryInput = Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>;

type SequenceReason = 'baseline' | 'contiguous' | 'gap-resync';

export type ProgramTelemetryContinuityDecision =
  | {
      readonly kind: 'ignored';
      readonly reason: Extract<RuntimeDisposition, { readonly kind: 'ignored' }>['reason'];
    }
  | {
      readonly kind: 'accepted';
      readonly sequenceReason: SequenceReason;
      readonly staleRecovery: boolean;
      readonly missingSequenceRange?: { readonly from: number; readonly to: number };
    };

export function classifyProgramTelemetry(
  state: RuntimeState,
  input: ProgramTelemetryInput,
  policy: RuntimeContinuityPolicy,
): ProgramTelemetryContinuityDecision {
  const currentGeneration = state.programSource.generation;
  if (input.sourceGeneration < currentGeneration) {
    return { kind: 'ignored', reason: 'stale-generation' };
  }
  if (input.sourceGeneration > currentGeneration) {
    return { kind: 'ignored', reason: 'generation-ahead' };
  }

  const previousCursor = state.programSource.lastAccepted;
  const sequence = input.observation.receive.sequence;
  let sequenceReason: SequenceReason;
  let missingSequenceRange: { readonly from: number; readonly to: number } | undefined;
  if (previousCursor === undefined) {
    sequenceReason = 'baseline';
  } else if (sequence === previousCursor.sequence) {
    return { kind: 'ignored', reason: 'duplicate' };
  } else if (sequence < previousCursor.sequence) {
    return { kind: 'ignored', reason: 'out-of-order' };
  } else {
    if (input.observation.receive.receivedMonotonicMs < previousCursor.receivedMonotonicMs) {
      return { kind: 'ignored', reason: 'non-monotonic-time' };
    }
    if (sequence === previousCursor.sequence + 1) {
      sequenceReason = 'contiguous';
    } else {
      sequenceReason = 'gap-resync';
      missingSequenceRange = {
        from: previousCursor.sequence + 1,
        to: sequence - 1,
      };
    }
  }

  const staleRecovery =
    state.programTelemetry !== undefined &&
    previousCursor !== undefined &&
    previousCursor.generation === currentGeneration &&
    input.observation.receive.receivedMonotonicMs - previousCursor.receivedMonotonicMs >
      policy.staleAfterMs;

  return {
    kind: 'accepted',
    sequenceReason,
    staleRecovery,
    ...(missingSequenceRange === undefined ? {} : { missingSequenceRange }),
  };
}
