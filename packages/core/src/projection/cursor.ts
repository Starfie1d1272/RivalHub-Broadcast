import type { RuntimeState } from '../runtime/types.js';

/**
 * The continuity identity shared by consumer projections and local snapshots.
 * It deliberately contains no consumer-specific semantic payload.
 */
export interface ProjectionCursor {
  readonly producerInstanceId: string;
  readonly liveSessionId: string | null;
  readonly runtimeSeq: number;
  readonly programSourceGeneration: number;
  readonly programReceiveSequence: number | null;
  readonly mapEpoch: number;
}

export function projectionCursorFromRuntimeState(state: RuntimeState): ProjectionCursor {
  const lastAccepted = state.programSource.lastAccepted;
  const receiveSequence =
    lastAccepted?.generation === state.programSource.generation ? lastAccepted.sequence : null;
  return {
    producerInstanceId: state.producerInstanceId,
    liveSessionId: state.liveSession.kind === 'bound' ? state.liveSession.liveSessionId : null,
    runtimeSeq: state.runtimeSeq,
    programSourceGeneration: state.programSource.generation,
    programReceiveSequence: receiveSequence,
    mapEpoch: state.map.epoch,
  };
}
