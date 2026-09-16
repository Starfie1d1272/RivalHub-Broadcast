import { z } from 'zod';

import {
  hasBlockingDiagnostic,
  makeContractDiagnostic,
  validationFailure,
  validationSuccess,
  type ContractDiagnostic,
  type ContractValidationResult,
} from '../diagnostics.js';
import { broadcastScheduleWindowSchema } from './schema.js';
import {
  BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION,
  type BroadcastScheduleMatchV1,
  type BroadcastScheduleWindowV1,
} from './types.js';

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function hasUnsupportedSchemaVersion(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    'schemaVersion' in input &&
    input.schemaVersion !== BROADCAST_SCHEDULE_WINDOW_SCHEMA_VERSION
  );
}

function pathOf(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.');
}

function structuralDiagnostics(error: z.ZodError): ContractDiagnostic[] {
  return error.issues.map((issue) =>
    makeContractDiagnostic(
      'structural',
      'error',
      issue.code === 'unrecognized_keys' ? 'unexpected_field' : 'invalid_shape',
      pathOf(issue.path),
      issue.code === 'unrecognized_keys'
        ? 'contract 包含未声明字段。'
        : 'contract 字段形状不符合 BroadcastScheduleWindowV1。',
    ),
  );
}

function add(
  diagnostics: ContractDiagnostic[],
  code: ContractDiagnostic['code'],
  severity: ContractDiagnostic['severity'],
  path: string,
  message: string,
): void {
  diagnostics.push(makeContractDiagnostic('semantic', severity, code, path, message));
}

function nonEmpty(
  value: string,
  path: string,
  diagnostics: ContractDiagnostic[],
  label: string,
): void {
  if (value.trim().length === 0) add(diagnostics, 'empty_id', 'error', path, `${label} 不能为空。`);
}

function timestamp(value: string | null, path: string, diagnostics: ContractDiagnostic[]): void {
  if (value === null) return;
  if (!ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    add(
      diagnostics,
      'invalid_timestamp',
      'error',
      path,
      '时间必须是有效的 ISO timestamp 或 null。',
    );
  }
}

function scorePair(
  scoreA: number | null,
  scoreB: number | null,
  path: string,
  diagnostics: ContractDiagnostic[],
): void {
  if ((scoreA === null) !== (scoreB === null)) {
    add(
      diagnostics,
      'incomplete_score_pair',
      'error',
      path,
      'scoreA 与 scoreB 必须同时为 number 或同时为 null。',
    );
    return;
  }
  if (scoreA === null || scoreB === null) return;
  if (!Number.isSafeInteger(scoreA) || !Number.isSafeInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    add(diagnostics, 'invalid_field', 'error', path, '比分必须是非负安全整数。');
  }
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
    add(diagnostics, 'invalid_time_window', 'error', 'from', '时间窗口必须满足 from <= to。');
  }

  const matchIds = new Set<string>();
  for (const [index, match] of value.matches.entries()) {
    const path = `matches.${index}`;
    nonEmpty(match.matchId, `${path}.matchId`, diagnostics, 'matchId');
    if (matchIds.has(match.matchId)) {
      add(
        diagnostics,
        'duplicate_match_id',
        'error',
        `${path}.matchId`,
        'ScheduleWindow 内 matchId 必须唯一。',
      );
    }
    matchIds.add(match.matchId);
    nonEmpty(match.stage, `${path}.stage`, diagnostics, 'stage');
    nonEmpty(match.entrantA.entryId, `${path}.entrantA.entryId`, diagnostics, 'entryId');
    nonEmpty(match.entrantB.entryId, `${path}.entrantB.entryId`, diagnostics, 'entryId');
    nonEmpty(match.entrantA.name, `${path}.entrantA.name`, diagnostics, 'entrant name');
    nonEmpty(match.entrantB.name, `${path}.entrantB.name`, diagnostics, 'entrant name');
    if (match.entrantA.entryId === match.entrantB.entryId) {
      add(
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

function scheduleTime(match: BroadcastScheduleMatchV1): number {
  if (match.scheduledAt === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(match.scheduledAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareScheduleMatches(
  left: BroadcastScheduleMatchV1,
  right: BroadcastScheduleMatchV1,
): number {
  const timeDifference = scheduleTime(left) - scheduleTime(right);
  return timeDifference !== 0 ? timeDifference : compareStrings(left.matchId, right.matchId);
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
  if (!parsed.success) return validationFailure(structuralDiagnostics(parsed.error));

  const value = parsed.data as BroadcastScheduleWindowV1;
  const diagnostics = validateScheduleSemantics(value);
  if (hasBlockingDiagnostic(diagnostics)) return validationFailure(diagnostics);
  return validationSuccess({ ...value, matches: sortScheduleMatches(value.matches) }, diagnostics);
}

export const parseBroadcastScheduleWindow = validateBroadcastScheduleWindow;
export const validateScheduleWindow = validateBroadcastScheduleWindow;
