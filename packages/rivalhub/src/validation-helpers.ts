import { z } from 'zod';

import { makeContractDiagnostic, type ContractDiagnostic } from './diagnostics.js';

export const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const ISO_TIMESTAMP_SCHEMA = z.iso.datetime({ offset: true });

export function isValidIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && ISO_TIMESTAMP_SCHEMA.safeParse(value).success;
}

export function structuralDiagnostics(
  error: z.ZodError,
  contractName: string,
): ContractDiagnostic[] {
  return error.issues.map((issue) =>
    makeContractDiagnostic(
      'structural',
      'error',
      'invalid_shape',
      issue.path.length === 0 ? '$' : issue.path.map(String).join('.'),
      `contract 字段形状不符合 ${contractName}。`,
    ),
  );
}

export function addSemanticDiagnostic(
  diagnostics: ContractDiagnostic[],
  code: ContractDiagnostic['code'],
  severity: ContractDiagnostic['severity'],
  path: string,
  message: string,
): void {
  diagnostics.push(makeContractDiagnostic('semantic', severity, code, path, message));
}

export function nonEmpty(
  value: string,
  path: string,
  diagnostics: ContractDiagnostic[],
  label: string,
): void {
  if (value.trim().length === 0) {
    addSemanticDiagnostic(diagnostics, 'empty_id', 'error', path, `${label} 不能为空。`);
  }
}

export function timestamp(
  value: string | null,
  path: string,
  diagnostics: ContractDiagnostic[],
): void {
  if (value === null) return;
  if (!isValidIsoTimestamp(value)) {
    addSemanticDiagnostic(
      diagnostics,
      'invalid_timestamp',
      'error',
      path,
      '时间必须是有效的 ISO timestamp 或 null。',
    );
  }
}

export function scorePair(
  scoreA: number | null,
  scoreB: number | null,
  path: string,
  diagnostics: ContractDiagnostic[],
): void {
  if ((scoreA === null) !== (scoreB === null)) {
    addSemanticDiagnostic(
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
    addSemanticDiagnostic(diagnostics, 'invalid_field', 'error', path, '比分必须是非负安全整数。');
  }
}
