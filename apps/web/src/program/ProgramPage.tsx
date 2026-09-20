import { getBuiltinResolvedPreset, type HudResolvedPreset } from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import type { LocalChannelConnectionState } from '../realtime';
import { ProgramCanvas } from './ProgramCanvas';
import { GameplayHud } from './GameplayHud';

export interface ProgramPageProps {
  readonly snapshot?: ProgramSnapshot | null;
  readonly connectionState?: LocalChannelConnectionState;
  readonly resolvedPreset?: HudResolvedPreset;
}

export function ProgramPage({ snapshot, connectionState, resolvedPreset }: ProgramPageProps = {}) {
  if (snapshot === undefined && connectionState === undefined && resolvedPreset === undefined) {
    return <ProgramCanvas />;
  }
  return (
    <ProgramCanvas>
      <GameplayHud
        connectionState={connectionState}
        mode="program"
        resolvedPreset={resolvedPreset ?? getBuiltinResolvedPreset()}
        snapshot={snapshot ?? null}
      />
    </ProgramCanvas>
  );
}
