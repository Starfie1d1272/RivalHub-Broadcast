import type { MatchContext } from '../match-context/index.js';
import type { ObservedPlayer } from '../telemetry/index.js';
import { buildCanonicalIndex, type CanonicalIndex } from './canonical-index.js';
import { normalizeIdentityEvidence, type NormalizedIdentityEvidence } from './evidence.js';
import { deriveSideMapping } from './side-mapping.js';
import type {
  IdentityIssue,
  IdentityResolution,
  IdentityObservationInput,
  IdentitySideMapping,
  IdentityState,
  ResolvedIdentityPlayer,
  UnresolvedObservedPlayer,
} from './types.js';

const STEAM64_PATTERN = /^\d{17}$/;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  evidence: Pick<NormalizedIdentityEvidence, 'sourceGeneration' | 'mapEpoch'>,
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

function knownMapIssue(
  context: MatchContext,
  evidence: NormalizedIdentityEvidence,
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

function addCanonicalIssues(canonical: CanonicalIndex, issues: IdentityIssue[]): void {
  for (const player of canonical.all) {
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
  for (const playerId of canonical.duplicatePlayerIds) {
    issues.push(
      issue('duplicate_canonical_player_id', 'error', `canonical playerId ${playerId} 重复。`, {
        canonicalPlayerId: playerId,
      }),
    );
  }
  for (const steam64 of canonical.duplicateSteam64) {
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
}

function initialResolvingResolution(sourceGeneration = 0, mapEpoch = 0): IdentityResolution {
  return createResolution(
    'resolving',
    { sourceGeneration, mapEpoch },
    [],
    [],
    sideMappingUnknown(),
    [
      issue(
        'roster_evidence_pending',
        'info',
        '等待当前 source generation/map epoch 的 roster evidence。',
      ),
    ],
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

function unresolvedFromObserved(observed: ObservedPlayer): UnresolvedObservedPlayer {
  return {
    sourcePlayerId: observed.sourcePlayerId,
    displayName: observed.displayName ?? null,
    side: observed.side ?? 'unknown',
    observerSlot: observed.observerSlot ?? null,
  };
}

function resolveCurrentPlayers(
  currentPlayers: readonly ObservedPlayer[],
  canonical: CanonicalIndex,
  completeEvidence: boolean,
  completeCanonicalSteam64: boolean,
  issues: IdentityIssue[],
): {
  readonly currentResolved: readonly ResolvedIdentityPlayer[];
  readonly unresolved: readonly UnresolvedObservedPlayer[];
  readonly duplicateObserved: boolean;
  readonly unexpectedHuman: boolean;
} {
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
    const unresolvedPlayer = unresolvedFromObserved(observed);
    if (!STEAM64_PATTERN.test(sourcePlayerId)) {
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

    if (seenObservedSteam64.has(sourcePlayerId)) {
      duplicateObserved = true;
      issues.push(
        issue(
          'duplicate_observed_identity',
          'error',
          `当前 evidence 重复出现 Steam64 ${sourcePlayerId}。`,
          { sourcePlayerId, steam64: sourcePlayerId },
        ),
      );
    }
    seenObservedSteam64.add(sourcePlayerId);

    const canonicalPlayer = canonical.bySteam64.get(sourcePlayerId);
    if (canonicalPlayer === undefined) {
      unexpectedHuman = true;
      issues.push(
        issue(
          'unexpected_human_steam64',
          completeEvidence && completeCanonicalSteam64 ? 'error' : 'warning',
          `观察到的 Steam64 ${sourcePlayerId} 不在当前完整 MatchRoster 中。`,
          { sourcePlayerId, steam64: sourcePlayerId },
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
          {
            sourcePlayerId,
            steam64: sourcePlayerId,
            canonicalPlayerId: canonicalPlayer.playerId,
          },
        ),
      );
      continue;
    }

    resolvedByCanonicalId.set(canonicalPlayer.playerId, {
      canonicalPlayerId: canonicalPlayer.playerId,
      entryId: canonicalPlayer.entryId,
      steam64: sourcePlayerId,
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
          { sourcePlayerId, canonicalPlayerId: canonicalPlayer.playerId },
        ),
      );
    }
  }

  return {
    currentResolved: sortResolvedPlayers(resolvedByCanonicalId.values()),
    unresolved: sortUnresolved(unresolved),
    duplicateObserved,
    unexpectedHuman,
  };
}

export function resolveIdentity(
  context: MatchContext | undefined,
  input: IdentityObservationInput,
  previous?: IdentityResolution,
): IdentityResolution {
  if (context === undefined) return unboundIdentityResolution();

  const evidence = normalizeIdentityEvidence(input);
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

  const canonical = buildCanonicalIndex(context);
  addCanonicalIssues(canonical, issues);
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
    issues.push(
      issue(
        'allplayers_unavailable',
        'warning',
        compatiblePrevious && previous?.players.length !== 0
          ? '当前 frame 没有 allplayers；保留同一 proof 的已知 identity。'
          : '当前没有足够新鲜的 allplayers roster evidence。',
      ),
    );
    if (compatiblePrevious && previous !== undefined && previous.players.length > 0) {
      const state: IdentityState =
        previous.state === 'mismatch'
          ? 'mismatch'
          : previous.state === 'matched'
            ? 'matched'
            : 'degraded';
      return createResolution(
        state,
        evidence,
        previous.players.map((player) => ({ ...player, evidence: 'retained' })),
        previous.unresolved,
        previous.sideMapping,
        issues,
      );
    }
    return createResolution('resolving', evidence, [], [], sideMappingUnknown(), issues);
  }

  if (evidence.allPlayersCoverage === 'degraded') {
    issues.push(issue('allplayers_degraded', 'warning', 'allplayers evidence 已标记为 degraded。'));
    // A degraded frame is an independent freshness/health signal. It cannot
    // revoke an otherwise matched proof unless another positive contradiction
    // (for example an explicit live wrong-map) is present in the same frame.
    if (
      !mapMismatch &&
      compatiblePrevious &&
      previous?.state === 'matched' &&
      previous.players.length > 0
    ) {
      return createResolution(
        'matched',
        evidence,
        previous.players.map((player) => ({ ...player, evidence: 'retained' })),
        previous.unresolved,
        previous.sideMapping,
        issues,
      );
    }
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

  const resolved = resolveCurrentPlayers(
    currentPlayers,
    canonical,
    completeEvidence,
    completeCanonicalSteam64,
    issues,
  );
  const resolvedByCanonicalId = new Map(
    resolved.currentResolved.map((player) => [player.canonicalPlayerId, player] as const),
  );
  if (compatiblePrevious && previous !== undefined && !completeEvidence) {
    for (const player of previous.players) {
      if (!resolvedByCanonicalId.has(player.canonicalPlayerId)) {
        resolvedByCanonicalId.set(player.canonicalPlayerId, {
          ...player,
          evidence: 'retained',
        });
      }
    }
  }
  const allResolved = sortResolvedPlayers(resolvedByCanonicalId.values());
  const sideMapping = deriveSideMapping(
    context,
    evidence,
    resolved.currentResolved,
    compatiblePrevious ? previous : undefined,
    issues,
  );

  if (completeEvidence) {
    const expectedStarterIds = new Set(
      canonical.all.filter((player) => player.isStarter).map((player) => player.playerId),
    );
    const currentStarterIds = new Set(
      resolved.currentResolved
        .filter((player) => player.isStarter)
        .map((player) => player.canonicalPlayerId),
    );
    const hasSubstitute = resolved.currentResolved.some((player) => !player.isStarter);
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

  const sideComplete =
    sideMapping.a !== 'unknown' && sideMapping.b !== 'unknown' && sideMapping.a !== sideMapping.b;
  const contextContradiction =
    resolved.duplicateObserved ||
    mapMismatch ||
    (resolved.unexpectedHuman && completeEvidence && completeCanonicalSteam64) ||
    canonical.duplicatePlayerIds.size > 0 ||
    canonical.duplicateSteam64.size > 0;

  let state: IdentityState;
  if (contextContradiction) {
    state = 'mismatch';
  } else if (
    completeEvidence &&
    resolved.unresolved.length === 0 &&
    resolved.currentResolved.length >= expectedActiveCount &&
    sideComplete
  ) {
    state = 'matched';
  } else {
    state = 'degraded';
  }

  return createResolution(state, evidence, allResolved, resolved.unresolved, sideMapping, issues);
}

export class IdentityResolver {
  private context: MatchContext | undefined;
  private resolution: IdentityResolution;

  constructor(context?: MatchContext) {
    this.context = context;
    this.resolution =
      context === undefined ? unboundIdentityResolution() : initialResolvingResolution();
  }

  bind(context: MatchContext): IdentityResolution {
    this.context = context;
    this.resolution = initialResolvingResolution();
    return this.resolution;
  }

  unbind(): IdentityResolution {
    this.context = undefined;
    this.resolution = unboundIdentityResolution();
    return this.resolution;
  }

  resolve(input: IdentityObservationInput): IdentityResolution {
    this.resolution = resolveIdentity(this.context, input, this.resolution);
    return this.resolution;
  }

  getResolution(): IdentityResolution {
    return this.resolution;
  }
}

export function createIdentityResolver(context?: MatchContext): IdentityResolver {
  return new IdentityResolver(context);
}
