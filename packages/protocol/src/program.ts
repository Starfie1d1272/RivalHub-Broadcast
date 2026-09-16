import { z } from 'zod';

import {
  localSnapshotEnvelopeSchema,
  projectionCursorSchema,
  type LocalSnapshotV1,
} from './shared.js';
import { PROGRAM_SCHEMA_VERSION } from './version.js';

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();
const nullableBoolean = z.boolean().nullable();
const sourceSideSchema = z.enum(['CT', 'T', 'unknown']);
const coverageSchema = z.enum(['present', 'absent', 'degraded']);

const teamSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('canonical'),
    entryId: z.string().min(1),
    name: z.string(),
    logoUrl: nullableString,
    seriesScore: nullableNumber,
  }),
  z.object({
    mode: z.literal('neutral'),
    entryId: z.null(),
    name: z.enum(['CT', 'T']),
    logoUrl: z.null(),
    seriesScore: z.null(),
  }),
]);

const playerStateSchema = z.object({
  health: nullableNumber,
  armor: nullableNumber,
  hasHelmet: nullableBoolean,
  hasDefuser: nullableBoolean,
  flashed: nullableNumber,
  smoked: nullableNumber,
  burning: nullableNumber,
  money: nullableNumber,
  roundTotalDamage: nullableNumber,
  roundKills: nullableNumber,
  roundKillHeadshots: nullableNumber,
  equipValue: nullableNumber,
});

const matchStatsSchema = z.object({
  kills: nullableNumber,
  assists: nullableNumber,
  deaths: nullableNumber,
  mvps: nullableNumber,
  score: nullableNumber,
});

const weaponSchema = z.object({
  sourceWeaponId: z.string(),
  name: nullableString,
  paintKit: nullableString,
  type: nullableString,
  ammoClip: nullableNumber,
  ammoClipMax: nullableNumber,
  ammoReserve: nullableNumber,
  state: z.enum(['active', 'holstered', 'reloading', 'unknown']).nullable(),
});

const playerSchema = z.object({
  sourcePlayerId: z.string(),
  canonicalPlayerId: nullableString,
  displayName: nullableString,
  displayNameSource: z.enum(['canonical', 'observed', 'unavailable']),
  avatarUrl: nullableString,
  side: sourceSideSchema,
  observerSlot: nullableNumber,
  activity: nullableString,
  state: playerStateSchema.nullable(),
  matchStats: matchStatsSchema.nullable(),
  weapons: z.array(weaponSchema),
});

const bombSchema = z.object({
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
  sourcePlayerId: nullableString,
  countdownSeconds: nullableNumber,
});

export const programPayloadSchema = z.object({
  status: z.object({
    telemetry: z.enum(['awaiting', 'fresh', 'stale']),
    context: z.enum(['unbound', 'fresh', 'stale']),
    identity: z.enum(['unbound', 'resolving', 'matched', 'degraded', 'mismatch']),
  }),
  match: z
    .object({
      matchId: z.string(),
      competition: z.object({
        competitionId: z.string(),
        slug: z.string(),
        name: z.string(),
        themeColor: nullableString,
      }),
      format: z.enum(['bo1', 'bo3', 'bo5']),
      stage: z.string(),
    })
    .nullable(),
  teams: z.object({ ct: teamSchema, t: teamSchema }),
  map: z.object({
    name: nullableString,
    mode: nullableString,
    phase: z.enum(['warmup', 'live', 'intermission', 'gameover', 'unknown']).nullable(),
    roundNumber: nullableNumber,
    score: z.object({ ct: nullableNumber, t: nullableNumber }),
    timeoutsRemaining: z.object({ ct: nullableNumber, t: nullableNumber }),
  }),
  round: z
    .object({
      phase: z.enum(['freezetime', 'live', 'over', 'unknown']).nullable(),
      winnerSide: sourceSideSchema,
    })
    .nullable(),
  clock: z
    .object({
      phase: z
        .enum([
          'paused',
          'timeout_ct',
          'timeout_t',
          'warmup',
          'freezetime',
          'live',
          'bomb',
          'defuse',
          'over',
          'unknown',
        ])
        .nullable(),
      endsInSeconds: nullableNumber,
    })
    .nullable(),
  observedPlayerSourceId: nullableString,
  players: z.array(playerSchema),
  bomb: bombSchema.nullable(),
  coverage: z.object({
    map: coverageSchema,
    round: coverageSchema,
    phaseCountdowns: coverageSchema,
    player: coverageSchema,
    allPlayers: coverageSchema,
    bomb: coverageSchema,
  }),
});

export const programSnapshotSchema = localSnapshotEnvelopeSchema.extend({
  channel: z.literal('program'),
  schemaVersion: z.literal(PROGRAM_SCHEMA_VERSION),
  cursor: projectionCursorSchema,
  payload: programPayloadSchema,
});

export type ProgramPayload = z.infer<typeof programPayloadSchema>;
export type ProgramSnapshot = z.infer<typeof programSnapshotSchema>;
export type ProgramSnapshotInput = Omit<LocalSnapshotV1<ProgramPayload>, 'channelSeq'> & {
  readonly channel: 'program';
  readonly schemaVersion: typeof PROGRAM_SCHEMA_VERSION;
};

export const ProgramPayloadSchema = programPayloadSchema;
export const ProgramSnapshotSchema = programSnapshotSchema;
