import { z } from 'zod';

import {
  localSnapshotEnvelopeSchema,
  projectionCursorSchema,
  type LocalSnapshotV1,
} from './shared.js';
import { OPERATOR_SCHEMA_VERSION } from './version.js';

const nullableString = z.string().nullable();
const sourceSideSchema = z.enum(['CT', 'T', 'unknown']);

const runtimeTimeSchema = z.object({ monotonicMs: z.number(), utc: z.string() });
const liveSessionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unbound') }),
  z.object({ kind: z.literal('bound'), liveSessionId: z.string() }),
]);

const runtimeTransitionBaseSchema = z.object({
  runtimeSeq: z.number().int().nonnegative(),
  producerInstanceId: z.string(),
  liveSession: liveSessionSchema,
  mapEpoch: z.number().int().nonnegative(),
  at: runtimeTimeSchema,
});

const runtimeTransitionSchema = z.union([
  runtimeTransitionBaseSchema.extend({
    kind: z.literal('round_started'),
    sourceGeneration: z.number().int().nonnegative(),
    receiveSequence: z.number().int().nonnegative(),
    roundNumber: z.number().int().nullable(),
  }),
  runtimeTransitionBaseSchema.extend({
    kind: z.literal('round_ended'),
    sourceGeneration: z.number().int().nonnegative(),
    receiveSequence: z.number().int().nonnegative(),
    roundNumber: z.number().int().nullable(),
    winnerSide: sourceSideSchema.nullable(),
  }),
  runtimeTransitionBaseSchema.extend({
    kind: z.literal('map_ended'),
    sourceGeneration: z.number().int().nonnegative(),
    receiveSequence: z.number().int().nonnegative(),
  }),
  runtimeTransitionBaseSchema.extend({
    kind: z.literal('map_execution_changed'),
    reason: z.literal('observed-map-name-change'),
    sourceGeneration: z.number().int().nonnegative(),
    receiveSequence: z.number().int().nonnegative(),
    previousMapEpoch: z.number().int().nonnegative(),
    previousMapName: nullableString,
    mapName: nullableString,
  }),
  runtimeTransitionBaseSchema.extend({
    kind: z.literal('map_execution_changed'),
    reason: z.literal('explicit-reset'),
    resetReason: z.enum(['same-map-restart', 'restore', 'operator-correction']),
    previousMapEpoch: z.number().int().nonnegative(),
    previousMapName: nullableString,
    mapName: nullableString,
  }),
]);

const runtimeDispositionSchema = z
  .object({
    kind: z.enum(['accepted', 'ignored']),
    reason: z.string(),
    missingSequenceRange: z
      .object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
      .nullable(),
  })
  .nullable();

const contractDiagnosticSchema = z.object({
  kind: z.enum(['structural', 'semantic']),
  severity: z.enum(['warning', 'error']),
  code: z.string(),
  path: z.string(),
  message: z.string(),
});

const identityIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  sourcePlayerId: nullableString,
  steam64: nullableString,
  canonicalPlayerId: nullableString,
  entryId: nullableString,
  observedSide: sourceSideSchema.nullable(),
  mapSide: sourceSideSchema.nullable(),
});

const unresolvedSchema = z.object({
  sourcePlayerId: z.string(),
  displayName: nullableString,
  side: sourceSideSchema,
  observerSlot: z.number().nullable(),
});

const sourceSyncSchema = z.object({
  protocol: z.number().int(),
  tick: z.number().int(),
  ticksPerSecond: z.number(),
  fragment: z.number().int(),
  signupFragment: z.number().int(),
  mapName: nullableString,
  realTimeDelaySeconds: z.number().nullable(),
  receiveAgeSeconds: z.number().nullable(),
});

const sourceHealthSchema = z.object({
  role: z.enum(['program', 'lookahead']),
  state: z.enum(['disabled', 'connecting', 'live', 'reconnecting', 'ended', 'stopped', 'failed']),
  generation: z.number().int().nonnegative(),
  reconnectAttempt: z.number().int().nonnegative(),
  lastSync: sourceSyncSchema.nullable(),
  tailTick: z.number().int().nullable(),
  lastEventTick: z.number().int().nullable(),
  lastEventSequence: z.number().int().nonnegative().nullable(),
  lastEventObservedAt: nullableString,
  lastErrorCode: nullableString,
  lastTerminalStatus: z.enum(['complete', 'timeout', 'cancelled', 'failed']).nullable(),
});

export const operatorPayloadSchema = z.object({
  runtime: z.object({
    telemetryFreshness: z.enum(['awaiting', 'fresh', 'stale']),
    mapName: nullableString,
    lastAccepted: z
      .object({ receiveSequence: z.number().int().nonnegative(), receivedAt: z.string() })
      .nullable(),
    lastDisposition: runtimeDispositionSchema,
    recentTransitions: z.array(runtimeTransitionSchema),
  }),
  matchContext: z.object({
    state: z.enum(['unbound', 'bound']),
    summary: z
      .object({
        matchId: z.string(),
        competitionName: z.string(),
        format: z.enum(['bo1', 'bo3', 'bo5']),
        entryAName: z.string(),
        entryBName: z.string(),
      })
      .nullable(),
    origin: z.enum(['online', 'fixture', 'cache']).nullable(),
    freshness: z.enum(['unbound', 'fresh', 'stale']),
    storedAt: nullableString,
    cachedFrom: z.enum(['online', 'fixture']).nullable(),
    diagnostics: z.array(contractDiagnosticSchema),
  }),
  identity: z.object({
    state: z.enum(['unbound', 'resolving', 'matched', 'degraded', 'mismatch']),
    capabilities: z.object({
      canonicalPlayerMapping: z.boolean(),
      canonicalTeamBranding: z.boolean(),
      identityDependentResult: z.boolean(),
      neutralTelemetry: z.boolean(),
    }),
    sideMapping: z.object({ a: sourceSideSchema, b: sourceSideSchema }),
    issues: z.array(identityIssueSchema),
    resolvedCount: z.number().int().nonnegative(),
    unresolved: z.array(unresolvedSchema),
  }),
  sources: z.object({
    cstvProgram: sourceHealthSchema,
    cstvLookahead: sourceHealthSchema,
  }),
});

export const operatorSnapshotSchema = localSnapshotEnvelopeSchema.extend({
  channel: z.literal('operator'),
  schemaVersion: z.literal(OPERATOR_SCHEMA_VERSION),
  cursor: projectionCursorSchema,
  payload: operatorPayloadSchema,
});

export type OperatorPayload = z.infer<typeof operatorPayloadSchema>;
export type OperatorSnapshot = z.infer<typeof operatorSnapshotSchema>;
export type OperatorSnapshotInput = Omit<LocalSnapshotV1<OperatorPayload>, 'channelSeq'> & {
  readonly channel: 'operator';
  readonly schemaVersion: typeof OPERATOR_SCHEMA_VERSION;
};

export const OperatorPayloadSchema = operatorPayloadSchema;
export const OperatorSnapshotSchema = operatorSnapshotSchema;
