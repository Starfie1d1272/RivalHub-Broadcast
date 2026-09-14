import type { RuntimeContinuityPolicy, RuntimeInput, RuntimeTime } from '../src/index.js';
import type { MapPhase, SourceSide, TelemetryObservation } from '../src/telemetry/index.js';

export const TEST_POLICY: RuntimeContinuityPolicy = { staleAfterMs: 100 };

export const TEST_AT: RuntimeTime = {
  monotonicMs: 0,
  utc: '2026-09-14T00:00:00.000Z',
};

interface ObservationOptions {
  readonly mapName?: string;
  readonly mapPhase?: MapPhase;
  readonly roundPhase?: 'freezetime' | 'live' | 'over' | 'unknown';
  readonly roundNumber?: number;
  readonly winnerSide?: SourceSide;
  readonly mapCoverage?: 'present' | 'absent' | 'degraded';
  readonly roundCoverage?: 'present' | 'absent' | 'degraded';
}

export function observation(
  sequence: number,
  receivedMonotonicMs: number,
  options: ObservationOptions = {},
): TelemetryObservation {
  const mapName = options.mapName ?? 'de_mirage';
  const mapPhase = options.mapPhase ?? 'live';
  const roundPhase = options.roundPhase ?? 'freezetime';
  const mapCoverage = options.mapCoverage ?? 'present';
  const roundCoverage = options.roundCoverage ?? 'present';
  const receivedAt = new Date(
    Date.parse('2026-09-14T00:00:00.000Z') + receivedMonotonicMs,
  ).toISOString();

  return {
    receive: {
      sequence,
      receivedAt,
      receivedMonotonicMs,
    },
    source: { kind: 'cs2-gsi', providerTimestampSeconds: 1_700_000_000 + sequence },
    coverage: {
      provider: 'present',
      map: mapCoverage,
      round: roundCoverage,
      phaseCountdowns: 'absent',
      player: 'absent',
      allPlayers: 'absent',
      bomb: 'absent',
      grenades: 'absent',
    },
    telemetry: {
      ...(mapCoverage === 'absent'
        ? {}
        : {
            map: {
              name: mapName,
              phase: mapPhase,
              ...(options.roundNumber === undefined ? {} : { roundNumber: options.roundNumber }),
            },
          }),
      ...(roundCoverage === 'absent'
        ? {}
        : {
            round: {
              phase: roundPhase,
              ...(options.winnerSide === undefined ? {} : { winnerSide: options.winnerSide }),
            },
          }),
    },
  };
}

export function telemetryInput(
  sourceGeneration: number,
  telemetry: TelemetryObservation,
): RuntimeInput {
  return {
    kind: 'program-telemetry',
    sourceGeneration,
    observation: telemetry,
  };
}
