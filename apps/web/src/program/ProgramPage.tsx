import { getBuiltinResolvedPreset, type HudResolvedPreset } from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';
import type { SnapshotResetSignals } from '@rivalhub-broadcast/protocol/acceptance';

import type { LocalChannelConnectionState } from '../realtime';
import { ProgramCanvas } from './ProgramCanvas';
import { GameplayHud } from './GameplayHud';

export interface ProgramPageProps {
  readonly snapshot?: ProgramSnapshot | null;
  readonly connectionState?: LocalChannelConnectionState;
  readonly resolvedPreset?: HudResolvedPreset;
  readonly reset?: SnapshotResetSignals | null;
}

export function programPresentationBoundaryKey(
  snapshot: ProgramSnapshot | null | undefined,
  connectionState: LocalChannelConnectionState | undefined,
  reset: SnapshotResetSignals | null | undefined,
): string {
  const accepted =
    snapshot !== null &&
    snapshot !== undefined &&
    snapshot.payload.status.telemetry === 'fresh' &&
    (connectionState === undefined || connectionState === 'live');
  if (!accepted || snapshot === null || snapshot === undefined) return 'fail-closed';
  const cursor = snapshot.cursor;
  return [
    'accepted',
    cursor.producerInstanceId,
    cursor.liveSessionId ?? 'unbound',
    cursor.programSourceGeneration,
    cursor.mapEpoch,
    reset?.liveSessionChanged === true ? 'session-reset' : '',
    reset?.programSourceGenerationChanged === true ? 'source-reset' : '',
    reset?.mapEpochChanged === true ? 'map-reset' : '',
  ].join(':');
}

export function ProgramPage({
  snapshot,
  connectionState,
  resolvedPreset,
  reset,
}: ProgramPageProps = {}) {
  if (snapshot === undefined && connectionState === undefined && resolvedPreset === undefined) {
    return <ProgramCanvas />;
  }
  return (
    <ProgramCanvas>
      <GameplayHud
        key={programPresentationBoundaryKey(snapshot ?? null, connectionState, reset)}
        resolvedPreset={resolvedPreset ?? getBuiltinResolvedPreset()}
        snapshot={
          connectionState !== undefined && connectionState !== 'live' ? null : (snapshot ?? null)
        }
      />
    </ProgramCanvas>
  );
}
