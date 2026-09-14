import type { SourceSide } from '../telemetry/map.js';
import type { TelemetryObservation } from '../telemetry/observation.js';

export interface RuntimeTime {
  readonly monotonicMs: number;
  readonly utc: string;
}

export type LiveSessionBinding =
  { readonly kind: 'unbound' } | { readonly kind: 'bound'; readonly liveSessionId: string };

export interface RuntimeReceiveCursor {
  readonly generation: number;
  readonly sequence: number;
  readonly receivedAt: string;
  readonly receivedMonotonicMs: number;
}

export interface RuntimeProgramSourceState {
  readonly kind: 'cs2-gsi';
  readonly generation: number;
  readonly lastAccepted?: RuntimeReceiveCursor;
}

export interface RuntimeMapState {
  readonly epoch: number;
  readonly name?: string;
}

export interface RuntimeState {
  readonly producerInstanceId: string;
  readonly liveSession: LiveSessionBinding;
  readonly runtimeSeq: number;
  readonly programSource: RuntimeProgramSourceState;
  readonly map: RuntimeMapState;
  readonly programTelemetry?: TelemetryObservation;
}

export interface RuntimeContinuityPolicy {
  readonly staleAfterMs: number;
}

export type RuntimeInput =
  | {
      readonly kind: 'program-telemetry';
      readonly sourceGeneration: number;
      readonly observation: TelemetryObservation;
    }
  | {
      readonly kind: 'advance-program-source-generation';
      readonly nextGeneration: number;
      readonly at: RuntimeTime;
    }
  | {
      readonly kind: 'reset-map-execution';
      readonly reason: 'same-map-restart' | 'restore' | 'operator-correction';
      readonly at: RuntimeTime;
    };

export interface RuntimeTransitionBase {
  readonly runtimeSeq: number;
  readonly producerInstanceId: string;
  readonly liveSession: LiveSessionBinding;
  readonly mapEpoch: number;
  readonly at: RuntimeTime;
}

export interface ProgramTelemetryTransitionBase extends RuntimeTransitionBase {
  readonly sourceGeneration: number;
  readonly receiveSequence: number;
}

export interface RoundStartedTransition extends ProgramTelemetryTransitionBase {
  readonly kind: 'round_started';
  readonly roundNumber?: number;
}

export interface RoundEndedTransition extends ProgramTelemetryTransitionBase {
  readonly kind: 'round_ended';
  readonly roundNumber?: number;
  readonly winnerSide?: SourceSide;
}

export interface MapEndedTransition extends ProgramTelemetryTransitionBase {
  readonly kind: 'map_ended';
}

export type MapExecutionChangeReason = 'observed-map-name-change' | 'explicit-reset';

export interface MapExecutionChangedTransitionBase extends RuntimeTransitionBase {
  readonly kind: 'map_execution_changed';
  readonly previousMapEpoch: number;
  readonly previousMapName?: string;
  readonly mapName?: string;
}

export interface ObservedMapExecutionChangedTransition extends MapExecutionChangedTransitionBase {
  readonly reason: 'observed-map-name-change';
  readonly sourceGeneration: number;
  readonly receiveSequence: number;
}

export interface ExplicitMapExecutionChangedTransition extends MapExecutionChangedTransitionBase {
  readonly reason: 'explicit-reset';
}

export type MapExecutionChangedTransition =
  ObservedMapExecutionChangedTransition | ExplicitMapExecutionChangedTransition;

export type RuntimeTransition =
  | RoundStartedTransition
  | RoundEndedTransition
  | MapEndedTransition
  | MapExecutionChangedTransition;

export interface RuntimeSequenceRange {
  readonly from: number;
  readonly to: number;
}

export type RuntimeAcceptedDisposition =
  | {
      readonly kind: 'accepted';
      readonly reason: 'baseline' | 'contiguous' | 'gap-resync' | 'stale-recovery';
      readonly missingSequenceRange?: RuntimeSequenceRange;
    }
  | { readonly kind: 'accepted'; readonly reason: 'source-generation-advanced' }
  | { readonly kind: 'accepted'; readonly reason: 'map-execution-reset' };

export type RuntimeIgnoredReason =
  | 'duplicate'
  | 'out-of-order'
  | 'non-monotonic-time'
  | 'stale-generation'
  | 'generation-ahead'
  | 'invalid-generation-advance'
  | 'map-not-established';

export interface RuntimeIgnoredDisposition {
  readonly kind: 'ignored';
  readonly reason: RuntimeIgnoredReason;
}

export type RuntimeDisposition = RuntimeAcceptedDisposition | RuntimeIgnoredDisposition;

export interface RuntimeReduceResult {
  readonly state: RuntimeState;
  readonly transitions: readonly RuntimeTransition[];
  readonly disposition: RuntimeDisposition;
}

export function createInitialRuntimeState(
  producerInstanceId: string,
  liveSession: LiveSessionBinding = { kind: 'unbound' },
): RuntimeState {
  return {
    producerInstanceId,
    liveSession,
    runtimeSeq: 0,
    programSource: {
      kind: 'cs2-gsi',
      generation: 0,
    },
    map: {
      epoch: 0,
    },
  };
}
