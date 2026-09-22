import { radarSnapshotSchema, type RadarSnapshot } from '@rivalhub-broadcast/protocol/radar';
import artifact from './generated/real-radar-fixtures.generated.json' with { type: 'json' };

export const RADAR_VISUAL_FIXTURES = [
  'full-map',
  'dense-utility',
  'focused',
  'bomb-carried',
  'bomb-planted',
  'dead-flashed',
  'nuke-upper',
  'nuke-lower',
  'vertigo-lower',
  'auto',
  'small',
  'large',
  'stale',
  'unsupported',
] as const;
export type RadarVisualFixture = (typeof RADAR_VISUAL_FIXTURES)[number];
export function realRadarSnapshot(): RadarSnapshot {
  return radarSnapshotSchema.parse(artifact.fixtures['dense-utility'].samples[0]!.snapshot);
}
export function radarVisualFixture(id: RadarVisualFixture) {
  let snapshot = realRadarSnapshot();
  let kind: 'real-derived' | 'synthetic-edge' = 'real-derived';
  let reason: string | null = null;
  const synthetic = (description: string) => {
    kind = 'synthetic-edge';
    reason = description;
  };
  if (id === 'bomb-planted')
    snapshot = radarSnapshotSchema.parse(
      artifact.fixtures['bomb-plant'].samples.find(
        (s) => s.snapshot.payload.bomb?.state === 'planted',
      )!.snapshot,
    );
  if (id === 'full-map') {
    synthetic('Isolate player readability from the real dense scene');
    snapshot.payload.grenades = [];
  }
  if (id === 'focused') {
    synthetic('Select a stable real player as focus');
    snapshot.payload.observedPlayerSourceId = snapshot.payload.players[0]!.sourcePlayerId;
  }
  if (id === 'bomb-carried') {
    synthetic('Carried C4 association');
    snapshot.payload.bomb = {
      state: 'carried',
      sourcePlayerId: snapshot.payload.players[0]!.sourcePlayerId,
      position: null,
    };
  }
  if (id === 'dead-flashed') {
    synthetic('Simultaneous dead and flash presentation');
    snapshot.payload.players[0]!.lifeState = 'dead';
    snapshot.payload.players[1]!.flashAmount = 255;
  }
  if (id.startsWith('nuke') || id.startsWith('vertigo')) {
    synthetic(
      'Floor readability with controlled world coordinates; source capture is not a floor acceptance claim',
    );
    snapshot.payload.mapName = id.startsWith('nuke') ? 'de_nuke' : 'de_vertigo';
    snapshot.payload.grenades = [];
    snapshot.payload.bomb = null;
    snapshot.payload.observedPlayerSourceId = snapshot.payload.players[0]!.sourcePlayerId;
    snapshot.payload.players.forEach((p, i) => {
      p.position = {
        x: -1600 + i * 180,
        y: 400 + (i % 3) * 220,
        z: id === 'nuke-upper' ? 0 : id === 'nuke-lower' ? -600 : 11600,
      };
    });
  }
  if (id === 'stale') {
    synthetic('Fresh-to-stale safety surface');
    snapshot.payload.telemetryFreshness = 'stale';
  }
  if (id === 'unsupported') {
    synthetic('Unsupported calibration');
    snapshot.payload.mapName = 'de_unsupported';
  }
  return {
    snapshot,
    provenance: { kind, reason },
    size: id === 'small' ? 200 : id === 'large' ? 640 : 320,
    zoomMode: id === 'auto' ? ('auto' as const) : ('full-map' as const),
  };
}
