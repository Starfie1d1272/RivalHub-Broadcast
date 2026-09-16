import { z } from 'zod';

import {
  localSnapshotEnvelopeSchema,
  projectionCursorSchema,
  type LocalSnapshotV1,
} from './shared.js';
import { RADAR_SCHEMA_VERSION } from './version.js';

const nullableString = z.string().nullable();
const nullableVector = z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable();
const coverageSchema = z.enum(['present', 'absent', 'degraded']);
const sideSchema = z.enum(['CT', 'T', 'unknown']);

const radarPlayerSchema = z.object({
  sourcePlayerId: z.string(),
  canonicalPlayerId: nullableString,
  displayName: nullableString,
  side: sideSchema,
  observerSlot: z.number().nullable(),
  lifeState: z.enum(['alive', 'dead', 'unknown']),
  position: nullableVector,
  forward: nullableVector,
});

const radarBombSchema = z.object({
  state: z
    .enum([
      'carried',
      'dropped',
      'planting',
      'planted',
      'defusing',
      'exploded',
      'defused',
      'unknown',
    ])
    .nullable(),
  position: nullableVector,
  sourcePlayerId: nullableString,
});

const radarGrenadeSchema = z.object({
  sourceEntityId: z.string(),
  kind: nullableString,
  ownerSourceId: nullableString,
  position: nullableVector,
  velocity: nullableVector,
  lifetimeSeconds: z.number().nullable(),
  flames: z.array(
    z.object({
      sourceFlameId: z.string(),
      position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    }),
  ),
});

export const radarPayloadSchema = z.object({
  telemetryFreshness: z.enum(['awaiting', 'fresh', 'stale']),
  identityState: z.enum(['unbound', 'resolving', 'matched', 'degraded', 'mismatch']),
  mapName: nullableString,
  observedPlayerSourceId: nullableString,
  coverage: z.object({
    allPlayers: coverageSchema,
    bomb: coverageSchema,
    grenades: coverageSchema,
  }),
  players: z.array(radarPlayerSchema),
  bomb: radarBombSchema.nullable(),
  grenades: z.array(radarGrenadeSchema),
});

export const radarSnapshotSchema = localSnapshotEnvelopeSchema.extend({
  channel: z.literal('radar'),
  schemaVersion: z.literal(RADAR_SCHEMA_VERSION),
  cursor: projectionCursorSchema,
  payload: radarPayloadSchema,
});

export type RadarPayload = z.infer<typeof radarPayloadSchema>;
export type RadarSnapshot = z.infer<typeof radarSnapshotSchema>;
export type RadarSnapshotInput = Omit<LocalSnapshotV1<RadarPayload>, 'channelSeq'> & {
  readonly channel: 'radar';
  readonly schemaVersion: typeof RADAR_SCHEMA_VERSION;
};

export const RadarPayloadSchema = radarPayloadSchema;
export const RadarSnapshotSchema = radarSnapshotSchema;
