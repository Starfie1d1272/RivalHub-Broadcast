import {
  hasBlockingDiagnostic,
  makeContractDiagnostic,
  validationFailure,
  validationSuccess,
  type ContractDiagnostic,
  type ContractValidationResult,
} from '../diagnostics.js';
import {
  ISO_TIMESTAMP_PATTERN,
  addSemanticDiagnostic,
  nonEmpty,
  scorePair,
  structuralDiagnostics,
  timestamp,
} from '../validation-helpers.js';
import { broadcastScheduleWindowSchema } from './schema.js';
import {
  BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION,
  type BroadcastScheduleMatchV1,
  type BroadcastScheduleWindowV1,
} from './types.js';

function hasUnsupportedSchemaVersion(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    'schemaVersion' in input &&
    input.schemaVersion !== BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION
  );
}

function validateScheduleSemantics(value: BroadcastScheduleWindowV1): ContractDiagnostic[] {
  const diagnostics: ContractDiagnostic[] = [];
  nonEmpty(value.revision, 'revision', diagnostics, 'revision');
  nonEmpty(
    value.competition.competitionId,
    'competition.competitionId',
    diagnostics,
    'competitionId',
  );
  nonEmpty(value.competition.slug, 'competition.slug', diagnostics, 'competition slug');
  nonEmpty(value.competition.name, 'competition.name', diagnostics, 'competition name');
  timestamp(value.from, 'from', diagnostics);
  timestamp(value.to, 'to', diagnostics);
  if (
    ISO_TIMESTAMP_PATTERN.test(value.from) &&
    Number.isFinite(Date.parse(value.from)) &&
    ISO_TIMESTAMP_PATTERN.test(value.to) &&
    Number.isFinite(Date.parse(value.to)) &&
    Date.parse(value.from) > Date.parse(value.to)
  ) {
    addSemanticDiagnostic(
      diagnostics,
      'invalid_time_window',
      'error',
      'from',
      '时间窗口必须满足 from <= to。',
    );
  }

  const matchIds = new Set<string>();
  for (const [index, match] of value.matches.entries()) {
    const path = `matches.${index}`;
    nonEmpty(match.matchId, `${path}.matchId`, diagnostics, 'matchId');
    if (matchIds.has(match.matchId)) {
      addSemanticDiagnostic(
        diagnostics,
        'duplicate_match_id',
        'error',
        `${path}.matchId`,
        'ScheduleWindow 内 matchId 必须唯一。',
      );
    }
    matchIds.add(match.matchId);
    nonEmpty(match.stage, `${path}.stage`, diagnostics, 'stage');
    if (match.round !== null && (!Number.isSafeInteger(match.round) || match.round < 1)) {
      addSemanticDiagnostic(
        diagnostics,
        'invalid_round',
        'error',
        `${path}.round`,
        'round 必须是从 1 开始的安全整数或 null。',
      );
    }
    nonEmpty(match.entrantA.entryId, `${path}.entrantA.entryId`, diagnostics, 'entryId');
    nonEmpty(match.entrantB.entryId, `${path}.entrantB.entryId`, diagnostics, 'entryId');
    nonEmpty(match.entrantA.name, `${path}.entrantA.name`, diagnostics, 'entrant name');
    nonEmpty(match.entrantB.name, `${path}.entrantB.name`, diagnostics, 'entrant name');
    if (match.entrantA.entryId === match.entrantB.entryId) {
      addSemanticDiagnostic(
        diagnostics,
        'duplicate_entry_id',
        'error',
        path,
        'entrantA 与 entrantB 的 entryId 不得相同。',
      );
    }
    timestamp(match.scheduledAt, `${path}.scheduledAt`, diagnostics);
    timestamp(match.startedAt, `${path}.startedAt`, diagnostics);
    timestamp(match.completedAt, `${path}.completedAt`, diagnostics);
    scorePair(match.scoreA, match.scoreB, `${path}.score`, diagnostics);
  }
  return diagnostics;
}

function scheduleTime(match: BroadcastScheduleMatchV1): number | undefined {
  if (match.scheduledAt === null) return undefined;
  const parsed = Date.parse(match.scheduledAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareScheduleMatches(
  left: BroadcastScheduleMatchV1,
  right: BroadcastScheduleMatchV1,
): number {
  const leftTime = scheduleTime(left);
  const rightTime = scheduleTime(right);
  if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftTime === undefined && rightTime !== undefined) return 1;
  if (leftTime !== undefined && rightTime === undefined) return -1;
  return compareStrings(left.matchId, right.matchId);
}

export function sortScheduleMatches(
  matches: readonly BroadcastScheduleMatchV1[],
): BroadcastScheduleMatchV1[] {
  return [...matches].sort(compareScheduleMatches);
}

export function validateBroadcastScheduleWindow(
  input: unknown,
): ContractValidationResult<BroadcastScheduleWindowV1> {
  if (hasUnsupportedSchemaVersion(input)) {
    return validationFailure([
      makeContractDiagnostic(
        'structural',
        'error',
        'unsupported_schema_version',
        'schemaVersion',
        '不支持的 BroadcastScheduleWindow schemaVersion。',
      ),
    ]);
  }
  const parsed = broadcastScheduleWindowSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(structuralDiagnostics(parsed.error, 'BroadcastScheduleWindowV1'));
  }

  const value = parsed.data;
  const diagnostics = validateScheduleSemantics(value);
  if (hasBlockingDiagnostic(diagnostics)) return validationFailure(diagnostics);
  return validationSuccess({ ...value, matches: sortScheduleMatches(value.matches) }, diagnostics);
}
