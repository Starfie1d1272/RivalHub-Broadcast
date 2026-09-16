import { z } from 'zod';

import { BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION } from './types.js';

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const broadcastScheduleCompetitionSchema = z.strictObject({
  competitionId: z.string(),
  slug: z.string(),
  name: z.string(),
  themeColor: nullableString,
});

export const broadcastScheduleEntrantSchema = z.strictObject({
  entryId: z.string(),
  name: z.string(),
  logoUrl: nullableString,
});

export const broadcastScheduleMatchSchema = z.strictObject({
  matchId: z.string(),
  scheduledAt: nullableString,
  startedAt: nullableString,
  completedAt: nullableString,
  status: z.enum(['scheduled', 'in_progress', 'finished', 'cancelled']),
  format: z.enum(['bo1', 'bo3', 'bo5']),
  stage: z.string(),
  round: nullableNumber,
  isForfeit: z.boolean(),
  scoreA: nullableNumber,
  scoreB: nullableNumber,
  entrantA: broadcastScheduleEntrantSchema,
  entrantB: broadcastScheduleEntrantSchema,
});

export const broadcastScheduleWindowSchema = z.strictObject({
  schemaVersion: z.literal(BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION),
  revision: z.string(),
  competition: broadcastScheduleCompetitionSchema,
  from: z.string(),
  to: z.string(),
  matches: z.array(broadcastScheduleMatchSchema),
});

export type BroadcastScheduleWindowSchemaOutput = z.infer<typeof broadcastScheduleWindowSchema>;
