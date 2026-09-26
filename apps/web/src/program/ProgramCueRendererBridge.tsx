import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { ProgramCueClient } from '../realtime/program-cue-client';
import {
  connectProgramCueRenderer,
  ProgramCueEffectStore,
  type ProgramCueEffectSnapshot,
} from './program-cue-effects';

const EMPTY_PROGRAM_CUE_EFFECTS: ProgramCueEffectSnapshot = Object.freeze({ effects: [] });
const ProgramCueEffectContext = createContext<ProgramCueEffectSnapshot>(EMPTY_PROGRAM_CUE_EFFECTS);

export interface ProgramCueEffectProviderProps {
  readonly snapshot: ProgramCueEffectSnapshot;
  readonly children?: ReactNode;
}

export function ProgramCueEffectProvider({ snapshot, children }: ProgramCueEffectProviderProps) {
  return (
    <ProgramCueEffectContext.Provider value={snapshot}>{children}</ProgramCueEffectContext.Provider>
  );
}

export function useProgramCueEffectsForPlayer(sourcePlayerId: string) {
  const snapshot = useContext(ProgramCueEffectContext);
  return useMemo(
    () =>
      snapshot.effects.filter(({ cue }) => {
        if (cue.kind === 'player-impact') return cue.targetSourcePlayerId === sourcePlayerId;
        return cue.kind === 'player-elimination' && cue.victimSourcePlayerId === sourcePlayerId;
      }),
    [snapshot, sourcePlayerId],
  );
}

export interface ProgramCueRendererBridgeProps {
  readonly client: ProgramCueClient;
  readonly ttlMs?: number;
  readonly children?: ReactNode;
}

/** Connects accepted Program cues to renderer-local ephemeral presentation state. */
export function ProgramCueRendererBridge({
  client,
  ttlMs = 1_000,
  children,
}: ProgramCueRendererBridgeProps) {
  const store = useMemo(() => new ProgramCueEffectStore({ ttlMs }), [ttlMs]);
  useEffect(() => connectProgramCueRenderer(client, store), [client, store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return (
    <ProgramCueEffectProvider snapshot={snapshot}>
      {children}
      <span aria-hidden="true" data-program-cue-effects={snapshot.effects.length} hidden />
    </ProgramCueEffectProvider>
  );
}
