export const BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION =
  'rivalhub.broadcast-schedule-window.v1' as const;

export type BroadcastScheduleWindowSchemaVersion = typeof BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION;

export type BroadcastScheduleMatchStatus = 'scheduled' | 'in_progress' | 'finished' | 'cancelled';

export type BroadcastScheduleMatchFormat = 'bo1' | 'bo3' | 'bo5';

export interface BroadcastScheduleCompetitionV1 {
  readonly competitionId: string;
  readonly slug: string;
  readonly name: string;
  readonly themeColor: string | null;
}

export interface BroadcastScheduleEntrantV1 {
  readonly entryId: string;
  readonly name: string;
  readonly logoUrl: string | null;
}

export interface BroadcastScheduleMatchV1 {
  readonly matchId: string;
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly status: BroadcastScheduleMatchStatus;
  readonly format: BroadcastScheduleMatchFormat;
  readonly stage: string;
  readonly round: number | null;
  readonly isForfeit: boolean;
  readonly scoreA: number | null;
  readonly scoreB: number | null;
  readonly entrantA: BroadcastScheduleEntrantV1;
  readonly entrantB: BroadcastScheduleEntrantV1;
}

export interface BroadcastScheduleWindowV1 {
  readonly schemaVersion: BroadcastScheduleWindowSchemaVersion;
  readonly revision: string;
  readonly competition: BroadcastScheduleCompetitionV1;
  readonly from: string;
  readonly to: string;
  readonly matches: readonly BroadcastScheduleMatchV1[];
}
