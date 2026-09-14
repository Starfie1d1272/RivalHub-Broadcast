import { DiagnosticCollector, summarizeScalar } from '../diagnostics/collector.js';
import type { SourceRecord } from './record.js';

export function optionalString(
  record: SourceRecord,
  key: string,
  diagnostics: DiagnosticCollector,
  path: string,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'string') {
    diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
    return undefined;
  }
  return value;
}

export function optionalNumber(
  record: SourceRecord,
  key: string,
  diagnostics: DiagnosticCollector,
  path: string,
): number | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
    return undefined;
  }
  return value;
}

const DECIMAL_STRING_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function optionalDecimalString(
  record: SourceRecord,
  key: string,
  diagnostics: DiagnosticCollector,
  path: string,
): number | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'string' || !DECIMAL_STRING_PATTERN.test(value)) {
    diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
    return undefined;
  }
  return parsed;
}

export function optionalInteger(
  record: SourceRecord,
  key: string,
  diagnostics: DiagnosticCollector,
  path: string,
): number | undefined {
  const value = optionalNumber(record, key, diagnostics, path);
  if (value === undefined || Number.isInteger(value)) return value;
  diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
  return undefined;
}

export function optionalBoolean(
  record: SourceRecord,
  key: string,
  diagnostics: DiagnosticCollector,
  path: string,
): boolean | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'boolean') {
    diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
    return undefined;
  }
  return value;
}
