import { z } from 'zod';

import { nonNegativeSafeIntegerSchema, positiveSafeIntegerSchema } from './shared.js';
import { LOCAL_PROTOCOL_VERSION, PROGRAM_CUE_SCHEMA_VERSION } from './version.js';

const safeIntegerSchema = z.number().int().refine(Number.isSafeInteger);
const nullableString = z.string().min(1).nullable();

export const programCueLaneCursorSchema = z.object({
  producerInstanceId: z.string().min(1),
  liveSessionId: nullableString,
  mapEpoch: nonNegativeSafeIntegerSchema,
  cstvProgramGeneration: nonNegativeSafeIntegerSchema,
});

const programCueBaseSchema = z.object({
  id: z.string().min(1),
  mapEpoch: nonNegativeSafeIntegerSchema,
  source: z.object({
    generation: nonNegativeSafeIntegerSchema,
    sequence: nonNegativeSafeIntegerSchema,
    tick: safeIntegerSchema,
  }),
});

const programPlayerImpactCueSchema = programCueBaseSchema.extend({
  kind: z.literal('player-impact'),
  effect: z.enum(['he', 'zeus', 'sniper']),
  targetSourcePlayerId: z.string().min(1),
  attackerSourcePlayerId: nullableString,
  weapon: z.string(),
  damageHealth: z.number(),
  healthRemaining: z.number(),
  hitgroup: safeIntegerSchema,
  lethal: z.boolean(),
});

const programPlayerEliminationCueSchema = programCueBaseSchema.extend({
  kind: z.literal('player-elimination'),
  victimSourcePlayerId: z.string().min(1),
  attackerSourcePlayerId: nullableString,
  assisterSourcePlayerId: nullableString,
  weapon: z.string(),
  weaponFamily: z.enum(['he', 'zeus', 'sniper', 'other']),
  modifiers: z.object({
    assistedFlash: z.boolean(),
    headshot: z.boolean(),
    penetratedObjects: safeIntegerSchema,
    noScope: z.boolean(),
    throughSmoke: z.boolean(),
    attackerBlind: z.boolean(),
    attackerInAir: z.boolean(),
  }),
});

export const programCueSchema = z.discriminatedUnion('kind', [
  programPlayerImpactCueSchema,
  programPlayerEliminationCueSchema,
]);

export const programCueBaselineSchema = z.object({
  type: z.literal('cue-baseline'),
  protocolVersion: z.literal(LOCAL_PROTOCOL_VERSION),
  channel: z.literal('program-cue'),
  schemaVersion: z.literal(PROGRAM_CUE_SCHEMA_VERSION),
  channelSeq: positiveSafeIntegerSchema,
  cursor: programCueLaneCursorSchema,
});

export const programCueMessageSchema = z
  .object({
    type: z.literal('cue'),
    protocolVersion: z.literal(LOCAL_PROTOCOL_VERSION),
    channel: z.literal('program-cue'),
    schemaVersion: z.literal(PROGRAM_CUE_SCHEMA_VERSION),
    channelSeq: positiveSafeIntegerSchema,
    cursor: programCueLaneCursorSchema,
    cue: programCueSchema,
  })
  .superRefine((message, context) => {
    if (message.cue.mapEpoch !== message.cursor.mapEpoch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cue', 'mapEpoch'],
        message: 'cue mapEpoch must match the lane cursor',
      });
    }
    if (message.cue.source.generation !== message.cursor.cstvProgramGeneration) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cue', 'source', 'generation'],
        message: 'cue source generation must match the lane cursor',
      });
    }
  });

export const programCueEnvelopeSchema = z.discriminatedUnion('type', [
  programCueBaselineSchema,
  programCueMessageSchema,
]);

export type ProgramCueLaneCursor = z.infer<typeof programCueLaneCursorSchema>;
export type ProgramCueWire = z.infer<typeof programCueSchema>;
export type ProgramCueBaselineV1 = z.infer<typeof programCueBaselineSchema>;
export type ProgramCueMessageV1 = z.infer<typeof programCueMessageSchema>;
export type ProgramCueLaneMessage = ProgramCueBaselineV1 | ProgramCueMessageV1;
export type ProgramCueBaselineInput = Omit<ProgramCueBaselineV1, 'channelSeq'>;
export type ProgramCueMessageInput = Omit<ProgramCueMessageV1, 'channelSeq'>;

export const ProgramCueLaneCursorSchema = programCueLaneCursorSchema;
export const ProgramCueSchema = programCueSchema;
export const ProgramCueBaselineSchema = programCueBaselineSchema;
export const ProgramCueMessageSchema = programCueMessageSchema;
export const ProgramCueEnvelopeSchema = programCueEnvelopeSchema;
