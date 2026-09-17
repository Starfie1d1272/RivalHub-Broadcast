import type { MatchContext } from '../match-context/index.js';
import type { SourceSide } from '../telemetry/map.js';
import type { IdentityIssue, IdentityResolution, IdentitySideMapping } from './types.js';
import type { NormalizedIdentityEvidence } from './evidence.js';
import type { ResolvedIdentityPlayer } from './types.js';

const KNOWN_SIDES: readonly SourceSide[] = ['CT', 'T'];

function issue(
  code: IdentityIssue['code'],
  message: string,
  details: Omit<IdentityIssue, 'code' | 'severity' | 'message'> = {},
  severity: IdentityIssue['severity'] = 'warning',
): IdentityIssue {
  return { code, severity, message, ...details };
}

function previousSide(previous: IdentityResolution | undefined, entry: 'a' | 'b'): SourceSide {
  return previous?.sideMapping[entry] ?? 'unknown';
}

function deriveSideFromMapNames(
  context: MatchContext,
  evidence: NormalizedIdentityEvidence,
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

function deriveSideFromPlayers(
  entryId: string,
  players: readonly ResolvedIdentityPlayer[],
  issues: IdentityIssue[],
): SourceSide | undefined {
  const observedSides = new Set(
    players
      .filter((player) => player.entryId === entryId && KNOWN_SIDES.includes(player.side))
      .map((player) => player.side),
  );
  if (observedSides.size === 1) return [...observedSides][0];
  if (observedSides.size > 1) {
    issues.push(
      issue(
        'ambiguous_side_mapping',
        `参赛方 ${entryId} 在当前 evidence 中同时出现 CT 与 T，暂不信任 side mapping。`,
        { entryId },
        'error',
      ),
    );
    return 'unknown';
  }
  return undefined;
}

function deriveEntrySide(
  context: MatchContext,
  evidence: NormalizedIdentityEvidence,
  entryId: string,
  players: readonly ResolvedIdentityPlayer[],
  previous: IdentityResolution | undefined,
  entry: 'a' | 'b',
  issues: IdentityIssue[],
): SourceSide {
  const playerSide = deriveSideFromPlayers(entryId, players, issues);
  const mapSide = deriveSideFromMapNames(context, evidence, entryId);

  // A Steam64-resolved player's side is current proof. Map team names are
  // only fallback/cross-check and must never overwrite that proof.
  if (playerSide !== undefined && playerSide !== 'unknown') {
    if (mapSide !== undefined && mapSide !== playerSide) {
      issues.push(
        issue(
          'side_mapping_conflict',
          `参赛方 ${entryId} 的 player side 与 map.team_ct/team_t.name 冲突；采用 player proof。`,
          { entryId, observedSide: playerSide, mapSide },
        ),
      );
    }
    return playerSide;
  }
  if (playerSide === 'unknown') return 'unknown';
  if (mapSide !== undefined) return mapSide;
  return previousSide(previous, entry);
}

export function deriveSideMapping(
  context: MatchContext,
  evidence: NormalizedIdentityEvidence,
  players: readonly ResolvedIdentityPlayer[],
  previous: IdentityResolution | undefined,
  issues: IdentityIssue[],
): IdentitySideMapping {
  const sideMapping: IdentitySideMapping = {
    a: deriveEntrySide(
      context,
      evidence,
      context.entrants.a.entryId,
      players,
      previous,
      'a',
      issues,
    ),
    b: deriveEntrySide(
      context,
      evidence,
      context.entrants.b.entryId,
      players,
      previous,
      'b',
      issues,
    ),
  };

  if (
    sideMapping.a !== 'unknown' &&
    sideMapping.b !== 'unknown' &&
    sideMapping.a === sideMapping.b
  ) {
    issues.push(
      issue(
        'ambiguous_side_mapping',
        '双方当前 side 相同，不能安全推导 A/B side mapping.',
        {},
        'error',
      ),
    );
  }
  return sideMapping;
}
