import type { DiagnosticCollector } from '../diagnostics/collector.js';

export interface ParsedBlock<T> {
  readonly value?: T;
  readonly degraded: boolean;
}

export function finishBlock<T>(
  diagnostics: DiagnosticCollector,
  startDiagnosticCount: number,
  value: T | undefined,
): ParsedBlock<T> {
  return {
    ...(value === undefined ? {} : { value }),
    degraded: diagnostics.totalCount > startDiagnosticCount,
  };
}
