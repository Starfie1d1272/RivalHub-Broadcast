import type { ProgramPayload } from '@rivalhub-broadcast/protocol/program';
import type { ProgramProjection } from '@rivalhub-broadcast/core/projection';

export function mapProgramProjection(projection: ProgramProjection): ProgramPayload {
  return {
    status: projection.status,
    match: projection.match,
    teams: projection.teams,
    map: projection.map,
    round: projection.round,
    clock: projection.clock,
    observedPlayerSourceId: projection.observedPlayerSourceId,
    players: projection.players.map((player) => ({
      ...player,
      state: player.state === null ? null : { ...player.state },
      matchStats: player.matchStats === null ? null : { ...player.matchStats },
      weapons: player.weapons.map((weapon) => ({ ...weapon })),
    })),
    bomb: projection.bomb,
    coverage: projection.coverage,
  };
}
