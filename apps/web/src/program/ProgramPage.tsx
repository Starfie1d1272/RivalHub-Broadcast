import { getBuiltinResolvedPreset, type HudResolvedPreset } from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import type { LocalChannelConnectionState } from '../realtime';
import { ProgramCanvas } from './ProgramCanvas';
import { GameplayHud } from './GameplayHud';
import { hasAcceptedProgramSnapshot, presentationBoundaryKey } from './presentation-boundary';

export { presentationBoundaryKey as programPresentationBoundaryKey } from './presentation-boundary';

export interface ProgramPageProps {
  readonly snapshot?: ProgramSnapshot | null;
  readonly connectionState?: LocalChannelConnectionState;
  readonly resolvedPreset?: HudResolvedPreset;
}

export function ProgramPage({ snapshot, connectionState, resolvedPreset }: ProgramPageProps = {}) {
  if (snapshot === undefined && connectionState === undefined && resolvedPreset === undefined) {
    return <ProgramCanvas />;
  }
  const candidateSnapshot = snapshot ?? null;
  const presentationSnapshot = hasAcceptedProgramSnapshot(candidateSnapshot, connectionState)
    ? candidateSnapshot
    : null;
  return (
    <ProgramCanvas>
      <GameplayHud
        key={presentationBoundaryKey(presentationSnapshot, connectionState)}
        resolvedPreset={resolvedPreset ?? getBuiltinResolvedPreset()}
        snapshot={presentationSnapshot}
      />
    </ProgramCanvas>
  );
}
