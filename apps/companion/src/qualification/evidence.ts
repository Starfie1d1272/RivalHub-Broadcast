import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { RuntimeTime } from '@rivalhub-broadcast/core/runtime';

import type { ProgramRuntimeSnapshot } from '../runtime/program-runtime.js';
import qualificationContractJson from './contract.json' with { type: 'json' };

type QualificationContract = {
  readonly schemaVersion: 1;
  readonly maxMarkers: 128;
  readonly nodeRuntimeVersion: `v24.${number}.${number}`;
  readonly markerKinds: readonly QualificationMarkerKind[];
  readonly liveMarkerKinds: readonly QualificationMarkerKind[];
  readonly markerPhases: readonly QualificationMarkerPhase[];
  readonly freshnessValues: readonly QualificationFreshness[];
  readonly resultValues: readonly QualificationResult[];
  readonly checkKeys: readonly QualificationCheckKey[];
  readonly resetDispositionValues: readonly QualificationResetDisposition[];
  readonly resetEvidenceFields: readonly QualificationResetEvidenceField[];
  readonly resetKind: 'map-execution-reset';
  readonly resetReason: 'operator-correction';
};

export type QualificationMarkerKind =
  | 'demo-a-live'
  | 'cs2-closed'
  | 'runtime-stale'
  | 'next-execution'
  | 'cs2-reopened'
  | 'demo-b-live';
export type QualificationMarkerPhase = 'before' | 'after';
export type QualificationFreshness = 'awaiting' | 'fresh' | 'stale';
export type QualificationResult = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type QualificationCheckKey =
  | 'productionChain'
  | 'realSilenceToStale'
  | 'explicitNextExecution'
  | 'demoBRecovery'
  | 'captureIntegrity';
export type QualificationResetDisposition = 'accepted' | 'ignored';
export type QualificationResetEvidenceField =
  | 'disposition'
  | 'reason'
  | 'resetReason'
  | 'previousMapEpoch'
  | 'mapEpoch'
  | 'programTelemetryCleared';

const qualificationContract = qualificationContractJson as QualificationContract;

export const QUALIFICATION_SCHEMA_VERSION = qualificationContract.schemaVersion;
export const QUALIFICATION_MAX_MARKERS = qualificationContract.maxMarkers;
export const QUALIFICATION_MARKER_KINDS = qualificationContract.markerKinds;
export const QUALIFICATION_LIVE_MARKER_KINDS = qualificationContract.liveMarkerKinds;
export const QUALIFICATION_FRESHNESS_VALUES = qualificationContract.freshnessValues;
export const QUALIFICATION_RESULT_VALUES = qualificationContract.resultValues;
export const QUALIFICATION_CHECK_KEYS = qualificationContract.checkKeys;
export const QUALIFICATION_RESET_EVIDENCE_FIELDS = qualificationContract.resetEvidenceFields;
export const QUALIFICATION_RESET_KIND = qualificationContract.resetKind;
export const QUALIFICATION_RESET_REASON = qualificationContract.resetReason;

export interface QualificationClock {
  now(): RuntimeTime;
}

export interface QualificationResetEvidence {
  readonly disposition: 'accepted' | 'ignored';
  readonly reason: 'map-execution-reset';
  readonly resetReason: 'operator-correction';
  readonly previousMapEpoch: number;
  readonly mapEpoch: number;
  readonly programTelemetryCleared: boolean;
}

export interface QualificationAcceptedObservation {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly receivedMonotonicMs: number;
  readonly producerInstanceId: string;
  readonly sourceGeneration: number;
  readonly mapEpoch: number;
  readonly runtimeSeq: number;
  readonly freshness: QualificationFreshness;
}

export interface QualificationMarker {
  readonly schemaVersion: typeof QUALIFICATION_SCHEMA_VERSION;
  readonly runId: string;
  readonly kind: QualificationMarkerKind;
  readonly monotonicMs: number;
  readonly wallClockAt: string;
  readonly producerInstanceId: string;
  readonly mapEpoch: number;
  readonly runtimeSeq: number;
  readonly sourceGeneration: number;
  readonly freshness: QualificationFreshness;
  readonly observation: QualificationAcceptedObservation | null;
  readonly phase?: QualificationMarkerPhase;
  readonly reset?: QualificationResetEvidence;
}

export interface QualificationEvidenceStoreOptions {
  readonly runId: string;
  readonly scenarioPath?: string;
  readonly clock: QualificationClock;
  readonly maxMarkers?: number;
}

export interface QualificationEvidenceSnapshot {
  readonly markers: readonly QualificationMarker[];
  readonly lastMarker: QualificationMarker | null;
  readonly scenarioWriteFailed: boolean;
}

function isQualificationMarkerKind(value: unknown): value is QualificationMarkerKind {
  return typeof value === 'string' && QUALIFICATION_MARKER_KINDS.some((kind) => kind === value);
}

function assertFiniteRuntimeTime(at: RuntimeTime): void {
  if (!Number.isFinite(at.monotonicMs)) {
    throw new RangeError('qualification clock 必须返回有限的 monotonic 时间戳');
  }
  if (typeof at.utc !== 'string' || at.utc.length === 0) {
    throw new RangeError('qualification clock 必须返回非空的 UTC 时间戳');
  }
}

function acceptedObservationFrom(
  snapshot: ProgramRuntimeSnapshot,
  freshness: QualificationFreshness,
): QualificationAcceptedObservation | null {
  const accepted = snapshot.current.programSource.lastAccepted;
  if (accepted === undefined) return null;
  return {
    sequence: accepted.sequence,
    receivedAt: accepted.receivedAt,
    receivedMonotonicMs: accepted.receivedMonotonicMs,
    producerInstanceId: snapshot.producerInstanceId,
    sourceGeneration: snapshot.current.programSource.generation,
    mapEpoch: snapshot.current.map.epoch,
    runtimeSeq: snapshot.current.runtimeSeq,
    freshness,
  };
}

export class QualificationEvidenceStore {
  private readonly runId: string;
  private readonly scenarioPath: string | undefined;
  private readonly clock: QualificationClock;
  private readonly maxMarkers: number;
  private readonly markers: QualificationMarker[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private lastFreshness: QualificationFreshness | undefined;
  private scenarioWriteFailed = false;

  constructor(options: QualificationEvidenceStoreOptions) {
    if (options.runId.trim().length === 0) throw new Error('qualification runId 不能为空');
    if (
      options.maxMarkers !== undefined &&
      (!Number.isSafeInteger(options.maxMarkers) ||
        options.maxMarkers <= 0 ||
        options.maxMarkers > QUALIFICATION_MAX_MARKERS)
    ) {
      throw new RangeError(
        `qualification maxMarkers 必须在 1 到 ${QUALIFICATION_MAX_MARKERS} 之间`,
      );
    }
    this.runId = options.runId;
    this.scenarioPath = options.scenarioPath;
    this.clock = options.clock;
    this.maxMarkers = options.maxMarkers ?? QUALIFICATION_MAX_MARKERS;
  }

  async recordMarker(
    kind: QualificationMarkerKind,
    snapshot: ProgramRuntimeSnapshot,
    freshness: QualificationFreshness,
    options: {
      readonly phase?: QualificationMarkerPhase;
      readonly reset?: QualificationResetEvidence;
    } = {},
  ): Promise<QualificationMarker> {
    if (!isQualificationMarkerKind(kind)) {
      throw new Error(`不支持的 qualification marker：${String(kind)}`);
    }
    const at = this.clock.now();
    assertFiniteRuntimeTime(at);
    const observation = acceptedObservationFrom(snapshot, freshness);
    if (
      QUALIFICATION_LIVE_MARKER_KINDS.includes(kind) &&
      (freshness !== 'fresh' || observation === null)
    ) {
      throw new Error(`${kind} 需要 fresh accepted observation`);
    }
    const marker: QualificationMarker = {
      schemaVersion: QUALIFICATION_SCHEMA_VERSION,
      runId: this.runId,
      kind,
      monotonicMs: at.monotonicMs,
      wallClockAt: at.utc,
      producerInstanceId: snapshot.producerInstanceId,
      mapEpoch: snapshot.current.map.epoch,
      runtimeSeq: snapshot.current.runtimeSeq,
      sourceGeneration: snapshot.current.programSource.generation,
      freshness,
      observation,
      ...(options.phase === undefined ? {} : { phase: options.phase }),
      ...(options.reset === undefined ? {} : { reset: options.reset }),
    };

    const write = this.writeChain.then(async () => {
      if (this.scenarioPath === undefined) return;
      await mkdir(dirname(this.scenarioPath), { recursive: true });
      await appendFile(this.scenarioPath, `${JSON.stringify(marker)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    });
    this.writeChain = write.catch(() => undefined);
    try {
      await write;
    } catch (error) {
      this.scenarioWriteFailed = true;
      throw error;
    }

    this.markers.push(marker);
    const overflow = this.markers.length - this.maxMarkers;
    if (overflow > 0) this.markers.splice(0, overflow);
    return marker;
  }

  async observeFreshness(
    freshness: QualificationFreshness,
    snapshot: ProgramRuntimeSnapshot,
  ): Promise<void> {
    if (freshness === 'stale' && this.lastFreshness !== 'stale') {
      await this.recordMarker('runtime-stale', snapshot, freshness);
    }
    this.lastFreshness = freshness;
  }

  getSnapshot(): QualificationEvidenceSnapshot {
    const markers = this.markers.slice();
    return {
      markers,
      lastMarker: markers.at(-1) ?? null,
      scenarioWriteFailed: this.scenarioWriteFailed,
    };
  }
}

export function createQualificationEvidenceStore(
  options: QualificationEvidenceStoreOptions,
): QualificationEvidenceStore {
  return new QualificationEvidenceStore(options);
}
