import { DiagnosticCollector, summarizeScalar } from '../diagnostics/collector.js';
import type { SourceRecord } from './record.js';

export function optionalEnum<T extends string>(
  record: SourceRecord,
  key: string,
  normalize: (value: string) => T | undefined,
  unknownValue: T,
  diagnostics: DiagnosticCollector,
  path: string,
): T | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'string') {
    diagnostics.add('INVALID_FIELD', 'error', path, summarizeScalar(value));
    return undefined;
  }
  const normalized = normalize(value);
  if (normalized !== undefined) return normalized;
  diagnostics.add('UNKNOWN_GSI_ENUM', 'warning', path, value);
  return unknownValue;
}
