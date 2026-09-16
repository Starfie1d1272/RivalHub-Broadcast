import { z } from 'zod';

import {
  localSnapshotEnvelopeSchema,
  projectionCursorSchema,
  type LocalSnapshotV1,
} from './shared.js';
import { ASSIST_SCHEMA_VERSION } from './version.js';

export const assistPayloadSchema = z.object({
  availability: z.literal('unavailable'),
});

export const assistSnapshotSchema = localSnapshotEnvelopeSchema.extend({
  channel: z.literal('assist'),
  schemaVersion: z.literal(ASSIST_SCHEMA_VERSION),
  cursor: projectionCursorSchema,
  payload: assistPayloadSchema,
});

export type AssistPayload = z.infer<typeof assistPayloadSchema>;
export type AssistSnapshot = z.infer<typeof assistSnapshotSchema>;
export type AssistSnapshotInput = Omit<LocalSnapshotV1<AssistPayload>, 'channelSeq'> & {
  readonly channel: 'assist';
  readonly schemaVersion: typeof ASSIST_SCHEMA_VERSION;
};

export const AssistPayloadSchema = assistPayloadSchema;
export const AssistSnapshotSchema = assistSnapshotSchema;
