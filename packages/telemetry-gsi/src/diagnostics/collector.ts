import {
  MAX_DIAGNOSTICS_PER_FRAME,
  type GsiDiagnostic,
  type GsiDiagnosticBatch,
  type GsiDiagnosticCode,
  type GsiDiagnosticSeverity,
} from './types.js';

const MAX_RAW_VALUE_LENGTH = 64;

export function summarizeScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value.slice(0, MAX_RAW_VALUE_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return undefined;
}

export class DiagnosticCollector {
  private readonly entries: GsiDiagnostic[] = [];
  private total = 0;
  private suppressed = 0;

  get totalCount(): number {
    return this.total;
  }

  add(
    code: GsiDiagnosticCode,
    severity: GsiDiagnosticSeverity,
    path: string,
    rawValue?: string,
  ): void {
    this.total += 1;
    if (this.entries.length >= MAX_DIAGNOSTICS_PER_FRAME) {
      this.suppressed += 1;
      return;
    }

    const diagnostic: GsiDiagnostic = {
      code,
      severity,
      path: path.slice(0, MAX_RAW_VALUE_LENGTH),
      ...(rawValue === undefined ? {} : { rawValue: rawValue.slice(0, MAX_RAW_VALUE_LENGTH) }),
    };
    this.entries.push(diagnostic);
  }

  toBatch(): GsiDiagnosticBatch {
    return {
      entries: this.entries.slice(),
      suppressedCount: this.suppressed,
    };
  }
}
