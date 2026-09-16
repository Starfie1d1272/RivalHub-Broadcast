import { radarPayloadSchema, type RadarPayload } from '@rivalhub-broadcast/protocol/radar';
import type { RadarFrame } from '@rivalhub-broadcast/radar';

export function mapRadarFrame(frame: RadarFrame): RadarPayload {
  return radarPayloadSchema.parse({
    telemetryFreshness: frame.telemetryFreshness,
    identityState: frame.identityState,
    mapName: frame.mapName,
    observedPlayerSourceId: frame.observedPlayerSourceId,
    coverage: frame.coverage,
    players: frame.players,
    bomb: frame.bomb,
    grenades: frame.grenades,
  });
}
