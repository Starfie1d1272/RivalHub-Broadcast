import {
  getProjectionIdentityState,
  getProgramSafeRuntimeFreshness,
  selectProgramSafeRuntimeView,
  type ProjectionCursor,
} from '@rivalhub-broadcast/core/projection';
import type {
  IdentityCapabilities,
  IdentityIssue,
  IdentityResolution,
  IdentitySideMapping,
  UnresolvedObservedPlayer,
} from '@rivalhub-broadcast/core/identity';
import type { RuntimeDisposition, RuntimeTransition } from '@rivalhub-broadcast/core/runtime';
import type { MatchFormat } from '@rivalhub-broadcast/core/match-context';

import type { MatchContextBinding } from '../match-context/index.js';
import type { CstvSourceHealth, CstvSourceManagers } from '../telemetry/cstv-source-manager.js';
import type { ProgramRuntimeSnapshot } from '../runtime/program-runtime.js';
import { projectionContextFromBinding, type ProjectionContextInput } from './context-input.js';

export interface OperatorProjection {
  readonly cursor: ProjectionCursor;
  readonly runtime: {
    readonly telemetryFreshness: 'awaiting' | 'fresh' | 'stale';
    readonly mapName: string | null;
    readonly lastAccepted: null | {
      readonly receiveSequence: number;
      readonly receivedAt: string;
    };
    readonly lastDisposition: RuntimeDisposition | null;
    readonly recentTransitions: readonly RuntimeTransition[];
  };
  readonly matchContext: {
    readonly state: ProjectionContextInput['state'];
    readonly summary: null | {
      readonly matchId: string;
      readonly competitionName: string;
      readonly format: MatchFormat;
      readonly entryAName: string;
      readonly entryBName: string;
    };
    readonly origin: ProjectionContextInput['origin'];
    readonly freshness: ProjectionContextInput['freshness'];
    readonly storedAt: string | null;
    readonly cachedFrom: ProjectionContextInput['cachedFrom'];
    readonly diagnostics: ProjectionContextInput['diagnostics'];
  };
  readonly identity: {
    readonly state: IdentityResolution['state'];
    readonly capabilities: IdentityCapabilities;
    readonly sideMapping: IdentitySideMapping;
    readonly issues: readonly IdentityIssue[];
    readonly resolvedCount: number;
    readonly unresolved: readonly UnresolvedObservedPlayer[];
  };
  readonly sources: {
    readonly cstvProgram: CstvSourceHealth;
    readonly cstvLookahead: CstvSourceHealth;
  };
}

export interface OperatorProjectionInput {
  readonly runtime: ProgramRuntimeSnapshot;
  readonly context: MatchContextBinding | undefined;
  readonly identity: IdentityResolution;
  readonly cstvSources: CstvSourceManagers;
  readonly nowMonotonicMs: number;
}

export function projectOperator(input: OperatorProjectionInput): OperatorProjection {
  const state = input.runtime.current;
  const safeRuntime = selectProgramSafeRuntimeView(state);
  const context = projectionContextFromBinding(input.context);
  const lastAccepted = safeRuntime.programSourceLastAccepted;

  return {
    cursor: safeRuntime.cursor,
    runtime: {
      telemetryFreshness: getProgramSafeRuntimeFreshness(
        safeRuntime,
        input.nowMonotonicMs,
        input.runtime.continuityPolicy,
      ),
      mapName: safeRuntime.telemetry?.telemetry.map?.name ?? null,
      lastAccepted:
        lastAccepted === null
          ? null
          : {
              receiveSequence: safeRuntime.cursor.programReceiveSequence ?? 0,
              receivedAt: lastAccepted.receivedAt,
            },
      lastDisposition: input.runtime.lastDisposition ?? null,
      recentTransitions: input.runtime.recentTransitions.slice(),
    },
    matchContext: {
      state: context.state,
      summary:
        context.context === undefined
          ? null
          : {
              matchId: context.context.matchId,
              competitionName: context.context.competition.name,
              format: context.context.format,
              entryAName: context.context.entrants.a.name,
              entryBName: context.context.entrants.b.name,
            },
      origin: context.origin,
      freshness: context.freshness,
      storedAt: context.storedAt,
      cachedFrom: context.cachedFrom,
      diagnostics: context.diagnostics.slice(),
    },
    identity: {
      state: getProjectionIdentityState(safeRuntime, input.identity),
      capabilities: { ...input.identity.capabilities },
      sideMapping: { ...input.identity.sideMapping },
      issues: input.identity.issues.map((issue) => ({ ...issue })),
      resolvedCount: input.identity.players.length,
      unresolved: input.identity.unresolved.map((player) => ({ ...player })),
    },
    sources: {
      cstvProgram: { ...input.cstvSources.program.getHealth() },
      cstvLookahead: { ...input.cstvSources.lookahead.getHealth() },
    },
  };
}
