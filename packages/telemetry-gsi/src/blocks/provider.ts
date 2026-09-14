import type { DiagnosticCollector } from '../diagnostics/collector.js';
import { asSourceRecord } from '../parse/record.js';
import { optionalNumber } from '../parse/scalar.js';
import { finishBlock, type ParsedBlock } from './types.js';

export interface ParsedProvider {
  readonly timestampSeconds?: number;
}

export function parseProvider(
  value: unknown,
  diagnostics: DiagnosticCollector,
  path: string,
): ParsedBlock<ParsedProvider> {
  const start = diagnostics.totalCount;
  const record = asSourceRecord(value);
  if (record === undefined) {
    diagnostics.add('UNEXPECTED_BLOCK_SHAPE', 'error', path);
    return finishBlock<ParsedProvider>(diagnostics, start, undefined);
  }

  const timestampSeconds = optionalNumber(record, 'timestamp', diagnostics, `${path}.timestamp`);
  return finishBlock(
    diagnostics,
    start,
    timestampSeconds === undefined ? {} : { timestampSeconds },
  );
}
