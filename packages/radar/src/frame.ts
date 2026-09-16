import type {
  BombState,
  ObservedGrenadeFlame,
  ObservedVector3,
  SourceSide,
  TelemetryCoverageStatus,
} from '@rivalhub-broadcast/core/telemetry';
import type { ProjectionCursor } from '@rivalhub-broadcast/core/projection';

export interface RadarPlayer {
  readonly sourcePlayerId: string;
  readonly canonicalPlayerId: string | null;
  readonly displayName: string | null;
  readonly side: SourceSide;
  readonly observerSlot: number | null;
  readonly lifeState: 'alive' | 'dead' | 'unknown';
  readonly position: ObservedVector3 | null;
  readonly forward: ObservedVector3 | null;
}

export interface RadarBomb {
  readonly state: BombState | null;
  readonly position: ObservedVector3 | null;
  readonly sourcePlayerId: string | null;
}

export interface RadarGrenade {
  readonly sourceEntityId: string;
  readonly kind: string | null;
  readonly ownerSourceId: string | null;
  readonly position: ObservedVector3 | null;
  readonly velocity: ObservedVector3 | null;
  readonly lifetimeSeconds: number | null;
  readonly flames: readonly ObservedGrenadeFlame[];
}

export interface RadarFrame {
  readonly cursor: ProjectionCursor;
  readonly telemetryFreshness: 'awaiting' | 'fresh' | 'stale';
  readonly identityState: import('@rivalhub-broadcast/core/identity').IdentityState;
  readonly mapName: string | null;
  readonly observedPlayerSourceId: string | null;
  readonly coverage: {
    readonly allPlayers: TelemetryCoverageStatus;
    readonly bomb: TelemetryCoverageStatus;
    readonly grenades: TelemetryCoverageStatus;
  };
  readonly players: readonly RadarPlayer[];
  readonly bomb: RadarBomb | null;
  readonly grenades: readonly RadarGrenade[];
}
