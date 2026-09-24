export type CaptureSelection =
  | { readonly kind: 'all' }
  | {
      readonly kind: 'sequence-range';
      readonly firstSequence: number;
      readonly lastSequence: number;
    };

export interface GoldCaptureProvenanceV1 {
  readonly fixtureKind: 'sanitized-real-capture';
  readonly sourceCaptureId: string;
  readonly sourceFramesSha256: string;
  readonly sourceFrameSelection: CaptureSelection;
  readonly sanitizerVersion: 2;
  readonly lifecycleCoverage: 'partial' | 'full-match';
}

export interface ProductionCaptureProvenanceV1 {
  readonly kind: 'production-recorder';
  readonly recorderVersion: 1;
  readonly captureId: string;
  readonly artifactGitSha: string;
  readonly artifactSha256: string | null;
  readonly qualificationRunId: string | null;
  readonly framesSha256: string;
}

export type CaptureProvenanceV1 = GoldCaptureProvenanceV1 | ProductionCaptureProvenanceV1;

export interface CaptureClockV1 {
  readonly kind: 'node-performance';
  readonly origin: 'capture-start';
  readonly elapsedUnit: 'microseconds';
  readonly originMonotonicMs: number;
}

export interface CaptureManifestV1 {
  readonly formatVersion: 1;
  readonly captureId: string;
  readonly createdAt: string;
  readonly platform: string;
  readonly windowsVersion?: string;
  readonly cs2Build?: string | number;
  readonly broadcastCommit: string;
  readonly scenario: string;
  readonly notes?: string;
  readonly gsiConfig: Record<string, unknown>;
  readonly complete: boolean;
  readonly frameCount: number;
  readonly droppedFrames: number;
  readonly framesSha256?: string;
  readonly clock?: CaptureClockV1;
  readonly provenance?: CaptureProvenanceV1;
}

export interface CaptureFrameV1 {
  readonly version: 1;
  readonly sequence: number;
  readonly elapsedUs: number;
  readonly receivedAt: string;
  readonly payload: Record<string, unknown>;
}

export interface VerifiedCapture {
  readonly directory: string;
  readonly framesPath: string;
  readonly manifest: CaptureManifestV1;
  readonly computedFramesSha256: string;
  readonly firstElapsedUs: number;
  readonly lastElapsedUs: number;
}
