import type { IdentityResolution, IdentityState } from '../identity/index.js';

import type { ProgramSafeRuntimeView } from './program-safe-runtime.js';

export function isProjectionIdentityCurrent(
  runtime: ProgramSafeRuntimeView,
  identity: IdentityResolution,
): boolean {
  return (
    identity.sourceGeneration === runtime.cursor.programSourceGeneration &&
    identity.mapEpoch === runtime.cursor.mapEpoch
  );
}

/**
 * A resolver may still hold a matched proof while the runtime has crossed its
 * source/map epoch. Consumers must report the effective state until a new
 * proof is established; otherwise a neutral projection could be labelled as
 * matched and invite callers to trust stale branding.
 */
export function getProjectionIdentityState(
  runtime: ProgramSafeRuntimeView,
  identity: IdentityResolution,
): IdentityState {
  if (isProjectionIdentityCurrent(runtime, identity)) return identity.state;
  return identity.state === 'unbound' ? 'unbound' : 'resolving';
}
