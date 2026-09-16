export const BROADCAST_MANIFEST_SCHEMA_VERSION = 'rivalhub.broadcast-manifest.v1' as const;

export type BroadcastManifestSchemaVersion = typeof BROADCAST_MANIFEST_SCHEMA_VERSION;

export type BroadcastMatchStatus = 'scheduled' | 'in_progress' | 'finished' | 'cancelled';

export type BroadcastMatchFormat = 'bo1' | 'bo3' | 'bo5';

export type BroadcastSide = 't' | 'ct';

export interface BroadcastCompetitionV1 {
  readonly competitionId: string;
  readonly slug: string;
  readonly name: string;
  readonly themeColor: string | null;
}

export interface BroadcastMatchV1 {
  readonly matchId: string;
  readonly competition: BroadcastCompetitionV1;
  readonly status: BroadcastMatchStatus;
  readonly format: BroadcastMatchFormat;
  readonly stage: string;
  readonly round: number | null;
  readonly entryRound: string | null;
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly scoreA: number | null;
  readonly scoreB: number | null;
  readonly isForfeit: boolean;
}

export interface BroadcastPlayerV1 {
  readonly playerId: string;
  readonly steam64: string | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly isStarter: boolean;
}

export interface BroadcastRosterV1 {
  readonly rosterId: string | null;
  readonly players: readonly BroadcastPlayerV1[];
}

export interface BroadcastEntrantV1 {
  readonly entryId: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly roster: BroadcastRosterV1;
}

export interface BroadcastVetoStepV1 {
  readonly stepOrder: number;
  readonly actionType: string;
  readonly mapName: string;
  readonly entryId: string | null;
  readonly side: BroadcastSide | null;
}

export interface BroadcastMapV1 {
  readonly mapId: string;
  readonly mapOrder: number;
  readonly mapName: string;
  readonly pickedByEntryId: string | null;
  readonly teamAStartSide: BroadcastSide | null;
  readonly scoreA: number | null;
  readonly scoreB: number | null;
  readonly completedAt: string | null;
}

export interface BroadcastCommentatorV1 {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly liveStreamUrl: string | null;
}

export interface BroadcastManifestV1 {
  readonly schemaVersion: BroadcastManifestSchemaVersion;
  readonly revision: string;
  readonly match: BroadcastMatchV1;
  readonly entrants: {
    readonly a: BroadcastEntrantV1;
    readonly b: BroadcastEntrantV1;
  };
  readonly maps: readonly BroadcastMapV1[];
  readonly veto: readonly BroadcastVetoStepV1[];
  readonly commentators: readonly BroadcastCommentatorV1[];
}
