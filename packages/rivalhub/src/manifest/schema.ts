import { z } from 'zod';

import { BROADCAST_MANIFEST_SCHEMA_VERSION } from './types.js';

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const broadcastCompetitionSchema = z.strictObject({
  competitionId: z.string(),
  slug: z.string(),
  name: z.string(),
  themeColor: nullableString,
});

export const broadcastMatchSchema = z.strictObject({
  matchId: z.string(),
  competition: broadcastCompetitionSchema,
  status: z.enum(['scheduled', 'in_progress', 'finished', 'cancelled']),
  format: z.enum(['bo1', 'bo3', 'bo5']),
  stage: z.string(),
  round: nullableNumber,
  entryRound: nullableString,
  scheduledAt: nullableString,
  startedAt: nullableString,
  completedAt: nullableString,
  scoreA: nullableNumber,
  scoreB: nullableNumber,
  isForfeit: z.boolean(),
});

export const broadcastPlayerSchema = z.strictObject({
  playerId: z.string(),
  steam64: nullableString,
  displayName: nullableString,
  avatarUrl: nullableString,
  isStarter: z.boolean(),
});

export const broadcastRosterSchema = z.strictObject({
  rosterId: nullableString,
  players: z.array(broadcastPlayerSchema),
});

export const broadcastEntrantSchema = z.strictObject({
  entryId: z.string(),
  name: z.string(),
  logoUrl: nullableString,
  roster: broadcastRosterSchema,
});

export const broadcastVetoStepSchema = z.strictObject({
  stepOrder: z.number(),
  actionType: z.string(),
  mapName: z.string(),
  entryId: nullableString,
  side: z.enum(['t', 'ct']).nullable(),
});

export const broadcastMapSchema = z.strictObject({
  mapId: z.string(),
  mapOrder: z.number(),
  mapName: z.string(),
  pickedByEntryId: nullableString,
  teamAStartSide: z.enum(['t', 'ct']).nullable(),
  scoreA: nullableNumber,
  scoreB: nullableNumber,
  completedAt: nullableString,
});

export const broadcastCommentatorSchema = z.strictObject({
  userId: z.string(),
  displayName: z.string(),
  avatarUrl: nullableString,
  liveStreamUrl: nullableString,
});

export const broadcastManifestSchema = z.strictObject({
  schemaVersion: z.literal(BROADCAST_MANIFEST_SCHEMA_VERSION),
  revision: z.string(),
  match: broadcastMatchSchema,
  entrants: z.strictObject({
    a: broadcastEntrantSchema,
    b: broadcastEntrantSchema,
  }),
  maps: z.array(broadcastMapSchema),
  veto: z.array(broadcastVetoStepSchema),
  commentators: z.array(broadcastCommentatorSchema),
});

export type BroadcastManifestSchemaOutput = z.infer<typeof broadcastManifestSchema>;
