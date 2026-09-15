import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { RuntimeTime } from '@rivalhub-broadcast/core/runtime';

import type { ProgramRuntimeSnapshot } from '../runtime/program-runtime.js';

export const QUALIFICATION_SCHEMA_VERSION = 1 as const;
export const QUALIFICATION_MAX_MARKERS = 128;

export const QUALIFICATION_MARKER_KINDS = [
  'demo-a-live',
  'demo-a-stopped',
  'cs2-closed',
  'runtime-stale',
  'next-execution',
  'cs2-reopened',
  'demo-b-live',
] as const;

export type QualificationMarkerKind = (typeof QUALIFICATION_MARKER_KINDS)[number];
export type QualificationMarkerPhase = 'before' | 'after';
export type QualificationFreshness = 'awaiting' | 'fresh' | 'stale';

export interface QualificationClock {
  now(): RuntimeTime;
}

export interface QualificationResetEvidence {
  readonly disposition: 'accepted' | 'ignored';
  readonly reason: 'map-execution-reset';
  readonly resetReason: 'operator-correction';
  readonly previousMapEpoch: number;
  readonly mapEpoch: number;
}

export interface QualificationMarker {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly kind: QualificationMarkerKind;
  readonly monotonicMs: number;
  readonly wallClockAt: string;
  readonly producerInstanceId: string;
  readonly mapEpoch: number;
  readonly runtimeSeq: number;
  readonly sourceGeneration: number;
  readonly freshness: QualificationFreshness;
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
  return (
    typeof value === 'string' && (QUALIFICATION_MARKER_KINDS as readonly string[]).includes(value)
  );
}

function assertFiniteRuntimeTime(at: RuntimeTime): void {
  if (!Number.isFinite(at.monotonicMs)) {
    throw new RangeError('qualification clock must return a finite monotonic timestamp');
  }
  if (typeof at.utc !== 'string' || at.utc.length === 0) {
    throw new RangeError('qualification clock must return a non-empty UTC timestamp');
  }
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
    if (options.runId.trim().length === 0) throw new Error('qualification runId must be non-empty');
    if (
      options.maxMarkers !== undefined &&
      (!Number.isSafeInteger(options.maxMarkers) ||
        options.maxMarkers <= 0 ||
        options.maxMarkers > QUALIFICATION_MAX_MARKERS)
    ) {
      throw new RangeError(
        `qualification maxMarkers must be between 1 and ${QUALIFICATION_MAX_MARKERS}`,
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
      throw new Error(`unsupported qualification marker: ${String(kind)}`);
    }
    const at = this.clock.now();
    assertFiniteRuntimeTime(at);
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
