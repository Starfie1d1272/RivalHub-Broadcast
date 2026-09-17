import type { MatchContext } from '../match-context/index.js';
import type { ObservedPlayer, TelemetryCoverageStatus } from '../telemetry/index.js';
import type { IdentityResolution } from './types.js';

const STEAM64_PATTERN = /^\d{17}$/;
const MAX_LINEUP_EXTRAS = 32;

export type ActiveLineupState = 'resolving' | 'complete' | 'degraded';
export type LineupEvidence = 'current' | 'retained';
export type LineupIdentityEvidence = 'canonical' | 'observed' | 'unresolved';

export type LineupIssueCode =
  | 'allplayers_unavailable'
  | 'allplayers_degraded'
  | 'insufficient_candidates'
  | 'ambiguous_candidates'
  | 'retained_baseline'
  | 'extra_observed_player'
  | 'duplicate_observed_identity'
  | 'excluded_observed_player';

export interface LineupIssue {
  readonly code: LineupIssueCode;
  readonly severity: 'info' | 'warning';
  readonly message: string;
  readonly sourcePlayerId?: string;
  readonly side?: 'CT' | 'T';
}

export interface ActiveLineupPlayer {
  readonly sourcePlayerId: string;
  readonly canonicalPlayerId: string | null;
  readonly identityEvidence: LineupIdentityEvidence;
  readonly lineupEvidence: LineupEvidence;
  /** Current source entry; null means membership is retained without fabricating live telemetry. */
  readonly observed: ObservedPlayer | null;
  /** Current/last-known side assignment is separate from stable membership. */
  readonly side: 'CT' | 'T';
}

export interface ActiveLineupResolution {
  readonly state: ActiveLineupState;
  readonly sourceGeneration: number;
  readonly mapEpoch: number;
  readonly ct: readonly ActiveLineupPlayer[];
  readonly t: readonly ActiveLineupPlayer[];
  readonly extras: readonly ObservedPlayer[];
  readonly issues: readonly LineupIssue[];
}

export interface ActiveLineupOverride {
  readonly includeSourcePlayerIds?: readonly string[];
  readonly excludeSourcePlayerIds?: readonly string[];
}

export interface ActiveLineupInput {
  readonly sourceGeneration: number;
  readonly mapEpoch: number;
  readonly allPlayers?: readonly ObservedPlayer[];
  readonly allPlayersCoverage?: TelemetryCoverageStatus;
  readonly context?: MatchContext;
  readonly identity?: IdentityResolution;
  readonly previous?: ActiveLineupResolution;
  readonly override?: ActiveLineupOverride;
}

interface Candidate {
  readonly observed: ObservedPlayer;
  readonly side: 'CT' | 'T';
}

function compareSourceIds(
  left: { sourcePlayerId: string },
  right: { sourcePlayerId: string },
): number {
  return left.sourcePlayerId < right.sourcePlayerId
    ? -1
    : left.sourcePlayerId > right.sourcePlayerId
      ? 1
      : 0;
}

function stableOrderingValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableOrderingValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, stableOrderingValue(entry)]),
    );
  }
  return value;
}

function compareObservedPlayers(left: ObservedPlayer, right: ObservedPlayer): number {
  const sourceOrder = compareSourceIds(left, right);
  if (sourceOrder !== 0) return sourceOrder;
  const leftKey = JSON.stringify(stableOrderingValue(left));
  const rightKey = JSON.stringify(stableOrderingValue(right));
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function isStableSteam64(sourcePlayerId: string): boolean {
  return STEAM64_PATTERN.test(sourcePlayerId);
}

function issue(
  code: LineupIssueCode,
  severity: LineupIssue['severity'],
  message: string,
  details: Omit<LineupIssue, 'code' | 'severity' | 'message'> = {},
): LineupIssue {
  return { code, severity, message, ...details };
}

function hasGameplayEvidence(player: ObservedPlayer): boolean {
  const activity = player.activity?.trim().toLowerCase();
  if (activity === 'observer' || activity === 'spectating' || activity === 'watching') return false;
  if (activity === 'coach' || activity === 'coaching') return false;
  return (
    player.state !== undefined ||
    player.matchStats !== undefined ||
    player.weapons !== undefined ||
    player.position !== undefined ||
    player.forward !== undefined ||
    activity === 'playing'
  );
}

function observedSide(player: ObservedPlayer): Candidate['side'] | undefined {
  return player.side === 'CT' || player.side === 'T' ? player.side : undefined;
}

function isPreviousBaseline(resolution: ActiveLineupResolution | undefined): boolean {
  return (
    resolution !== undefined &&
    resolution.ct.length === 5 &&
    resolution.t.length === 5 &&
    resolution.mapEpoch >= 0
  );
}

function identityFor(
  observed: ObservedPlayer,
  input: ActiveLineupInput,
): Pick<ActiveLineupPlayer, 'canonicalPlayerId' | 'identityEvidence'> {
  const canonical = input.identity?.players.find(
    (player) => player.sourcePlayerId === observed.sourcePlayerId,
  );
  if (canonical !== undefined) {
    return { canonicalPlayerId: canonical.canonicalPlayerId, identityEvidence: 'canonical' };
  }
  if (input.context !== undefined) {
    return {
      canonicalPlayerId: null,
      identityEvidence: 'unresolved',
    };
  }
  return {
    canonicalPlayerId: null,
    identityEvidence: isStableSteam64(observed.sourcePlayerId) ? 'observed' : 'unresolved',
  };
}

function toLineupPlayer(
  observed: ObservedPlayer,
  input: ActiveLineupInput,
  side: 'CT' | 'T',
  lineupEvidence: LineupEvidence,
): ActiveLineupPlayer {
  return {
    sourcePlayerId: observed.sourcePlayerId,
    ...identityFor(observed, input),
    lineupEvidence,
    observed,
    side,
  };
}

interface UniqueObservedPlayers {
  readonly players: readonly ObservedPlayer[];
  readonly conflictedSourcePlayerIds: ReadonlySet<string>;
}

function uniqueObservedPlayers(
  players: readonly ObservedPlayer[],
  issues: LineupIssue[],
): UniqueObservedPlayers {
  const unique = new Map<string, ObservedPlayer>();
  const conflictedSourcePlayerIds = new Set<string>();
  for (const player of [...players].sort(compareObservedPlayers)) {
    const existing = unique.get(player.sourcePlayerId);
    if (existing !== undefined) {
      if (
        JSON.stringify(stableOrderingValue(existing)) !==
        JSON.stringify(stableOrderingValue(player))
      ) {
        conflictedSourcePlayerIds.add(player.sourcePlayerId);
      }
      issues.push(
        issue(
          'duplicate_observed_identity',
          'warning',
          `当前 allplayers 重复出现 source player ${player.sourcePlayerId}。`,
          { sourcePlayerId: player.sourcePlayerId },
        ),
      );
      continue;
    }
    unique.set(player.sourcePlayerId, player);
  }
  return { players: [...unique.values()], conflictedSourcePlayerIds };
}

function candidatePlayers(
  players: readonly ObservedPlayer[],
  conflictedSourcePlayerIds: ReadonlySet<string>,
  input: ActiveLineupInput,
  issues: LineupIssue[],
): { readonly candidates: readonly Candidate[]; readonly excluded: readonly ObservedPlayer[] } {
  const include = new Set(input.override?.includeSourcePlayerIds ?? []);
  const exclude = new Set(input.override?.excludeSourcePlayerIds ?? []);
  const candidates: Candidate[] = [];
  const excluded: ObservedPlayer[] = [];
  for (const player of players) {
    const side = observedSide(player);
    if (conflictedSourcePlayerIds.has(player.sourcePlayerId)) continue;
    if (exclude.has(player.sourcePlayerId)) {
      excluded.push(player);
      issues.push(
        issue(
          'excluded_observed_player',
          'info',
          `source player ${player.sourcePlayerId} 已按本地 recovery override 排除。`,
          { sourcePlayerId: player.sourcePlayerId },
        ),
      );
      continue;
    }
    if (side === undefined) continue;
    if (include.has(player.sourcePlayerId) || hasGameplayEvidence(player)) {
      candidates.push({ observed: player, side });
    }
  }
  return { candidates, excluded };
}

function extrasFrom(
  players: readonly ObservedPlayer[],
  selected: ReadonlySet<string>,
): readonly ObservedPlayer[] {
  return players
    .filter((player) => !selected.has(player.sourcePlayerId))
    .sort(compareSourceIds)
    .slice(0, MAX_LINEUP_EXTRAS);
}

function retainPrevious(
  previous: ActiveLineupResolution,
  currentPlayers: readonly ObservedPlayer[],
  conflictedSourcePlayerIds: ReadonlySet<string>,
  input: ActiveLineupInput,
  issues: LineupIssue[],
  lineupEvidence: LineupEvidence,
): ActiveLineupResolution {
  const bySourceId = new Map(
    currentPlayers.map((player) => [player.sourcePlayerId, player] as const),
  );
  const update = (player: ActiveLineupPlayer): ActiveLineupPlayer => {
    const current = bySourceId.get(player.sourcePlayerId);
    if (current === undefined || conflictedSourcePlayerIds.has(player.sourcePlayerId)) {
      return { ...player, lineupEvidence: 'retained', observed: null };
    }
    // A dirty collection may show a partial side switch. Keep the last
    // proven assignment until a clean 5+5 frame can update both sides.
    return toLineupPlayer(current, input, player.side, lineupEvidence);
  };
  const ct = previous.ct.map(update);
  const t = previous.t.map(update);
  const selected = new Set([...ct, ...t].map((player) => player.sourcePlayerId));
  const extras = extrasFrom(currentPlayers, selected);
  if (extras.length > 0) {
    issues.push(
      issue(
        'extra_observed_player',
        'warning',
        '当前 source 存在未进入稳定 on-air lineup 的额外实体。',
      ),
    );
  }
  if (
    ct.some((player) => player.lineupEvidence === 'retained') ||
    t.some((player) => player.lineupEvidence === 'retained')
  ) {
    issues.push(
      issue('retained_baseline', 'info', '当前 frame 不完整，保留上一份稳定 5+5 lineup。'),
    );
  }
  return {
    state: 'degraded',
    sourceGeneration: input.sourceGeneration,
    mapEpoch: input.mapEpoch,
    ct,
    t,
    extras,
    issues,
  };
}

function noCurrentEvidence(
  input: ActiveLineupInput,
  previous: ActiveLineupResolution | undefined,
  currentPlayers: UniqueObservedPlayers,
  issues: LineupIssue[],
): ActiveLineupResolution {
  issues.push(
    issue(
      input.allPlayersCoverage === 'degraded' ? 'allplayers_degraded' : 'allplayers_unavailable',
      'warning',
      input.allPlayersCoverage === 'degraded'
        ? '当前 allplayers evidence degraded，等待新的稳定 lineup。'
        : '当前没有 allplayers evidence，等待新的稳定 lineup。',
    ),
  );
  if (
    previous !== undefined &&
    previous.mapEpoch === input.mapEpoch &&
    isPreviousBaseline(previous)
  ) {
    return retainPrevious(
      previous,
      currentPlayers.players,
      currentPlayers.conflictedSourcePlayerIds,
      input,
      issues,
      'retained',
    );
  }
  return {
    state: input.allPlayersCoverage === 'degraded' ? 'degraded' : 'resolving',
    sourceGeneration: input.sourceGeneration,
    mapEpoch: input.mapEpoch,
    ct: [],
    t: [],
    extras: [],
    issues,
  };
}

export function emptyActiveLineup(sourceGeneration = 0, mapEpoch = 0): ActiveLineupResolution {
  return {
    state: 'resolving',
    sourceGeneration,
    mapEpoch,
    ct: [],
    t: [],
    extras: [],
    issues: [],
  };
}

export function resolveActiveLineup(input: ActiveLineupInput): ActiveLineupResolution {
  const issues: LineupIssue[] = [];
  const coverage = input.allPlayersCoverage ?? 'absent';
  const uniquePlayers = uniqueObservedPlayers(input.allPlayers ?? [], issues);
  if (coverage !== 'present') {
    return noCurrentEvidence(
      { ...input, allPlayersCoverage: coverage },
      input.previous,
      uniquePlayers,
      issues,
    );
  }

  const { candidates } = candidatePlayers(
    uniquePlayers.players,
    uniquePlayers.conflictedSourcePlayerIds,
    input,
    issues,
  );
  const ctCandidates = candidates.filter((candidate) => candidate.side === 'CT');
  const tCandidates = candidates.filter((candidate) => candidate.side === 'T');
  const uniqueSteam64 = new Set(candidates.map((candidate) => candidate.observed.sourcePlayerId));
  const hasExactFiveVsFive =
    ctCandidates.length === 5 &&
    tCandidates.length === 5 &&
    uniqueSteam64.size === 10 &&
    candidates.every((candidate) => isStableSteam64(candidate.observed.sourcePlayerId));

  if (hasExactFiveVsFive) {
    const selected = new Set(candidates.map((candidate) => candidate.observed.sourcePlayerId));
    const extras = extrasFrom(uniquePlayers.players, selected);
    if (extras.length > 0) {
      issues.push(
        issue(
          'extra_observed_player',
          'warning',
          '当前 source 存在额外实体，但不挤占稳定 5+5 lineup。',
        ),
      );
    }
    return {
      state: 'complete',
      sourceGeneration: input.sourceGeneration,
      mapEpoch: input.mapEpoch,
      ct: ctCandidates.map((candidate) =>
        toLineupPlayer(candidate.observed, input, candidate.side, 'current'),
      ),
      t: tCandidates.map((candidate) =>
        toLineupPlayer(candidate.observed, input, candidate.side, 'current'),
      ),
      extras,
      issues,
    };
  }

  if (
    input.previous !== undefined &&
    input.previous.mapEpoch === input.mapEpoch &&
    isPreviousBaseline(input.previous)
  ) {
    return retainPrevious(
      input.previous,
      uniquePlayers.players,
      uniquePlayers.conflictedSourcePlayerIds,
      input,
      issues,
      'current',
    );
  }

  issues.push(
    issue(
      ctCandidates.length > 5 || tCandidates.length > 5
        ? 'ambiguous_candidates'
        : 'insufficient_candidates',
      'warning',
      ctCandidates.length > 5 || tCandidates.length > 5
        ? '当前候选超过单侧五人且无法无歧义选择稳定 lineup。'
        : '当前 evidence 尚不能证明双方各五名 active player。',
    ),
  );
  return {
    state: 'resolving',
    sourceGeneration: input.sourceGeneration,
    mapEpoch: input.mapEpoch,
    ct: [],
    t: [],
    extras: uniquePlayers.players.slice(0, MAX_LINEUP_EXTRAS),
    issues,
  };
}
