export const BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION =
  'rivalhub.broadcast-schedule-window.v1' as const;

export type BroadcastScheduleWindowSchemaVersion = typeof BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION;

import type {
  BroadcastScheduleCompetitionSchemaOutput,
  BroadcastScheduleEntrantSchemaOutput,
  BroadcastScheduleMatchSchemaOutput,
  BroadcastScheduleWindowSchemaOutput,
} from './schema.js';

type ReadonlyDeep<T> = T extends readonly (infer Item)[]
  ? readonly ReadonlyDeep<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
    : T;

export type BroadcastScheduleWindowV1 = ReadonlyDeep<BroadcastScheduleWindowSchemaOutput>;
export type BroadcastScheduleCompetitionV1 = ReadonlyDeep<BroadcastScheduleCompetitionSchemaOutput>;
export type BroadcastScheduleEntrantV1 = ReadonlyDeep<BroadcastScheduleEntrantSchemaOutput>;
export type BroadcastScheduleMatchV1 = ReadonlyDeep<BroadcastScheduleMatchSchemaOutput>;
export type BroadcastScheduleMatchStatus = BroadcastScheduleMatchV1['status'];
export type BroadcastScheduleMatchFormat = BroadcastScheduleMatchV1['format'];
