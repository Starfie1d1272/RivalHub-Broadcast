import { z } from 'zod';

import { LOCAL_PROTOCOL_VERSION, type LocalChannel } from './version.js';

export const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger);
export const positiveSafeIntegerSchema = z.number().int().positive().refine(Number.isSafeInteger);

export const projectionCursorSchema = z.object({
  producerInstanceId: z.string().min(1),
  liveSessionId: z.string().min(1).nullable(),
  runtimeSeq: nonNegativeSafeIntegerSchema,
  programSourceGeneration: nonNegativeSafeIntegerSchema,
  programReceiveSequence: nonNegativeSafeIntegerSchema.nullable(),
  mapEpoch: nonNegativeSafeIntegerSchema,
});

export type ProjectionCursor = z.infer<typeof projectionCursorSchema>;

/** The envelope base is extended by each channel schema; it is not a payload union. */
export const localSnapshotEnvelopeSchema = z.object({
  type: z.literal('snapshot'),
  protocolVersion: z.literal(LOCAL_PROTOCOL_VERSION),
  channel: z.string(),
  schemaVersion: z.number().int().positive(),
  channelSeq: positiveSafeIntegerSchema,
  cursor: projectionCursorSchema,
  payload: z.unknown(),
});

export interface LocalSnapshotV1<TPayload> {
  readonly type: 'snapshot';
  readonly protocolVersion: typeof LOCAL_PROTOCOL_VERSION;
  readonly channel: LocalChannel;
  readonly schemaVersion: 1;
  readonly channelSeq: number;
  readonly cursor: ProjectionCursor;
  readonly payload: TPayload;
}
