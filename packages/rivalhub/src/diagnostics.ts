export type ContractDiagnosticKind = 'structural' | 'semantic';

export type ContractDiagnosticSeverity = 'warning' | 'error';

export type ContractDiagnosticCode =
  | 'unsupported_schema_version'
  | 'invalid_shape'
  | 'unexpected_field'
  | 'empty_id'
  | 'duplicate_entry_id'
  | 'duplicate_player_id'
  | 'duplicate_steam64'
  | 'invalid_steam64'
  | 'missing_steam64'
  | 'missing_display_name'
  | 'incomplete_roster'
  | 'invalid_map_order'
  | 'invalid_round'
  | 'duplicate_map_order'
  | 'duplicate_map_id'
  | 'unknown_entry_reference'
  | 'invalid_veto_step_order'
  | 'duplicate_veto_step_order'
  | 'incomplete_score_pair'
  | 'invalid_timestamp'
  | 'invalid_time_window'
  | 'duplicate_match_id'
  | 'invalid_field';

export interface ContractDiagnostic {
  readonly kind: ContractDiagnosticKind;
  readonly severity: ContractDiagnosticSeverity;
  readonly code: ContractDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface ContractValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly issues: readonly ContractDiagnostic[];
}

export interface ContractValidationFailure {
  readonly ok: false;
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly issues: readonly ContractDiagnostic[];
}

export type ContractValidationResult<T> = ContractValidationSuccess<T> | ContractValidationFailure;

export function makeContractDiagnostic(
  kind: ContractDiagnosticKind,
  severity: ContractDiagnosticSeverity,
  code: ContractDiagnosticCode,
  path: string,
  message: string,
): ContractDiagnostic {
  return { kind, severity, code, path, message };
}

export function hasBlockingDiagnostic(diagnostics: readonly ContractDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function validationFailure(
  diagnostics: readonly ContractDiagnostic[],
): ContractValidationFailure {
  return { ok: false, diagnostics, issues: diagnostics };
}

export function validationSuccess<T>(
  value: T,
  diagnostics: readonly ContractDiagnostic[],
): ContractValidationSuccess<T> {
  return { ok: true, value, diagnostics, issues: diagnostics };
}
