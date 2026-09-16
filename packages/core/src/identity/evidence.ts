import type { MapPhase } from '../telemetry/map.js';
import type { TelemetryObservation } from '../telemetry/index.js';
import type { IdentityObservationInput } from './types.js';

export interface NormalizedIdentityEvidence {
  readonly sourceGeneration: number;
  readonly mapEpoch: number;
  readonly allPlayers: IdentityObservationInput['allPlayers'];
  readonly allPlayersCoverage: NonNullable<IdentityObservationInput['allPlayersCoverage']>;
  readonly mapName: string | undefined;
  readonly mapPhase: MapPhase | undefined;
  readonly mapSideNames: IdentityObservationInput['mapSideNames'];
}

export function normalizeIdentityEvidence(
  input: IdentityObservationInput,
): NormalizedIdentityEvidence {
  return {
    sourceGeneration: input.sourceGeneration,
    mapEpoch: input.mapEpoch,
    allPlayers: input.allPlayers,
    allPlayersCoverage:
      input.allPlayersCoverage ?? (input.allPlayers === undefined ? 'absent' : 'present'),
    mapName: input.mapName,
    mapPhase: input.mapPhase,
    mapSideNames: input.mapSideNames,
  };
}

/**
 * The only bridge from the normalized telemetry observation to identity
 * evidence. Callers must provide the source-local generation and map epoch;
 * identity resolution never invents either baseline.
 */
export function identityEvidenceFromObservation(
  observation: TelemetryObservation,
  sourceGeneration: number,
  mapEpoch: number,
): IdentityObservationInput {
  return {
    sourceGeneration,
    mapEpoch,
    allPlayersCoverage: observation.coverage.allPlayers,
    ...(observation.telemetry.allPlayers === undefined
      ? {}
      : { allPlayers: observation.telemetry.allPlayers }),
    ...(observation.telemetry.map?.name === undefined
      ? {}
      : { mapName: observation.telemetry.map.name }),
    ...(observation.telemetry.map?.phase === undefined
      ? {}
      : { mapPhase: observation.telemetry.map.phase }),
    ...(observation.telemetry.map?.sides === undefined
      ? {}
      : {
          mapSideNames: {
            ...(observation.telemetry.map.sides.ct?.name === undefined
              ? {}
              : { ct: observation.telemetry.map.sides.ct.name }),
            ...(observation.telemetry.map.sides.t?.name === undefined
              ? {}
              : { t: observation.telemetry.map.sides.t.name }),
          },
        }),
  };
}
