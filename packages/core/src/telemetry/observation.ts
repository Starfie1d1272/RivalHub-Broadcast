import type { ObservedBomb } from './bomb.js';
import type { ObservedGrenade } from './grenade.js';
import type { ObservedMap } from './map.js';
import type { ObservedPhaseCountdown } from './phase-countdowns.js';
import type { ObservedPlayer } from './player.js';
import type { ObservedRound } from './round.js';
import type { TelemetryReceiveContext } from './timing.js';

export type TelemetryCoverageStatus = 'present' | 'absent' | 'degraded';

export interface TelemetryCoverage {
  readonly provider: TelemetryCoverageStatus;
  readonly map: TelemetryCoverageStatus;
  readonly round: TelemetryCoverageStatus;
  readonly phaseCountdowns: TelemetryCoverageStatus;
  readonly player: TelemetryCoverageStatus;
  readonly allPlayers: TelemetryCoverageStatus;
  readonly bomb: TelemetryCoverageStatus;
  readonly grenades: TelemetryCoverageStatus;
}

export interface ObservedTelemetry {
  readonly map?: ObservedMap;
  readonly round?: ObservedRound;
  readonly phaseCountdowns?: ObservedPhaseCountdown;
  readonly player?: ObservedPlayer;
  readonly allPlayers?: readonly ObservedPlayer[];
  readonly bomb?: ObservedBomb;
  readonly grenades?: readonly ObservedGrenade[];
}

export interface TelemetryObservation {
  readonly receive: TelemetryReceiveContext;
  readonly source: {
    readonly kind: 'cs2-gsi';
    readonly providerTimestampSeconds?: number;
  };
  readonly coverage: TelemetryCoverage;
  readonly telemetry: ObservedTelemetry;
}
