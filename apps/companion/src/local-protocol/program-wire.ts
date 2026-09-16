import { programPayloadSchema, type ProgramPayload } from '@rivalhub-broadcast/protocol/program';
import type { ProgramProjection } from '@rivalhub-broadcast/core/projection';

export function mapProgramProjection(projection: ProgramProjection): ProgramPayload {
  return programPayloadSchema.parse({
    status: projection.status,
    match: projection.match,
    teams: projection.teams,
    map: projection.map,
    round: projection.round,
    clock: projection.clock,
    observedPlayerSourceId: projection.observedPlayerSourceId,
    players: projection.players,
    bomb: projection.bomb,
    coverage: projection.coverage,
  });
}
