import type {
  MatchContext,
  MatchEntrantContext,
  MatchPlayerContext,
} from '../match-context/index.js';
import type { MapPhase, SourceSide } from '../telemetry/map.js';
import type { ObservedPlayer, TelemetryObservation } from '../telemetry/index.js';
import type {
  IdentityEvidenceInput,
  IdentityIssue,
  IdentityObservationInput,
  IdentityResolution,
  IdentityResolverOptions,
  IdentitySideMapping,
  IdentityState,
  ResolvedIdentityPlayer,
  UnresolvedObservedPlayer,
} from './types.js';

const STEAM64_PATTERN = /^\d{17}$/;
const KNOWN_SIDES: readonly SourceSide[] = ['CT', 'T'];

interface CanonicalPlayer extends MatchPlayerContext {
  readonly entryId: string;
}

interface NormalizedEvidence {
  readonly sourceGeneration: number;
  readonly mapEpoch: number;
  readonly allPlayers: readonly ObservedPlayer[] | undefined;
  readonly allPlayersCoverage: 'present' | 'absent' | 'degraded';
  readonly mapName: string | undefined;
  readonly mapPhase: MapPhase | undefined;
  readonly mapSideNames: { readonly ct?: string; readonly t?: string } | undefined;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isTelemetryObservation(value: IdentityEvidenceInput): value is TelemetryObservation {
  return !Array.isArray(value) && 'receive' in value && 'telemetry' in value;
}

function isIdentityObservationInput(
  value: IdentityEvidenceInput,
): value is IdentityObservationInput {
  return !Array.isArray(value) && 'sourceGeneration' in value && 'mapEpoch' in value;
}

function normalizeEvidence(
  input: IdentityEvidenceInput,
  previous: IdentityResolution | undefined,
): NormalizedEvidence {
  if (Array.isArray(input)) {
    return {
      sourceGeneration: previous?.sourceGeneration ?? 0,
      mapEpoch: previous?.mapEpoch ?? 0,
      allPlayers: input,
      allPlayersCoverage: 'present',
      mapName: undefined,
      mapPhase: undefined,
      mapSideNames: undefined,
    };
  }

  if (isTelemetryObservation(input)) {
    return {
      sourceGeneration: previous?.sourceGeneration ?? 0,
      mapEpoch: previous?.mapEpoch ?? 0,
      allPlayers: input.telemetry.allPlayers,
      allPlayersCoverage: input.coverage.allPlayers,
      mapName: input.telemetry.map?.name,
      mapPhase: input.telemetry.map?.phase,
      mapSideNames:
        input.telemetry.map?.sides === undefined
          ? undefined
          : {
              ...(input.telemetry.map.sides.ct?.name === undefined
                ? {}
                : { ct: input.telemetry.map.sides.ct.name }),
              ...(input.telemetry.map.sides.t?.name === undefined
                ? {}
                : { t: input.telemetry.map.sides.t.name }),
            },
    };
  }

  if (isIdentityObservationInput(input)) {
    return {
      sourceGeneration: input.sourceGeneration,
      mapEpoch: input.mapEpoch,
      allPlayers: input.allPlayers,
      allPlayersCoverage:
        input.allPlayersCoverage ?? (input.allPlayers === undefined ? 'absent' : 'present'),
      mapName: input.mapName,
      mapPhase: input.mapPhase,
      mapSideNames: input.mapSideNames,
    };
  }

  throw new TypeError('Identity evidence input is not recognized');
}

function aliasValue(
  sourcePlayerId: string,
  aliases: IdentityResolverOptions['sourceIdAliases'],
): string | undefined {
  if (aliases === undefined) return undefined;
  if (isMapAliases(aliases)) {
    const value: string | undefined = aliases.get(sourcePlayerId);
    return value !== undefined && STEAM64_PATTERN.test(value) ? value : undefined;
  }
  const value: string | undefined = aliases[sourcePlayerId];
  return value !== undefined && STEAM64_PATTERN.test(value) ? value : undefined;
}

function isMapAliases(
  aliases: NonNullable<IdentityResolverOptions['sourceIdAliases']>,
): aliases is ReadonlyMap<string, string> {
  return aliases instanceof Map;
}

function observedSteam64(
  sourcePlayerId: string,
  aliases: IdentityResolverOptions['sourceIdAliases'],
): string | undefined {
  return (
    aliasValue(sourcePlayerId, aliases) ??
    (STEAM64_PATTERN.test(sourcePlayerId) ? sourcePlayerId : undefined)
  );
}

function issue(
  code: IdentityIssue['code'],
  severity: IdentityIssue['severity'],
  message: string,
  details: Omit<IdentityIssue, 'code' | 'severity' | 'message'> = {},
): IdentityIssue {
  return { code, severity, message, ...details };
}

function sideMappingUnknown(): IdentitySideMapping {
  return { a: 'unknown', b: 'unknown' };
}

function capabilitiesFor(
  state: IdentityState,
  players: readonly ResolvedIdentityPlayer[],
): IdentityResolution['capabilities'] {
  return {
    canonicalPlayerMapping: state !== 'mismatch' && players.length > 0,
    canonicalTeamBranding: state === 'matched',
    identityDependentResult: state === 'matched',
    neutralTelemetry: true,
  };
}

function createResolution(
  state: IdentityState,
  evidence: Pick<NormalizedEvidence, 'sourceGeneration' | 'mapEpoch'>,
  players: readonly ResolvedIdentityPlayer[],
  unresolved: readonly UnresolvedObservedPlayer[],
  sideMapping: IdentitySideMapping,
  issues: readonly IdentityIssue[],
): IdentityResolution {
  return {
    state,
    sourceGeneration: evidence.sourceGeneration,
    mapEpoch: evidence.mapEpoch,
    players,
    unresolved,
    sideMapping,
    issues,
    capabilities: capabilitiesFor(state, players),
  };
}

function canonicalPlayers(context: MatchContext): {
  readonly all: readonly CanonicalPlayer[];
  readonly bySteam64: ReadonlyMap<string, CanonicalPlayer>;
} {
  const entrants: readonly [string, MatchEntrantContext][] = [
    ['a', context.entrants.a],
    ['b', context.entrants.b],
  ];
  const all: CanonicalPlayer[] = [];
  const bySteam64 = new Map<string, CanonicalPlayer>();
  for (const [, entrant] of entrants) {
    for (const player of entrant.players) {
      const canonical: CanonicalPlayer = { ...player, entryId: entrant.entryId };
      all.push(canonical);
      if (player.steam64 !== null && player.steam64.trim().length > 0) {
        if (!bySteam64.has(player.steam64)) bySteam64.set(player.steam64, canonical);
      }
    }
  }
  return { all, bySteam64 };
}

function sortResolvedPlayers(players: Iterable<ResolvedIdentityPlayer>): ResolvedIdentityPlayer[] {
  return [...players].sort((left, right) => {
    const entryResult = compareStrings(left.entryId, right.entryId);
    return entryResult !== 0
      ? entryResult
      : compareStrings(left.canonicalPlayerId, right.canonicalPlayerId);
  });
}

function sortUnresolved(players: Iterable<UnresolvedObservedPlayer>): UnresolvedObservedPlayer[] {
  return [...players].sort((left, right) =>
    compareStrings(left.sourcePlayerId, right.sourcePlayerId),
  );
}

function retainPlayer(player: ResolvedIdentityPlayer): ResolvedIdentityPlayer {
  return { ...player, evidence: 'retained' };
}

function previousSide(previous: IdentityResolution | undefined, entry: 'a' | 'b'): SourceSide {
  return previous?.sideMapping[entry] ?? 'unknown';
}

function deriveSideFromMapNames(
  context: MatchContext,
  evidence: NormalizedEvidence,
  entryId: string,
): SourceSide | undefined {
  const ctName = evidence.mapSideNames?.ct?.trim();
  const tName = evidence.mapSideNames?.t?.trim();
  if (ctName === undefined && tName === undefined) return undefined;
  const entrantName =
    context.entrants.a.entryId === entryId
      ? context.entrants.a.name.trim()
      : context.entrants.b.entryId === entryId
        ? context.entrants.b.name.trim()
        : '';
  if (entrantName.length === 0) return undefined;
  const onCt = ctName === entrantName;
  const onT = tName === entrantName;
  return onCt === onT ? undefined : onCt ? 'CT' : 'T';
}

function deriveSide(
  context: MatchContext,
  evidence: NormalizedEvidence,
  entryId: string,
  players: readonly ResolvedIdentityPlayer[],
  previous: IdentityResolution | undefined,
  entry: 'a' | 'b',
  issues: IdentityIssue[],
): SourceSide {
  const mapSide = deriveSideFromMapNames(context, evidence, entryId);
  if (mapSide !== undefined) return mapSide;
  const observedSides = new Set(
    players
      .filter((player) => player.entryId === entryId && KNOWN_SIDES.includes(player.side))
      .map((player) => player.side),
  );
  if (observedSides.size === 1) return [...observedSides][0] ?? 'unknown';
  if (observedSides.size > 1) {
    issues.push(
      issue(
        'ambiguous_side_mapping',
        'warning',
        `参赛方 ${entryId} 在当前 evidence 中同时出现 CT 与 T，暂不信任 side mapping。`,
        { entryId },
      ),
    );
    return 'unknown';
  }
  return previousSide(previous, entry);
}

function knownMapIssue(
  context: MatchContext,
  evidence: NormalizedEvidence,
  hasCurrentEvidence: boolean,
  issues: IdentityIssue[],
): boolean {
  if (
    !hasCurrentEvidence ||
    evidence.mapName === undefined ||
    evidence.mapName.trim().length === 0
  ) {
    return false;
  }
  const knownMaps = new Set(context.maps.map((map) => map.mapName));
  if (knownMaps.size === 0 || knownMaps.has(evidence.mapName)) return false;
  if (evidence.mapPhase === 'live') {
    issues.push(
      issue('map_mismatch', 'error', `live map ${evidence.mapName} 不属于当前 series maps。`),
    );
    return true;
  }
  issues.push(
    issue(
      'map_not_confirmed',
      'warning',
      `当前 map ${evidence.mapName} 尚未在正式 gameplay evidence 中确认。`,
    ),
  );
  return false;
}

function initialResolvingResolution(sourceGeneration = 0, mapEpoch = 0): IdentityResolution {
  const issues = [
    issue(
      'roster_evidence_pending',
      'info',
      '等待当前 source generation/map epoch 的 roster evidence。',
    ),
  ];
  return createResolution(
    'resolving',
    { sourceGeneration, mapEpoch },
    [],
    [],
    sideMappingUnknown(),
    issues,
  );
}

export function unboundIdentityResolution(): IdentityResolution {
  return createResolution(
    'unbound',
    { sourceGeneration: 0, mapEpoch: 0 },
    [],
    [],
    sideMappingUnknown(),
    [issue('context_unbound', 'warning', '当前没有绑定 MatchContext。')],
  );
}

export function identityEvidenceFromObservation(
  observation: TelemetryObservation,
  sourceGeneration: number,
  mapEpoch: number,
): IdentityObservationInput {
  return {
    sourceGeneration,
    mapEpoch,
    allPlayersCoverage: observation.coverage.allPlayers,
    ...(observation.telemetry.allPlayers === undefined
      ? {}
      : { allPlayers: observation.telemetry.allPlayers }),
    ...(observation.telemetry.map?.name === undefined
      ? {}
      : { mapName: observation.telemetry.map.name }),
    ...(observation.telemetry.map?.phase === undefined
      ? {}
      : { mapPhase: observation.telemetry.map.phase }),
    ...(observation.telemetry.map?.sides === undefined
      ? {}
      : {
          mapSideNames: {
            ...(observation.telemetry.map.sides.ct?.name === undefined
              ? {}
              : { ct: observation.telemetry.map.sides.ct.name }),
            ...(observation.telemetry.map.sides.t?.name === undefined
              ? {}
              : { t: observation.telemetry.map.sides.t.name }),
          },
        }),
  };
}

export function resolveIdentity(
  context: MatchContext | undefined,
  input: IdentityEvidenceInput,
  previous?: IdentityResolution,
  options: IdentityResolverOptions = {},
): IdentityResolution {
  if (context === undefined) return unboundIdentityResolution();

  const evidence = normalizeEvidence(input, previous);
  const issues: IdentityIssue[] = [];
  const compatiblePrevious =
    previous !== undefined &&
    previous.sourceGeneration === evidence.sourceGeneration &&
    previous.mapEpoch === evidence.mapEpoch;

  if (previous !== undefined && previous.sourceGeneration !== evidence.sourceGeneration) {
    issues.push(
      issue(
        'source_generation_changed',
        'info',
        'source generation 已变化；旧 identity proof 不作为新 baseline。',
      ),
    );
  }
  if (previous !== undefined && previous.mapEpoch !== evidence.mapEpoch) {
    issues.push(
      issue('map_epoch_changed', 'info', 'map epoch 已变化；旧 identity proof 不作为新 baseline。'),
    );
  }

  const canonical = canonicalPlayers(context);
  const canonicalByPlayerId = new Map<string, CanonicalPlayer>();
  const duplicateCanonicalPlayerIds = new Set<string>();
  const duplicateCanonicalSteam64 = new Set<string>();
  for (const player of canonical.all) {
    if (canonicalByPlayerId.has(player.playerId)) duplicateCanonicalPlayerIds.add(player.playerId);
    canonicalByPlayerId.set(player.playerId, player);
    if (player.steam64 !== null && player.steam64.trim().length > 0) {
      const existing = [...canonical.all].find(
        (candidate) =>
          candidate.playerId !== player.playerId && candidate.steam64 === player.steam64,
      );
      if (existing !== undefined) duplicateCanonicalSteam64.add(player.steam64);
    }
    if (player.steam64 === null || player.steam64.trim().length === 0) {
      issues.push(
        issue(
          'missing_canonical_steam64',
          'warning',
          `canonical player ${player.playerId} 缺少 Steam64，只影响该 player mapping。`,
          { canonicalPlayerId: player.playerId, entryId: player.entryId },
        ),
      );
    }
    if (player.displayName === null || player.displayName.trim().length === 0) {
      issues.push(
        issue(
          'missing_canonical_display_name',
          'warning',
          `canonical player ${player.playerId} 缺少 RivalHub displayName。`,
          { canonicalPlayerId: player.playerId, entryId: player.entryId },
        ),
      );
    }
  }
  for (const playerId of duplicateCanonicalPlayerIds) {
    issues.push(
      issue('duplicate_canonical_player_id', 'error', `canonical playerId ${playerId} 重复。`, {
        canonicalPlayerId: playerId,
      }),
    );
  }
  for (const steam64 of duplicateCanonicalSteam64) {
    issues.push(
      issue('duplicate_canonical_steam64', 'error', `canonical Steam64 ${steam64} 重复。`, {
        steam64,
      }),
    );
  }
  if (canonical.all.length === 0) {
    issues.push(
      issue(
        'roster_incomplete',
        'warning',
        '当前 MatchContext 没有可用于身份核验的 roster player。',
      ),
    );
  }

  const hasCurrentEvidence = evidence.allPlayers !== undefined;
  const currentPlayers = evidence.allPlayers ?? [];
  const expectedStarterCount = canonical.all.filter((player) => player.isStarter).length;
  const expectedActiveCount = Math.max(expectedStarterCount, 1);
  const completeCanonicalSteam64 =
    canonical.all.length > 0 && canonical.bySteam64.size === canonical.all.length;
  const completeEvidence =
    evidence.allPlayersCoverage === 'present' && currentPlayers.length >= expectedActiveCount;

  const mapMismatch = knownMapIssue(context, evidence, hasCurrentEvidence, issues);

  if (!hasCurrentEvidence || evidence.allPlayersCoverage === 'absent') {
    if (compatiblePrevious && previous !== undefined && previous.players.length > 0) {
      issues.push(
        issue(
          'allplayers_unavailable',
          'warning',
          '当前 frame 没有 allplayers；保留同一 proof 的已知 identity。',
        ),
      );
      const retained = previous.players.map(retainPlayer);
      const state: IdentityState = previous.state === 'mismatch' ? 'mismatch' : 'degraded';
      return createResolution(
        state,
        evidence,
        retained,
        previous.unresolved,
        previous.sideMapping,
        issues,
      );
    }
    issues.push(
      issue('allplayers_unavailable', 'warning', '当前没有足够的新鲜 allplayers roster evidence。'),
    );
    return createResolution('resolving', evidence, [], [], sideMappingUnknown(), issues);
  }

  if (evidence.allPlayersCoverage === 'degraded') {
    issues.push(issue('allplayers_degraded', 'warning', 'allplayers evidence 已标记为 degraded。'));
  }
  if (!completeEvidence) {
    issues.push(
      issue(
        'partial_roster_evidence',
        'warning',
        '当前 allplayers 数量不足以证明完整 active lineup。',
      ),
    );
  }

  const resolvedByCanonicalId = new Map<string, ResolvedIdentityPlayer>();
  const unresolved: UnresolvedObservedPlayer[] = [];
  const seenObservedSteam64 = new Set<string>();
  let duplicateObserved = false;
  let unexpectedHuman = false;

  const sortedObserved = [...currentPlayers].sort((left, right) =>
    compareStrings(left.sourcePlayerId, right.sourcePlayerId),
  );
  for (const observed of sortedObserved) {
    const sourcePlayerId = observed.sourcePlayerId;
    const side = observed.side ?? 'unknown';
    const unresolvedPlayer = {
      sourcePlayerId,
      displayName: observed.displayName ?? null,
      side,
      observerSlot: observed.observerSlot ?? null,
    } satisfies UnresolvedObservedPlayer;
    const steam64 = observedSteam64(sourcePlayerId, options.sourceIdAliases);
    if (steam64 === undefined) {
      issues.push(
        issue(
          'bot_or_noncanonical_source_id',
          'warning',
          `source player ${sourcePlayerId} 不是可核验的 Steam64；不按昵称猜人。`,
          { sourcePlayerId },
        ),
      );
      unresolved.push(unresolvedPlayer);
      continue;
    }

    if (seenObservedSteam64.has(steam64)) {
      duplicateObserved = true;
      issues.push(
        issue(
          'duplicate_observed_identity',
          'error',
          `当前 evidence 重复出现 Steam64 ${steam64}。`,
          {
            sourcePlayerId,
            steam64,
          },
        ),
      );
    }
    seenObservedSteam64.add(steam64);

    const canonicalPlayer = canonical.bySteam64.get(steam64);
    if (canonicalPlayer === undefined) {
      unexpectedHuman = true;
      issues.push(
        issue(
          'unexpected_human_steam64',
          completeEvidence && completeCanonicalSteam64 ? 'error' : 'warning',
          `观察到的 Steam64 ${steam64} 不在当前完整 MatchRoster 中。`,
          { sourcePlayerId, steam64 },
        ),
      );
      unresolved.push(unresolvedPlayer);
      continue;
    }

    if (resolvedByCanonicalId.has(canonicalPlayer.playerId)) {
      duplicateObserved = true;
      issues.push(
        issue(
          'duplicate_observed_identity',
          'error',
          `canonical player ${canonicalPlayer.playerId} 在当前 evidence 中出现歧义映射。`,
          { sourcePlayerId, steam64, canonicalPlayerId: canonicalPlayer.playerId },
        ),
      );
      continue;
    }

    resolvedByCanonicalId.set(canonicalPlayer.playerId, {
      canonicalPlayerId: canonicalPlayer.playerId,
      entryId: canonicalPlayer.entryId,
      steam64,
      displayName: canonicalPlayer.displayName,
      avatarUrl: canonicalPlayer.avatarUrl,
      isStarter: canonicalPlayer.isStarter,
      sourcePlayerId,
      observedDisplayName: observed.displayName ?? null,
      observerSlot: observed.observerSlot ?? null,
      side,
      evidence: 'current',
    });
    if (side === 'unknown') {
      issues.push(
        issue(
          'unknown_observed_side',
          'warning',
          `player ${canonicalPlayer.playerId} 当前 side 未知。`,
          {
            sourcePlayerId,
            canonicalPlayerId: canonicalPlayer.playerId,
          },
        ),
      );
    }
  }

  const currentResolved = sortResolvedPlayers(resolvedByCanonicalId.values());
  const canRetainPrior = compatiblePrevious && previous !== undefined && !completeEvidence;
  if (canRetainPrior && previous !== undefined) {
    for (const player of previous.players) {
      if (!resolvedByCanonicalId.has(player.canonicalPlayerId)) {
        resolvedByCanonicalId.set(player.canonicalPlayerId, retainPlayer(player));
      }
    }
  }
  const allResolved = sortResolvedPlayers(resolvedByCanonicalId.values());

  const entryA = context.entrants.a.entryId;
  const entryB = context.entrants.b.entryId;
  const sideA = deriveSide(
    context,
    evidence,
    entryA,
    currentResolved,
    compatiblePrevious ? previous : undefined,
    'a',
    issues,
  );
  const sideB = deriveSide(
    context,
    evidence,
    entryB,
    currentResolved,
    compatiblePrevious ? previous : undefined,
    'b',
    issues,
  );
  if (sideA !== 'unknown' && sideB !== 'unknown' && sideA === sideB) {
    issues.push(
      issue(
        'ambiguous_side_mapping',
        'warning',
        '双方当前 side 相同，不能安全推导 A/B side mapping.',
      ),
    );
  }
  const sideMapping: IdentitySideMapping = { a: sideA, b: sideB };

  if (completeEvidence) {
    const expectedStarterIds = new Set(
      canonical.all.filter((player) => player.isStarter).map((player) => player.playerId),
    );
    const currentStarterIds = new Set(
      currentResolved
        .filter((player) => player.isStarter)
        .map((player) => player.canonicalPlayerId),
    );
    const hasSubstitute = currentResolved.some((player) => !player.isStarter);
    const starterMissing = [...expectedStarterIds].some(
      (playerId) => !currentStarterIds.has(playerId),
    );
    if (hasSubstitute || starterMissing) {
      issues.push(
        issue(
          'lineup_differs_from_expected',
          'warning',
          '当前 lineup 与预期首发不同，但所有已识别选手仍来自完整 MatchRoster。',
        ),
      );
    }
  }

  const mappedCurrentCount = currentResolved.length;
  const hasUnresolved = unresolved.length > 0;
  const sideComplete = sideA !== 'unknown' && sideB !== 'unknown' && sideA !== sideB;
  const contextContradiction =
    duplicateObserved ||
    mapMismatch ||
    (unexpectedHuman && completeEvidence && completeCanonicalSteam64) ||
    duplicateCanonicalPlayerIds.size > 0 ||
    duplicateCanonicalSteam64.size > 0;

  let state: IdentityState;
  if (contextContradiction) {
    state = 'mismatch';
  } else if (
    completeEvidence &&
    !hasUnresolved &&
    mappedCurrentCount >= expectedActiveCount &&
    sideComplete
  ) {
    state = 'matched';
  } else {
    state = 'degraded';
  }

  return createResolution(
    state,
    evidence,
    allResolved,
    sortUnresolved(unresolved),
    sideMapping,
    issues,
  );
}

export class IdentityResolver {
  private context: MatchContext | undefined;
  private readonly options: IdentityResolverOptions;
  private resolution: IdentityResolution;

  constructor(context?: MatchContext, options: IdentityResolverOptions = {}) {
    this.context = context;
    this.options = options;
    this.resolution =
      context === undefined ? unboundIdentityResolution() : initialResolvingResolution();
  }

  bind(context: MatchContext): IdentityResolution {
    this.context = context;
    this.resolution = initialResolvingResolution();
    return this.resolution;
  }

  setContext(context: MatchContext): IdentityResolution {
    return this.bind(context);
  }

  unbind(): IdentityResolution {
    this.context = undefined;
    this.resolution = unboundIdentityResolution();
    return this.resolution;
  }

  resolve(input: IdentityEvidenceInput): IdentityResolution {
    this.resolution = resolveIdentity(this.context, input, this.resolution, this.options);
    return this.resolution;
  }

  getResolution(): IdentityResolution {
    return this.resolution;
  }
}

export function createIdentityResolver(
  context?: MatchContext,
  options: IdentityResolverOptions = {},
): IdentityResolver {
  return new IdentityResolver(context, options);
}
