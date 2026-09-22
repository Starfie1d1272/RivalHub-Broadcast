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

// Synthetic, explicitly placed Nuke positions sampled from traversable rooms
// across each pinned 1024px floor image and converted through the canonical
// CS2 calibration. They validate floor projection, not demo evidence.
export const NUKE_UPPER_WORLD_ANCHORS = [
  { x: -2333, y: -998 },
  { x: -1740, y: -949 },
  { x: -1073, y: -998 },
  { x: -478, y: -683 },
  { x: 47, y: 507 },
  { x: 432, y: -88 },
  { x: 782, y: -718 },
  { x: 1447, y: -403 },
  { x: 2377, y: -683 },
  { x: 3127, y: -858 },
] as const;

export const NUKE_LOWER_WORLD_ANCHORS = [
  { x: -2333, y: -998 },
  { x: -1703, y: -1138 },
  { x: -1003, y: -1313 },
  { x: -478, y: -718 },
  { x: 47, y: -2013 },
  { x: 467, y: -1173 },
  { x: 1712, y: -2013 },
  { x: 1692, y: -893 },
  { x: 2377, y: -683 },
  { x: 3127, y: -858 },
] as const;

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
      id.startsWith('nuke')
        ? 'Calibrated Nuke overview anchors test map/floor alignment; they are not demo evidence'
        : 'Floor readability with controlled Vertigo coordinates; source capture is not a floor acceptance claim',
    );
    snapshot.payload.mapName = id.startsWith('nuke') ? 'de_nuke' : 'de_vertigo';
    snapshot.payload.grenades = [];
    snapshot.payload.bomb = null;
    snapshot.payload.observedPlayerSourceId = snapshot.payload.players[0]!.sourcePlayerId;
    if (id.startsWith('nuke')) {
      const anchors = id === 'nuke-lower' ? NUKE_LOWER_WORLD_ANCHORS : NUKE_UPPER_WORLD_ANCHORS;
      snapshot.payload.players.forEach((player, index) => {
        const anchor = anchors[index]!;
        player.position = { ...anchor, z: id === 'nuke-lower' ? -600 : 0 };
      });
    } else {
      snapshot.payload.players.forEach((player, index) => {
        player.position = {
          x: -1600 + index * 180,
          y: 400 + (index % 3) * 220,
          z: 11600,
        };
      });
    }
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
