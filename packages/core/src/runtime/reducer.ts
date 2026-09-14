import { assertRuntimeContinuityPolicy } from './freshness.js';
import type {
  LiveSessionBinding,
  ExplicitMapExecutionChangedTransition,
  MapExecutionChangedTransition,
  ObservedMapExecutionChangedTransition,
  ProgramTelemetryTransitionBase,
  RuntimeAcceptedDisposition,
  RuntimeContinuityPolicy,
  RuntimeIgnoredDisposition,
  RuntimeInput,
  RuntimeReduceResult,
  RuntimeState,
  RuntimeTime,
  RuntimeTransition,
  RuntimeTransitionBase,
} from './types.js';

const NO_TRANSITIONS: readonly RuntimeTransition[] = [];

function ignored(
  state: RuntimeState,
  reason: RuntimeIgnoredDisposition['reason'],
): RuntimeReduceResult {
  return {
    state,
    transitions: NO_TRANSITIONS,
    disposition: { kind: 'ignored', reason },
  };
}

function accepted(
  state: RuntimeState,
  disposition: RuntimeAcceptedDisposition,
  transitions: readonly RuntimeTransition[] = NO_TRANSITIONS,
): RuntimeReduceResult {
  return { state, transitions, disposition };
}

function copyLiveSession(liveSession: LiveSessionBinding): LiveSessionBinding {
  return liveSession.kind === 'bound'
    ? { kind: 'bound', liveSessionId: liveSession.liveSessionId }
    : { kind: 'unbound' };
}

function copyRuntimeTime(at: RuntimeTime): RuntimeTime {
  return { monotonicMs: at.monotonicMs, utc: at.utc };
}

function transitionBase(
  state: RuntimeState,
  runtimeSeq: number,
  mapEpoch: number,
  at: RuntimeTime,
): RuntimeTransitionBase {
  return {
    runtimeSeq,
    producerInstanceId: state.producerInstanceId,
    liveSession: copyLiveSession(state.liveSession),
    mapEpoch,
    at: copyRuntimeTime(at),
  };
}

function programTransitionBase(
  state: RuntimeState,
  nextRuntimeSeq: number,
  nextMapEpoch: number,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
): ProgramTelemetryTransitionBase {
  return {
    ...transitionBase(state, nextRuntimeSeq, nextMapEpoch, {
      monotonicMs: input.observation.receive.receivedMonotonicMs,
      utc: input.observation.receive.receivedAt,
    }),
    sourceGeneration: input.sourceGeneration,
    receiveSequence: input.observation.receive.sequence,
  };
}

function knownMapName(
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
): string | undefined {
  if (input.observation.coverage.map !== 'present') return undefined;
  const name = input.observation.telemetry.map?.name;
  return name !== undefined && name.trim().length > 0 ? name : undefined;
}

function mapNameChanged(state: RuntimeState, mapName: string | undefined): boolean {
  return (
    mapName !== undefined &&
    state.map.epoch > 0 &&
    state.map.name !== undefined &&
    state.map.name !== mapName
  );
}

function nextMapState(
  state: RuntimeState,
  mapName: string | undefined,
): { readonly map: RuntimeState['map']; readonly established: boolean; readonly changed: boolean } {
  if (state.map.epoch === 0 && mapName !== undefined) {
    return { map: { epoch: 1, name: mapName }, established: true, changed: false };
  }

  if (mapName !== undefined && mapNameChanged(state, mapName)) {
    return {
      map: { epoch: state.map.epoch + 1, name: mapName },
      established: false,
      changed: true,
    };
  }

  if (state.map.name === undefined && mapName !== undefined) {
    return { map: { ...state.map, name: mapName }, established: false, changed: false };
  }

  return { map: state.map, established: false, changed: false };
}

function hasRoundPhase(
  state: RuntimeState | undefined,
  phase: 'freezetime' | 'live' | 'over',
): boolean {
  return (
    state?.programTelemetry !== undefined &&
    state.programTelemetry.coverage.round === 'present' &&
    state.programTelemetry.telemetry.round?.phase === phase
  );
}

function hasCurrentRoundPhase(
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
  phase: 'freezetime' | 'live' | 'over',
): boolean {
  return (
    input.observation.coverage.round === 'present' &&
    input.observation.telemetry.round?.phase === phase
  );
}

function hasKnownMapPhase(state: RuntimeState | undefined, phase: 'gameover'): boolean {
  return (
    state?.programTelemetry !== undefined &&
    state.programTelemetry.coverage.map === 'present' &&
    state.programTelemetry.telemetry.map?.phase !== undefined &&
    state.programTelemetry.telemetry.map.phase !== 'unknown' &&
    state.programTelemetry.telemetry.map.phase !== phase
  );
}

function hasCurrentMapPhase(
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
  phase: 'gameover',
): boolean {
  return (
    input.observation.coverage.map === 'present' && input.observation.telemetry.map?.phase === phase
  );
}

function roundStartedTransition(
  state: RuntimeState,
  nextRuntimeSeq: number,
  nextMapEpoch: number,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
): RuntimeTransition {
  const base = programTransitionBase(state, nextRuntimeSeq, nextMapEpoch, input);
  const roundNumber = input.observation.telemetry.map?.roundNumber;
  return {
    kind: 'round_started',
    ...base,
    ...(roundNumber === undefined ? {} : { roundNumber }),
  };
}

function roundEndedTransition(
  state: RuntimeState,
  nextRuntimeSeq: number,
  nextMapEpoch: number,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
): RuntimeTransition {
  const base = programTransitionBase(state, nextRuntimeSeq, nextMapEpoch, input);
  const round = input.observation.telemetry.round;
  const roundNumber = input.observation.telemetry.map?.roundNumber;
  return {
    kind: 'round_ended',
    ...base,
    ...(roundNumber === undefined ? {} : { roundNumber }),
    ...(round?.winnerSide === undefined ? {} : { winnerSide: round.winnerSide }),
  };
}

function mapEndedTransition(
  state: RuntimeState,
  nextRuntimeSeq: number,
  nextMapEpoch: number,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
): RuntimeTransition {
  return {
    kind: 'map_ended',
    ...programTransitionBase(state, nextRuntimeSeq, nextMapEpoch, input),
  };
}

function mapExecutionChangedTransitionBase(
  state: RuntimeState,
  nextState: RuntimeState,
  at: RuntimeTime,
): Omit<MapExecutionChangedTransition, 'reason' | 'sourceGeneration' | 'receiveSequence'> {
  return {
    kind: 'map_execution_changed',
    ...transitionBase(state, nextState.runtimeSeq, nextState.map.epoch, at),
    previousMapEpoch: state.map.epoch,
    ...(state.map.name === undefined ? {} : { previousMapName: state.map.name }),
    ...(nextState.map.name === undefined ? {} : { mapName: nextState.map.name }),
  };
}

function observedMapExecutionChangedTransition(
  state: RuntimeState,
  nextState: RuntimeState,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
): ObservedMapExecutionChangedTransition {
  return {
    ...mapExecutionChangedTransitionBase(state, nextState, {
      monotonicMs: input.observation.receive.receivedMonotonicMs,
      utc: input.observation.receive.receivedAt,
    }),
    reason: 'observed-map-name-change',
    sourceGeneration: input.sourceGeneration,
    receiveSequence: input.observation.receive.sequence,
  };
}

function explicitMapExecutionChangedTransition(
  state: RuntimeState,
  nextState: RuntimeState,
  at: RuntimeTime,
): ExplicitMapExecutionChangedTransition {
  return {
    ...mapExecutionChangedTransitionBase(state, nextState, at),
    reason: 'explicit-reset',
  };
}

function buildTelemetryTransitions(
  state: RuntimeState,
  nextState: RuntimeState,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
  sequenceIsContiguous: boolean,
  staleRecovery: boolean,
  mapBoundary: boolean,
): readonly RuntimeTransition[] {
  if (
    !sequenceIsContiguous ||
    staleRecovery ||
    mapBoundary ||
    state.programTelemetry === undefined
  ) {
    return NO_TRANSITIONS;
  }

  const transitions: RuntimeTransition[] = [];
  if (hasRoundPhase(state, 'freezetime') && hasCurrentRoundPhase(input, 'live')) {
    transitions.push(
      roundStartedTransition(state, nextState.runtimeSeq, nextState.map.epoch, input),
    );
  }
  if (hasRoundPhase(state, 'live') && hasCurrentRoundPhase(input, 'over')) {
    transitions.push(roundEndedTransition(state, nextState.runtimeSeq, nextState.map.epoch, input));
  }
  if (hasKnownMapPhase(state, 'gameover') && hasCurrentMapPhase(input, 'gameover')) {
    transitions.push(mapEndedTransition(state, nextState.runtimeSeq, nextState.map.epoch, input));
  }
  return transitions;
}

function reduceProgramTelemetry(
  state: RuntimeState,
  input: Extract<RuntimeInput, { readonly kind: 'program-telemetry' }>,
  policy: RuntimeContinuityPolicy,
): RuntimeReduceResult {
  const currentGeneration = state.programSource.generation;
  if (input.sourceGeneration < currentGeneration) {
    return ignored(state, 'stale-generation');
  }
  if (input.sourceGeneration > currentGeneration) {
    return ignored(state, 'generation-ahead');
  }

  const previousCursor = state.programSource.lastAccepted;
  const sequence = input.observation.receive.sequence;
  let sequenceReason: 'baseline' | 'contiguous' | 'gap-resync';
  let missingSequenceRange;
  if (previousCursor === undefined) {
    sequenceReason = 'baseline';
  } else if (sequence === previousCursor.sequence) {
    return ignored(state, 'duplicate');
  } else if (sequence < previousCursor.sequence) {
    return ignored(state, 'out-of-order');
  } else {
    if (input.observation.receive.receivedMonotonicMs < previousCursor.receivedMonotonicMs) {
      return ignored(state, 'non-monotonic-time');
    }
    if (sequence === previousCursor.sequence + 1) {
      sequenceReason = 'contiguous';
    } else {
      sequenceReason = 'gap-resync';
      missingSequenceRange = {
        from: previousCursor.sequence + 1,
        to: sequence - 1,
      } as const;
    }
  }

  const staleRecovery =
    state.programTelemetry !== undefined &&
    previousCursor !== undefined &&
    previousCursor.generation === currentGeneration &&
    input.observation.receive.receivedMonotonicMs - previousCursor.receivedMonotonicMs >
      policy.staleAfterMs;
  const mapName = knownMapName(input);
  const mapResult = nextMapState(state, mapName);
  const nextState: RuntimeState = {
    producerInstanceId: state.producerInstanceId,
    liveSession: state.liveSession,
    runtimeSeq: state.runtimeSeq + 1,
    programSource: {
      kind: 'cs2-gsi',
      generation: currentGeneration,
      lastAccepted: {
        generation: currentGeneration,
        sequence,
        receivedAt: input.observation.receive.receivedAt,
        receivedMonotonicMs: input.observation.receive.receivedMonotonicMs,
      },
    },
    map: mapResult.map,
    programTelemetry: input.observation,
  };

  const mapBoundary = mapResult.established || mapResult.changed;
  const transitions = mapResult.changed
    ? [observedMapExecutionChangedTransition(state, nextState, input)]
    : buildTelemetryTransitions(
        state,
        nextState,
        input,
        sequenceReason === 'contiguous',
        staleRecovery,
        mapBoundary,
      );

  const disposition: RuntimeAcceptedDisposition = staleRecovery
    ? {
        kind: 'accepted',
        reason: 'stale-recovery',
        ...(missingSequenceRange === undefined ? {} : { missingSequenceRange }),
      }
    : sequenceReason === 'gap-resync'
      ? missingSequenceRange === undefined
        ? { kind: 'accepted', reason: 'gap-resync' }
        : { kind: 'accepted', reason: 'gap-resync', missingSequenceRange }
      : { kind: 'accepted', reason: sequenceReason };

  return accepted(nextState, disposition, transitions);
}

function reduceGenerationAdvance(
  state: RuntimeState,
  input: Extract<RuntimeInput, { readonly kind: 'advance-program-source-generation' }>,
): RuntimeReduceResult {
  if (input.nextGeneration !== state.programSource.generation + 1) {
    return ignored(state, 'invalid-generation-advance');
  }

  const nextState: RuntimeState = {
    producerInstanceId: state.producerInstanceId,
    liveSession: state.liveSession,
    runtimeSeq: state.runtimeSeq + 1,
    programSource: {
      ...state.programSource,
      generation: input.nextGeneration,
    },
    map: state.map,
  };
  return accepted(nextState, { kind: 'accepted', reason: 'source-generation-advanced' });
}

function reduceMapReset(
  state: RuntimeState,
  input: Extract<RuntimeInput, { readonly kind: 'reset-map-execution' }>,
): RuntimeReduceResult {
  if (state.map.epoch === 0) {
    return ignored(state, 'map-not-established');
  }

  const nextState: RuntimeState = {
    producerInstanceId: state.producerInstanceId,
    liveSession: state.liveSession,
    runtimeSeq: state.runtimeSeq + 1,
    programSource: state.programSource,
    map: {
      ...state.map,
      epoch: state.map.epoch + 1,
    },
  };
  const transition = explicitMapExecutionChangedTransition(state, nextState, input.at);
  return accepted(nextState, { kind: 'accepted', reason: 'map-execution-reset' }, [transition]);
}

export function reduceRuntime(
  state: RuntimeState,
  input: RuntimeInput,
  policy: RuntimeContinuityPolicy,
): RuntimeReduceResult {
  assertRuntimeContinuityPolicy(policy);
  switch (input.kind) {
    case 'program-telemetry':
      return reduceProgramTelemetry(state, input, policy);
    case 'advance-program-source-generation':
      return reduceGenerationAdvance(state, input);
    case 'reset-map-execution':
      return reduceMapReset(state, input);
  }
}
