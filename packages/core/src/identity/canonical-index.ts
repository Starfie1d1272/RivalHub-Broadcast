import type {
  MatchContext,
  MatchEntrantContext,
  MatchPlayerContext,
} from '../match-context/index.js';

const STEAM64_PATTERN = /^\d{17}$/;

export interface CanonicalPlayer extends MatchPlayerContext {
  readonly entryId: string;
}

export interface CanonicalIndex {
  readonly all: readonly CanonicalPlayer[];
  readonly byPlayerId: ReadonlyMap<string, CanonicalPlayer>;
  readonly bySteam64: ReadonlyMap<string, CanonicalPlayer>;
  readonly duplicatePlayerIds: ReadonlySet<string>;
  readonly duplicateSteam64: ReadonlySet<string>;
}

export function buildCanonicalIndex(context: MatchContext): CanonicalIndex {
  const entrants: readonly MatchEntrantContext[] = [context.entrants.a, context.entrants.b];
  const all: CanonicalPlayer[] = [];
  const byPlayerId = new Map<string, CanonicalPlayer>();
  const bySteam64 = new Map<string, CanonicalPlayer>();
  const duplicatePlayerIds = new Set<string>();
  const duplicateSteam64 = new Set<string>();

  for (const entrant of entrants) {
    for (const player of entrant.players) {
      const canonical: CanonicalPlayer = { ...player, entryId: entrant.entryId };
      all.push(canonical);

      if (byPlayerId.has(player.playerId)) duplicatePlayerIds.add(player.playerId);
      byPlayerId.set(player.playerId, canonical);

      if (player.steam64 === null || !STEAM64_PATTERN.test(player.steam64)) continue;
      const existing = bySteam64.get(player.steam64);
      if (existing !== undefined) {
        duplicateSteam64.add(player.steam64);
        continue;
      }
      bySteam64.set(player.steam64, canonical);
    }
  }

  return { all, byPlayerId, bySteam64, duplicatePlayerIds, duplicateSteam64 };
}
