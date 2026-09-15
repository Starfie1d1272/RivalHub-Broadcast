export type CaptureErrorCode =
  | 'INVALID_MANIFEST'
  | 'UNSUPPORTED_FORMAT_VERSION'
  | 'INVALID_GSI_CONFIG'
  | 'INVALID_PROVENANCE'
  | 'INVALID_FRAME_JSON'
  | 'INVALID_FRAME_SHAPE'
  | 'INVALID_SEQUENCE'
  | 'INVALID_ELAPSED_US'
  | 'INVALID_RECEIVED_AT'
  | 'FRAME_COUNT_MISMATCH'
  | 'FRAMES_HASH_MISMATCH'
  | 'INVALID_SELECTION'
  | 'INELIGIBLE_GOLD_SOURCE'
  | 'UNFINALIZED_CAPTURE'
  | 'OUTPUT_EXISTS'
  | 'OUTPUT_PATH_INVALID'
  | 'SANITIZATION_LEAK';

export class CaptureFormatError extends Error {
  readonly code: CaptureErrorCode;
  readonly captureId?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly path?: string | undefined;

  constructor(
    code: CaptureErrorCode,
    message: string,
    details: { captureId?: string; lineNumber?: number; path?: string } = {},
  ) {
    super(message);
    this.name = 'CaptureFormatError';
    this.code = code;
    this.captureId = details.captureId;
    this.lineNumber = details.lineNumber;
    this.path = details.path;
  }
}

export class FaultPlanError extends Error {
  readonly code = 'INVALID_FAULT_PLAN' as const;

  constructor(message: string) {
    super(message);
    this.name = 'FaultPlanError';
  }
}
