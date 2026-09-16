import type { ObservedPlayer, TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';

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
export type CaptureIdentityMapping = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function redactedSteam64(index: number, side: PlayerSide): string {
  const base = side === 'CT' ? 1 : 11;
  return `765611980000000${String(base + index).padStart(2, '0')}`;
}

function allPlayersOf(observation: TelemetryObservation) {
  return observation.telemetry.allPlayers ?? [];
}

function mappedPlayerId(
  sourcePlayerId: string,
  mapping: CaptureIdentityMapping,
): string | undefined {
  if (mapping instanceof Map) {
    const mapMapping = mapping as ReadonlyMap<string, string>;
    const mapped = mapMapping.get(sourcePlayerId);
    return typeof mapped === 'string' ? mapped : undefined;
  }
  const recordMapping = mapping as Readonly<Record<string, string>>;
  const mapped = recordMapping[sourcePlayerId];
  return typeof mapped === 'string' ? mapped : undefined;
}

function redactPlayerId(sourcePlayerId: string, mapping: CaptureIdentityMapping): string {
  const redacted = mappedPlayerId(sourcePlayerId, mapping);
  if (redacted === undefined) {
    throw new Error(`capture redaction map missing ${sourcePlayerId}`);
  }
  return redacted;
}

function redactOptionalPlayerId(sourcePlayerId: string, mapping: CaptureIdentityMapping): string {
  return mappedPlayerId(sourcePlayerId, mapping) ?? sourcePlayerId;
}

export function redactObservedPlayerIds(
  players: readonly ObservedPlayer[],
  mapping: CaptureIdentityMapping,
): readonly ObservedPlayer[] {
  return players.map((player) => ({
    ...player,
    sourcePlayerId: redactPlayerId(player.sourcePlayerId, mapping),
  }));
}

/**
 * Build a deterministic test-only pseudonym map for one external capture.
 * Production Core never sees the capture's original participant identifiers.
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
  mapping: CaptureIdentityMapping,
): TelemetryObservation {
  const allPlayers = observation.telemetry.allPlayers;
  const player = observation.telemetry.player;
  const bomb = observation.telemetry.bomb;
  const grenades = observation.telemetry.grenades;

  return {
    ...observation,
    telemetry: {
      ...observation.telemetry,
      ...(allPlayers === undefined
        ? {}
        : { allPlayers: redactObservedPlayerIds(allPlayers, mapping) }),
      ...(player === undefined
        ? {}
        : {
            player: {
              ...player,
              sourcePlayerId: redactOptionalPlayerId(player.sourcePlayerId, mapping),
            },
          }),
      ...(bomb === undefined
        ? {}
        : {
            bomb: {
              ...bomb,
              ...(bomb.sourcePlayerId === undefined
                ? {}
                : { sourcePlayerId: redactOptionalPlayerId(bomb.sourcePlayerId, mapping) }),
            },
          }),
      ...(grenades === undefined
        ? {}
        : {
            grenades: grenades.map((grenade) => ({
              ...grenade,
              ...(grenade.ownerSourceId === undefined
                ? {}
                : { ownerSourceId: redactOptionalPlayerId(grenade.ownerSourceId, mapping) }),
            })),
          }),
    },
  };
}
