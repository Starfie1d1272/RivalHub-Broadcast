export { readCaptureManifest } from './capture/manifest.js';
export { iterateCaptureFrames, verifyCapture } from './capture/reader.js';
export { sanitizeCapture } from './capture/sanitizer.js';
export { canonicalJson, canonicalJsonLine } from './capture/canonical-json.js';
export type { SanitizeCaptureOptions } from './capture/sanitizer.js';
export type {
  CaptureFrameV1,
  CaptureManifestV1,
  CaptureSelection,
  GoldCaptureProvenanceV1,
  VerifiedCapture,
} from './capture/types.js';
export { CaptureFormatError, FaultPlanError } from './capture/errors.js';
export { replayCapture } from './replay/runner.js';
export { createReplaySession, ReplaySession } from './replay/session.js';
export type {
  ReplaySessionCursor,
  ReplaySessionEvent,
  ReplaySessionFrame,
  ReplaySessionScheduler,
  ReplaySessionSnapshot,
  ReplaySessionSource,
} from './replay/session.js';
export type {
  ReplayCaptureOptions,
  ReplayEvent,
  ReplayFaultPlanV1,
  ReplayMode,
  ReplayScheduler,
  ReplaySourceGenerationBoundary,
  ReplayedGsiFrame,
} from './replay/types.js';
