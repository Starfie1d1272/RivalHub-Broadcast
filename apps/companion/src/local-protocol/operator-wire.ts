import { operatorPayloadSchema, type OperatorPayload } from '@rivalhub-broadcast/protocol/operator';

import type { OperatorProjection } from '../projections/operator-projection.js';

function optionalNumber(value: number | undefined): number | null {
  return value ?? null;
}

function optionalString(value: string | undefined): string | null {
  return value ?? null;
}

function transitionValue<T extends object, K extends PropertyKey>(transition: T, key: K): unknown {
  return key in transition ? (transition as Record<PropertyKey, unknown>)[key] : undefined;
}

function mapTransition(
  transition: OperatorProjection['runtime']['recentTransitions'][number],
): OperatorPayload['runtime']['recentTransitions'][number] {
  return {
    kind: transition.kind,
    runtimeSeq: transition.runtimeSeq,
    producerInstanceId: transition.producerInstanceId,
    liveSession:
      transition.liveSession.kind === 'bound'
        ? { kind: 'bound', liveSessionId: transition.liveSession.liveSessionId }
        : { kind: 'unbound' },
    mapEpoch: transition.mapEpoch,
    at: { ...transition.at },
    sourceGeneration: optionalNumber(
      transitionValue(transition, 'sourceGeneration') as number | undefined,
    ),
    receiveSequence: optionalNumber(
      transitionValue(transition, 'receiveSequence') as number | undefined,
    ),
    roundNumber: optionalNumber(transitionValue(transition, 'roundNumber') as number | undefined),
    winnerSide:
      (transitionValue(transition, 'winnerSide') as 'CT' | 'T' | 'unknown' | undefined) ?? null,
    previousMapEpoch: optionalNumber(
      transitionValue(transition, 'previousMapEpoch') as number | undefined,
    ),
    previousMapName: optionalString(
      transitionValue(transition, 'previousMapName') as string | undefined,
    ),
    mapName: optionalString(transitionValue(transition, 'mapName') as string | undefined),
    reason: optionalString(transitionValue(transition, 'reason') as string | undefined),
    resetReason: optionalString(transitionValue(transition, 'resetReason') as string | undefined),
  };
}

function mapDisposition(
  disposition: OperatorProjection['runtime']['lastDisposition'],
): OperatorPayload['runtime']['lastDisposition'] {
  if (disposition === null) return null;
  return {
    kind: disposition.kind,
    reason: disposition.reason,
    missingSequenceRange:
      'missingSequenceRange' in disposition && disposition.missingSequenceRange !== undefined
        ? { ...disposition.missingSequenceRange }
        : null,
  };
}

function mapSourceHealth(
  health: OperatorProjection['sources']['cstvProgram'],
): OperatorPayload['sources']['cstvProgram'] {
  return {
    role: health.role,
    state: health.state,
    generation: health.generation,
    reconnectAttempt: health.reconnectAttempt,
    lastSync:
      health.lastSync === undefined
        ? null
        : {
            protocol: health.lastSync.protocol,
            tick: health.lastSync.tick,
            ticksPerSecond: health.lastSync.ticksPerSecond,
            fragment: health.lastSync.fragment,
            signupFragment: health.lastSync.signupFragment,
            mapName: health.lastSync.mapName ?? null,
            realTimeDelaySeconds: health.lastSync.realTimeDelaySeconds ?? null,
            receiveAgeSeconds: health.lastSync.receiveAgeSeconds ?? null,
          },
    tailTick: health.tailTick ?? null,
    lastEventTick: health.lastEventTick ?? null,
    lastEventSequence: health.lastEventSequence ?? null,
    lastEventObservedAt: health.lastEventObservedAt ?? null,
    lastErrorCode: health.lastErrorCode ?? null,
    lastTerminalStatus: health.lastTerminalStatus ?? null,
  };
}

export function mapOperatorProjection(projection: OperatorProjection): OperatorPayload {
  return operatorPayloadSchema.parse({
    runtime: {
      telemetryFreshness: projection.runtime.telemetryFreshness,
      mapName: projection.runtime.mapName,
      lastAccepted: projection.runtime.lastAccepted,
      lastDisposition: mapDisposition(projection.runtime.lastDisposition),
      recentTransitions: projection.runtime.recentTransitions.map(mapTransition),
    },
    matchContext: {
      state: projection.matchContext.state,
      summary: projection.matchContext.summary,
      origin: projection.matchContext.origin,
      freshness: projection.matchContext.freshness,
      storedAt: projection.matchContext.storedAt,
      cachedFrom: projection.matchContext.cachedFrom,
      diagnostics: projection.matchContext.diagnostics,
    },
    identity: {
      state: projection.identity.state,
      capabilities: projection.identity.capabilities,
      sideMapping: projection.identity.sideMapping,
      issues: projection.identity.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        sourcePlayerId: issue.sourcePlayerId ?? null,
        steam64: issue.steam64 ?? null,
        canonicalPlayerId: issue.canonicalPlayerId ?? null,
        entryId: issue.entryId ?? null,
        observedSide: issue.observedSide ?? null,
        mapSide: issue.mapSide ?? null,
      })),
      resolvedCount: projection.identity.resolvedCount,
      unresolved: projection.identity.unresolved.map((player) => ({
        sourcePlayerId: player.sourcePlayerId,
        displayName: player.displayName,
        side: player.side,
        observerSlot: player.observerSlot,
      })),
    },
    sources: {
      cstvProgram: mapSourceHealth(projection.sources.cstvProgram),
      cstvLookahead: mapSourceHealth(projection.sources.cstvLookahead),
    },
  });
}
