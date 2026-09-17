import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { ProgramCueClient } from '../realtime/program-cue-client';
import { connectProgramCueRenderer, ProgramCueEffectStore } from './program-cue-effects';

export interface ProgramCueRendererBridgeProps {
  readonly client: ProgramCueClient;
  readonly ttlMs?: number;
}

/** Connects accepted Program cues to renderer-local ephemeral state without rendering final art. */
export function ProgramCueRendererBridge({ client, ttlMs = 1_000 }: ProgramCueRendererBridgeProps) {
  const store = useMemo(() => new ProgramCueEffectStore({ ttlMs }), [ttlMs]);
  useEffect(() => connectProgramCueRenderer(client, store), [client, store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return <span aria-hidden="true" data-program-cue-effects={snapshot.effects.length} hidden />;
}
