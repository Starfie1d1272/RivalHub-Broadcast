import type { IdentityResolution, IdentityState } from '../identity/index.js';
import type { MatchContext, MatchFormat } from '../match-context/index.js';
import type {
  BombState,
  CountdownPhase,
  MapPhase,
  RoundPhase,
  SourceSide,
  TelemetryCoverageStatus,
  TelemetryObservation,
  WeaponState,
} from '../telemetry/index.js';
import type { RuntimeContinuityPolicy } from '../runtime/types.js';
import {
  getProgramSafeRuntimeFreshness,
  type ProgramSafeRuntimeFreshness,
  type ProgramSafeRuntimeView,
} from './program-safe-runtime.js';
import type { ProjectionCursor } from './cursor.js';
import { getProjectionIdentityState, isProjectionIdentityCurrent } from './identity.js';

export interface ProgramTeamPresentationCanonical {
  readonly mode: 'canonical';
  readonly entryId: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly seriesScore: number | null;
}

export interface ProgramTeamPresentationNeutral {
  readonly mode: 'neutral';
  readonly entryId: null;
  readonly name: 'CT' | 'T';
  readonly logoUrl: null;
  readonly seriesScore: null;
}

export type ProgramTeamPresentation =
  ProgramTeamPresentationCanonical | ProgramTeamPresentationNeutral;

export interface ProgramPlayerStateProjection {
  readonly health: number | null;
  readonly armor: number | null;
  readonly hasHelmet: boolean | null;
  readonly hasDefuser: boolean | null;
  readonly flashed: number | null;
  readonly smoked: number | null;
  readonly burning: number | null;
  readonly money: number | null;
  readonly roundTotalDamage: number | null;
  readonly roundKills: number | null;
  readonly roundKillHeadshots: number | null;
  readonly equipValue: number | null;
}

export interface ProgramMatchStatsProjection {
  readonly kills: number | null;
  readonly assists: number | null;
  readonly deaths: number | null;
  readonly mvps: number | null;
  readonly score: number | null;
}

export interface ProgramWeaponProjection {
  readonly sourceWeaponId: string;
  readonly name: string | null;
  readonly paintKit: string | null;
  readonly type: string | null;
  readonly ammoClip: number | null;
  readonly ammoClipMax: number | null;
  readonly ammoReserve: number | null;
  readonly state: WeaponState | null;
}

export interface ProgramPlayerProjection {
  readonly sourcePlayerId: string;
  readonly canonicalPlayerId: string | null;
  readonly displayName: string | null;
  readonly displayNameSource: 'canonical' | 'observed' | 'unavailable';
  readonly avatarUrl: string | null;
  readonly side: SourceSide;
  readonly observerSlot: number | null;
  readonly activity: string | null;
  readonly state: ProgramPlayerStateProjection | null;
  readonly matchStats: ProgramMatchStatsProjection | null;
  readonly weapons: readonly ProgramWeaponProjection[];
}

export interface ProgramBombProjection {
  readonly state: BombState | null;
  readonly sourcePlayerId: string | null;
  readonly countdownSeconds: number | null;
}

export interface ProgramProjection {
  readonly cursor: ProjectionCursor;
  readonly status: {
    readonly telemetry: ProgramSafeRuntimeFreshness;
    readonly context: 'unbound' | 'fresh' | 'stale';
    readonly identity: IdentityState;
  };
  readonly match: null | {
    readonly matchId: string;
    readonly competition: {
      readonly competitionId: string;
      readonly slug: string;
      readonly name: string;
      readonly themeColor: string | null;
    };
    readonly format: MatchFormat;
    readonly stage: string;
  };
  readonly teams: {
    readonly ct: ProgramTeamPresentation;
    readonly t: ProgramTeamPresentation;
  };
  readonly map: {
    readonly name: string | null;
    readonly mode: string | null;
    readonly phase: MapPhase | null;
    readonly roundNumber: number | null;
    readonly score: { readonly ct: number | null; readonly t: number | null };
    readonly timeoutsRemaining: {
      readonly ct: number | null;
      readonly t: number | null;
    };
  };
  readonly round: null | {
    readonly phase: RoundPhase | null;
    readonly winnerSide: SourceSide;
  };
  readonly clock: null | {
    readonly phase: CountdownPhase | null;
    readonly endsInSeconds: number | null;
  };
  readonly observedPlayerSourceId: string | null;
  readonly players: readonly ProgramPlayerProjection[];
  readonly bomb: null | ProgramBombProjection;
  readonly coverage: {
    readonly map: TelemetryCoverageStatus;
    readonly round: TelemetryCoverageStatus;
    readonly phaseCountdowns: TelemetryCoverageStatus;
    readonly player: TelemetryCoverageStatus;
    readonly allPlayers: TelemetryCoverageStatus;
    readonly bomb: TelemetryCoverageStatus;
  };
}

export interface ProgramProjectionInput {
  readonly runtime: ProgramSafeRuntimeView;
  readonly context?: MatchContext;
  readonly contextFreshness?: 'fresh' | 'stale';
  readonly identity: IdentityResolution;
  readonly nowMonotonicMs: number;
  readonly continuityPolicy: RuntimeContinuityPolicy;
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function currentIdentityProof(
  runtime: ProgramSafeRuntimeView,
  identity: IdentityResolution,
): boolean {
  return isProjectionIdentityCurrent(runtime, identity);
}

function neutralTeam(name: 'CT' | 'T'): ProgramTeamPresentationNeutral {
  return { mode: 'neutral', entryId: null, name, logoUrl: null, seriesScore: null };
}

function canonicalTeams(
  context: MatchContext | undefined,
  identity: IdentityResolution,
  identityIsCurrent: boolean,
  contextFreshness: 'unbound' | 'fresh' | 'stale',
): { readonly ct: ProgramTeamPresentation; readonly t: ProgramTeamPresentation } {
  const canUseBranding =
    context !== undefined &&
    identityIsCurrent &&
    identity.capabilities.canonicalTeamBranding &&
    identity.sideMapping.a !== 'unknown' &&
    identity.sideMapping.b !== 'unknown' &&
    identity.sideMapping.a !== identity.sideMapping.b;

  if (!canUseBranding || context === undefined) {
    return { ct: neutralTeam('CT'), t: neutralTeam('T') };
  }

  const bySide = {
    CT: identity.sideMapping.a === 'CT' ? context.entrants.a : context.entrants.b,
    T: identity.sideMapping.a === 'T' ? context.entrants.a : context.entrants.b,
  } as const;
  return {
    ct: {
      mode: 'canonical',
      entryId: bySide.CT.entryId,
      name: bySide.CT.name,
      logoUrl: bySide.CT.logoUrl,
      seriesScore:
        contextFreshness === 'fresh'
          ? identity.sideMapping.a === 'CT'
            ? context.scoreA
            : context.scoreB
          : null,
    },
    t: {
      mode: 'canonical',
      entryId: bySide.T.entryId,
      name: bySide.T.name,
      logoUrl: bySide.T.logoUrl,
      seriesScore:
        contextFreshness === 'fresh'
          ? identity.sideMapping.a === 'T'
            ? context.scoreA
            : context.scoreB
          : null,
    },
  };
}

function canonicalPlayerFor(
  sourcePlayerId: string,
  identity: IdentityResolution,
  identityIsCurrent: boolean,
) {
  if (
    !identityIsCurrent ||
    !identity.capabilities.canonicalPlayerMapping ||
    identity.state === 'mismatch'
  ) {
    return undefined;
  }
  return identity.players.find((player) => player.sourcePlayerId === sourcePlayerId);
}

function projectPlayer(
  player: NonNullable<TelemetryObservation['telemetry']['allPlayers']>[number],
  identity: IdentityResolution,
  identityIsCurrent: boolean,
): ProgramPlayerProjection {
  const canonical = canonicalPlayerFor(player.sourcePlayerId, identity, identityIsCurrent);
  const observedDisplayName = nullable(player.displayName);
  const canonicalDisplayName = canonical?.displayName ?? null;
  const displayName = canonicalDisplayName ?? observedDisplayName;
  const displayNameSource =
    canonicalDisplayName !== null
      ? 'canonical'
      : observedDisplayName !== null
        ? 'observed'
        : 'unavailable';

  const state =
    player.state === undefined
      ? null
      : {
          health: nullable(player.state.health),
          armor: nullable(player.state.armor),
          hasHelmet: nullable(player.state.hasHelmet),
          hasDefuser: nullable(player.state.hasDefuser),
          flashed: nullable(player.state.flashed),
          smoked: nullable(player.state.smoked),
          burning: nullable(player.state.burning),
          money: nullable(player.state.money),
          roundTotalDamage: nullable(player.state.roundTotalDamage),
          roundKills: nullable(player.state.roundKills),
          roundKillHeadshots: nullable(player.state.roundKillHeadshots),
          equipValue: nullable(player.state.equipValue),
        };
  const matchStats =
    player.matchStats === undefined
      ? null
      : {
          kills: nullable(player.matchStats.kills),
          assists: nullable(player.matchStats.assists),
          deaths: nullable(player.matchStats.deaths),
          mvps: nullable(player.matchStats.mvps),
          score: nullable(player.matchStats.score),
        };

  return {
    sourcePlayerId: player.sourcePlayerId,
    canonicalPlayerId: canonical?.canonicalPlayerId ?? null,
    displayName,
    displayNameSource,
    avatarUrl: canonical?.avatarUrl ?? null,
    side: player.side ?? 'unknown',
    observerSlot: nullable(player.observerSlot),
    activity: nullable(player.activity),
    state,
    matchStats,
    weapons: [...(player.weapons ?? [])]
      .sort((left, right) => left.sourceWeaponId.localeCompare(right.sourceWeaponId))
      .map((weapon) => ({
        sourceWeaponId: weapon.sourceWeaponId,
        name: nullable(weapon.name),
        paintKit: nullable(weapon.paintKit),
        type: nullable(weapon.type),
        ammoClip: nullable(weapon.ammoClip),
        ammoClipMax: nullable(weapon.ammoClipMax),
        ammoReserve: nullable(weapon.ammoReserve),
        state: nullable(weapon.state),
      })),
  };
}

export function projectProgram(input: ProgramProjectionInput): ProgramProjection {
  const telemetry = input.runtime.telemetry;
  const contextFreshness =
    input.context === undefined ? 'unbound' : (input.contextFreshness ?? 'fresh');
  const telemetryFreshness = getProgramSafeRuntimeFreshness(
    input.runtime,
    input.nowMonotonicMs,
    input.continuityPolicy,
  );
  const identityIsCurrent = currentIdentityProof(input.runtime, input.identity);
  const map = telemetry?.telemetry.map;
  const round = telemetry?.telemetry.round;
  const countdown = telemetry?.telemetry.phaseCountdowns;
  const players = telemetry?.telemetry.allPlayers ?? [];

  return {
    cursor: input.runtime.cursor,
    status: {
      telemetry: telemetryFreshness,
      context: contextFreshness,
      identity: getProjectionIdentityState(input.runtime, input.identity),
    },
    match:
      input.context === undefined
        ? null
        : {
            matchId: input.context.matchId,
            competition: { ...input.context.competition },
            format: input.context.format,
            stage: input.context.stage,
          },
    teams: canonicalTeams(input.context, input.identity, identityIsCurrent, contextFreshness),
    map: {
      name: nullable(map?.name),
      mode: nullable(map?.mode),
      phase: nullable(map?.phase),
      roundNumber: nullable(map?.roundNumber),
      score: {
        ct: nullable(map?.sides?.ct?.score),
        t: nullable(map?.sides?.t?.score),
      },
      timeoutsRemaining: {
        ct: nullable(map?.sides?.ct?.timeoutsRemaining),
        t: nullable(map?.sides?.t?.timeoutsRemaining),
      },
    },
    round:
      round === undefined
        ? null
        : { phase: nullable(round.phase), winnerSide: round.winnerSide ?? 'unknown' },
    clock:
      countdown === undefined
        ? null
        : { phase: nullable(countdown.phase), endsInSeconds: nullable(countdown.endsInSeconds) },
    observedPlayerSourceId: telemetry?.telemetry.player?.sourcePlayerId ?? null,
    players: [...players]
      .sort((left, right) => left.sourcePlayerId.localeCompare(right.sourcePlayerId))
      .map((player) => projectPlayer(player, input.identity, identityIsCurrent)),
    bomb:
      telemetry?.telemetry.bomb === undefined
        ? null
        : {
            state: nullable(telemetry.telemetry.bomb.state),
            sourcePlayerId: nullable(telemetry.telemetry.bomb.sourcePlayerId),
            countdownSeconds: nullable(telemetry.telemetry.bomb.countdownSeconds),
          },
    coverage: {
      map: telemetry?.coverage.map ?? 'absent',
      round: telemetry?.coverage.round ?? 'absent',
      phaseCountdowns: telemetry?.coverage.phaseCountdowns ?? 'absent',
      player: telemetry?.coverage.player ?? 'absent',
      allPlayers: telemetry?.coverage.allPlayers ?? 'absent',
      bomb: telemetry?.coverage.bomb ?? 'absent',
    },
  };
}
