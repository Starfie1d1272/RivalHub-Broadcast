import { timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MapExecutionResetReason, RuntimeTime } from '@rivalhub-broadcast/core/runtime';

import type { DebugRuntimeResponse } from '../runtime/debug-state.js';
import type { ProgramRuntime } from '../runtime/program-runtime.js';
import type { RecorderHealth } from '../telemetry/capture-recorder.js';
import {
  QUALIFICATION_MARKER_KINDS,
  type QualificationClock,
  type QualificationEvidenceStore,
  type QualificationFreshness,
  type QualificationMarkerKind,
  type QualificationResetEvidence,
} from './evidence.js';
import { qualificationPageHtml } from './page.js';

export interface QualificationControllerOptions {
  readonly controlToken: string;
  readonly runId: string;
  readonly evidence: QualificationEvidenceStore;
  readonly clock?: QualificationClock;
  readonly getDebugResponse: (nowMonotonicMs: number) => DebugRuntimeResponse;
  readonly programRuntime: ProgramRuntime;
  readonly recorder: { getHealth(): RecorderHealth };
  readonly onAcceptedMapReset?: () => void;
  readonly onFinish?: () => void | Promise<void>;
}

interface QualificationCheck {
  readonly label: string;
  readonly status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly reason: string;
}

const RESET_REASON = 'operator-correction' as const satisfies MapExecutionResetReason;

const defaultClock: QualificationClock = {
  now: () => ({ monotonicMs: performance.now(), utc: new Date().toISOString() }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMarkerKind(value: unknown): value is QualificationMarkerKind {
  return (
    typeof value === 'string' && (QUALIFICATION_MARKER_KINDS as readonly string[]).includes(value)
  );
}

function hasMarker(
  markers: readonly { readonly kind: QualificationMarkerKind }[],
  kind: QualificationMarkerKind,
): boolean {
  return markers.some((marker) => marker.kind === kind);
}

function markerIndex(
  markers: readonly { readonly kind: QualificationMarkerKind }[],
  kind: QualificationMarkerKind,
): number {
  return markers.findIndex((marker) => marker.kind === kind);
}

function freshnessFromDebug(response: DebugRuntimeResponse): QualificationFreshness {
  return response.freshness;
}

function stateFrom(
  response: DebugRuntimeResponse,
  markers: readonly { readonly kind: QualificationMarkerKind }[],
): 'waiting' | 'receiving' | 'stale' | 'ready' {
  if (hasMarker(markers, 'demo-b-live') && response.freshness === 'fresh') return 'ready';
  if (response.freshness === 'stale') return 'stale';
  if (response.freshness === 'fresh') return 'receiving';
  return 'waiting';
}

function resultFor(checks: Record<string, QualificationCheck>): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  const values = Object.values(checks);
  if (values.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (values.some((check) => check.status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

function evaluateChecks(
  response: DebugRuntimeResponse,
  snapshot: ReturnType<QualificationEvidenceStore['getSnapshot']>,
  recorderHealth: RecorderHealth,
): Record<string, QualificationCheck> {
  const markers = snapshot.markers;
  const resetBefore = markers.find(
    (marker) => marker.kind === 'next-execution' && marker.phase === 'before',
  );
  const resetAfter = markers.find(
    (marker) => marker.kind === 'next-execution' && marker.phase === 'after',
  );
  const resetPassed =
    resetBefore !== undefined &&
    resetAfter !== undefined &&
    resetAfter.mapEpoch > resetBefore.mapEpoch &&
    resetAfter.sourceGeneration === resetBefore.sourceGeneration &&
    resetAfter.producerInstanceId === resetBefore.producerInstanceId &&
    resetAfter.reset?.disposition === 'accepted' &&
    resetAfter.reset.previousMapEpoch === resetBefore.mapEpoch &&
    resetAfter.reset.mapEpoch === resetAfter.mapEpoch;

  const hasStoppedSequence =
    markerIndex(markers, 'demo-a-stopped') >= 0 &&
    markerIndex(markers, 'cs2-closed') > markerIndex(markers, 'demo-a-stopped') &&
    markerIndex(markers, 'runtime-stale') > markerIndex(markers, 'cs2-closed');
  const checks: Record<string, QualificationCheck> = {
    productionChain: {
      label: '第一场数据进入生产链路',
      status:
        hasMarker(markers, 'demo-a-live') && response.raw.current !== null
          ? 'PASS'
          : 'INCONCLUSIVE',
      reason:
        hasMarker(markers, 'demo-a-live') && response.raw.current !== null
          ? '已确认 Demo A 且收到 accepted raw frame。'
          : '等待 Demo A marker 与 accepted raw frame。',
    },
    realSilenceToStale: {
      label: '停止输入后进入 stale',
      status: hasStoppedSequence ? 'PASS' : 'INCONCLUSIVE',
      reason: hasStoppedSequence
        ? 'Companion 在未重启的情况下观察到 stale。'
        : '等待 stopdemo、关闭 CS2 与 stale 证据。',
    },
    explicitNextExecution: {
      label: '下一场从显式新执行开始',
      status: resetPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: resetPassed
        ? '显式 reset 已增加 map epoch，并保持 producer/source generation。'
        : '等待一次成功的“开始下一场”控制。',
    },
    demoBRecovery: {
      label: '第二场恢复且无上一场残留',
      status:
        hasMarker(markers, 'cs2-reopened') &&
        hasMarker(markers, 'demo-b-live') &&
        response.freshness === 'fresh' &&
        resetPassed
          ? 'PASS'
          : 'INCONCLUSIVE',
      reason:
        hasMarker(markers, 'cs2-reopened') &&
        hasMarker(markers, 'demo-b-live') &&
        response.freshness === 'fresh' &&
        resetPassed
          ? 'Demo B 已在新 execution 中恢复 fresh。'
          : '等待 CS2 重开、Demo B 数据与 fresh recovery。',
    },
    captureIntegrity: {
      label: 'Capture recorder 可安全导出',
      status:
        snapshot.scenarioWriteFailed ||
        recorderHealth.state === 'failed' ||
        recorderHealth.incomplete
          ? 'FAIL'
          : recorderHealth.state === 'closed' && recorderHealth.frameCount > 0
            ? 'PASS'
            : 'INCONCLUSIVE',
      reason: snapshot.scenarioWriteFailed
        ? 'scenario marker 写入失败。'
        : recorderHealth.state === 'failed' || recorderHealth.incomplete
          ? 'recorder 已报告失败或不完整。'
          : recorderHealth.state === 'closed' && recorderHealth.frameCount > 0
            ? 'recorder 已 finalize 且存在 accepted frame。'
            : '等待 graceful shutdown 完成 recorder finalize。',
    },
  };
  return checks;
}

function tokenMatches(request: FastifyRequest, expected: string): boolean {
  const header = request.headers['x-qualification-token'];
  const authorization = request.headers.authorization;
  const provided =
    typeof header === 'string'
      ? header
      : typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
  if (provided === undefined) return false;
  const actualBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function unauthorized(reply: FastifyReply): void {
  void reply.code(401).send({ error: 'qualification_unauthorized' });
}

function nowRuntimeTime(clock: QualificationClock): RuntimeTime {
  return clock.now();
}

function boundedStatus(
  runId: string,
  response: DebugRuntimeResponse,
  snapshot: ReturnType<QualificationEvidenceStore['getSnapshot']>,
  recorderHealth: RecorderHealth,
  nowMonotonicMs: number,
): Record<string, unknown> {
  const checks = evaluateChecks(response, snapshot, recorderHealth);
  const state = stateFrom(response, snapshot.markers);
  const gsi =
    response.raw.current === null
      ? 'never-seen'
      : response.freshness === 'stale'
        ? 'silent'
        : 'receiving';
  return {
    schemaVersion: 1,
    runId,
    state,
    gsi,
    freshness: response.freshness,
    result: resultFor(checks),
    checks,
    markers: snapshot.markers.map((marker) => marker.kind),
    lastMarker: snapshot.lastMarker?.kind ?? null,
    producerInstanceId: response.producerInstanceId,
    sourceGeneration: response.sourceGeneration,
    mapEpoch: extractMapEpoch(response),
    runtimeSeq: extractRuntimeSeq(response),
    lastAcceptedFrameAgeMs:
      response.raw.current === null
        ? null
        : Math.max(0, Math.round(nowMonotonicMs - response.raw.current.receivedMonotonicMs)),
    recorder: {
      state: recorderHealth.state,
      frameCount: recorderHealth.frameCount,
      droppedFrames: recorderHealth.droppedFrames,
      incomplete: recorderHealth.incomplete,
    },
  };
}

function extractMapEpoch(response: DebugRuntimeResponse): number | null {
  if (!isRecord(response.runtime.current)) return null;
  const map = response.runtime.current.map;
  if (!isRecord(map) || typeof map.epoch !== 'number' || !Number.isSafeInteger(map.epoch))
    return null;
  return map.epoch;
}

function extractRuntimeSeq(response: DebugRuntimeResponse): number | null {
  if (!isRecord(response.runtime.current)) return null;
  return typeof response.runtime.current.runtimeSeq === 'number' &&
    Number.isSafeInteger(response.runtime.current.runtimeSeq)
    ? response.runtime.current.runtimeSeq
    : null;
}

export function registerQualificationRoutes(
  app: FastifyInstance,
  options: QualificationControllerOptions,
): void {
  if (options.controlToken.trim().length === 0) {
    throw new Error('qualification control token must be non-empty');
  }
  const clock = options.clock ?? defaultClock;
  const getDebug = (): DebugRuntimeResponse => options.getDebugResponse(clock.now().monotonicMs);
  const getStatus = async (): Promise<Record<string, unknown>> => {
    const nowMonotonicMs = clock.now().monotonicMs;
    const debug = options.getDebugResponse(nowMonotonicMs);
    const runtime = options.programRuntime.getSnapshot();
    const freshness = freshnessFromDebug(debug);
    await options.evidence.observeFreshness(freshness, runtime);
    return boundedStatus(
      options.runId,
      debug,
      options.evidence.getSnapshot(),
      options.recorder.getHealth(),
      nowMonotonicMs,
    );
  };

  app.get('/qualification', (_request, reply) => {
    void reply.type('text/html; charset=utf-8').send(qualificationPageHtml(options.controlToken));
  });
  app.get('/qualification/', (_request, reply) => {
    void reply.type('text/html; charset=utf-8').send(qualificationPageHtml(options.controlToken));
  });

  app.get('/qualification/status', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    try {
      return await getStatus();
    } catch (error: unknown) {
      return reply
        .code(503)
        .send({ error: 'qualification_status_unavailable', message: String(error) });
    }
  });

  app.post('/qualification/marker', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    const body: unknown = request.body;
    const kind = isRecord(body) ? body.kind : undefined;
    if (!isMarkerKind(kind)) {
      return reply.code(400).send({ error: 'invalid_qualification_marker' });
    }
    try {
      const debug = getDebug();
      const runtime = options.programRuntime.getSnapshot();
      await options.evidence.recordMarker(kind, runtime, freshnessFromDebug(debug));
      return { ok: true, kind, message: markerMessage(kind) };
    } catch (error: unknown) {
      return reply.code(503).send({ error: 'qualification_marker_failed', message: String(error) });
    }
  });

  app.post('/qualification/stop', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    try {
      const debug = getDebug();
      const runtime = options.programRuntime.getSnapshot();
      await options.evidence.recordMarker('demo-a-stopped', runtime, freshnessFromDebug(debug));
      await options.evidence.recordMarker('cs2-closed', runtime, freshnessFromDebug(debug));
      return { ok: true, kind: 'stop', message: '第一场已停止，等待页面确认数据停止' };
    } catch (error: unknown) {
      return reply
        .code(503)
        .send({ error: 'qualification_stop_marker_failed', message: String(error) });
    }
  });

  app.post('/qualification/next-map-execution', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    const debugBefore = getDebug();
    const before = options.programRuntime.getSnapshot();
    const beforeEpoch = before.current.map.epoch;
    const at = nowRuntimeTime(clock);
    await options.evidence.recordMarker('next-execution', before, freshnessFromDebug(debugBefore), {
      phase: 'before',
    });
    const result = options.programRuntime.resetMapExecution(RESET_REASON, at);
    if (result.disposition.kind === 'accepted') options.onAcceptedMapReset?.();
    const after = options.programRuntime.getSnapshot();
    const reset: QualificationResetEvidence = {
      disposition: result.disposition.kind,
      reason: 'map-execution-reset',
      resetReason: RESET_REASON,
      previousMapEpoch: beforeEpoch,
      mapEpoch: after.current.map.epoch,
    };
    await options.evidence.recordMarker('next-execution', after, freshnessFromDebug(getDebug()), {
      phase: 'after',
      reset,
    });
    const body = {
      ok: result.disposition.kind === 'accepted',
      reason: RESET_REASON,
      timestamp: at,
      producerInstanceId: after.producerInstanceId,
      sourceGeneration: after.sourceGeneration,
      previousMapEpoch: beforeEpoch,
      mapEpoch: after.current.map.epoch,
      runtimeSeq: after.current.runtimeSeq,
      disposition: result.disposition,
    };
    return reply.code(result.disposition.kind === 'accepted' ? 200 : 409).send(body);
  });

  app.post('/qualification/finish', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    const status = await getStatus();
    setImmediate(() => {
      try {
        void options.onFinish?.();
      } catch {
        // Shutdown is independently guarded by the process-level watchdog.
      }
    });
    return reply.code(202).send({
      status: 'stopping',
      result: status.result,
      message: 'qualification evidence is being finalized',
    });
  });
}

function markerMessage(kind: QualificationMarkerKind): string {
  switch (kind) {
    case 'demo-a-live':
      return '第一场数据已记录';
    case 'demo-a-stopped':
      return '第一场停止已记录';
    case 'cs2-closed':
      return 'CS2 关闭已记录';
    case 'runtime-stale':
      return '数据停止已记录';
    case 'next-execution':
      return '下一场执行已记录';
    case 'cs2-reopened':
      return 'CS2 重开已记录';
    case 'demo-b-live':
      return '第二场数据已记录';
  }
}
