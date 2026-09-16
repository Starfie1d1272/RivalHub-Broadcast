import type { TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';

export const SANITIZED_FIXTURE_STEAM64: Readonly<Record<string, string>> = {
  'fixture-player-001': '76561198000000001',
  'fixture-player-002': '76561198000000011',
  'fixture-player-003': '76561198000000012',
  'fixture-player-004': '76561198000000002',
  'fixture-player-005': '76561198000000013',
  'fixture-player-006': '76561198000000003',
  'fixture-player-007': '76561198000000004',
  'fixture-player-008': '76561198000000005',
  'fixture-player-009': '76561198000000014',
  'fixture-player-011': '76561198000000015',
};

type PlayerSide = 'CT' | 'T';

function redactedSteam64(index: number, side: PlayerSide): string {
  const base = side === 'CT' ? 1 : 11;
  return `765611980000000${String(base + index).padStart(2, '0')}`;
}

function allPlayersOf(observation: TelemetryObservation) {
  return observation.telemetry.allPlayers ?? [];
}

/**
 * Build a deterministic test-only pseudonym map for one external capture.
 * The map is derived in the helper before formal identity evidence is built;
 * production Core never sees the capture's original participant identifiers.
 */
export function buildCaptureRedactionMap(
  observation: TelemetryObservation,
): ReadonlyMap<string, string> {
  const bySide: Record<PlayerSide, string[]> = { CT: [], T: [] };
  for (const player of allPlayersOf(observation)) {
    if (player.side !== 'CT' && player.side !== 'T') {
      throw new Error(
        'full-match capture must expose CT/T for its first complete allplayers frame',
      );
    }
    bySide[player.side].push(player.sourcePlayerId);
  }
  for (const side of ['CT', 'T'] as const) bySide[side].sort();
  if (bySide.CT.length !== 5 || bySide.T.length !== 5) {
    throw new Error('full-match capture redaction requires five players on each initial side');
  }

  const mapping = new Map<string, string>();
  for (const side of ['CT', 'T'] as const) {
    bySide[side].forEach((sourcePlayerId, index) => {
      mapping.set(sourcePlayerId, redactedSteam64(index, side));
    });
  }
  return mapping;
}

export function redactObservationPlayerIds(
  observation: TelemetryObservation,
  mapping: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): TelemetryObservation {
  const mapValue = (sourcePlayerId: string): string | undefined => {
    if (mapping instanceof Map) {
      return (mapping as ReadonlyMap<string, string>).get(sourcePlayerId);
    }
    const record = mapping as Readonly<Record<string, string>>;
    return record[sourcePlayerId];
  };
  const allPlayers = observation.telemetry.allPlayers;
  if (allPlayers === undefined) return observation;

  return {
    ...observation,
    telemetry: {
      ...observation.telemetry,
      allPlayers: allPlayers.map((player) => {
        const redacted = mapValue(player.sourcePlayerId);
        if (redacted === undefined) {
          throw new Error(`capture redaction map missing ${player.sourcePlayerId}`);
        }
        return { ...player, sourcePlayerId: redacted };
      }),
    },
  };
}
