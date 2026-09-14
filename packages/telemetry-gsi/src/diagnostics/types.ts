export const MAX_DIAGNOSTICS_PER_FRAME = 64;

export type GsiDiagnosticCode =
  | 'INVALID_ROOT'
  | 'UNEXPECTED_BLOCK_SHAPE'
  | 'INVALID_FIELD'
  | 'MALFORMED_VECTOR'
  | 'UNKNOWN_GSI_ENUM'
  | 'INVALID_ALLPLAYERS_ENTRY'
  | 'INVALID_GRENADE_ENTRY'
  | 'INVALID_ENTITY';

export type GsiDiagnosticSeverity = 'warning' | 'error' | 'fatal';

export interface GsiDiagnostic {
  readonly code: GsiDiagnosticCode;
  readonly severity: GsiDiagnosticSeverity;
  readonly path: string;
  readonly rawValue?: string;
}

export interface GsiDiagnosticBatch {
  readonly entries: readonly GsiDiagnostic[];
  readonly suppressedCount: number;
}
