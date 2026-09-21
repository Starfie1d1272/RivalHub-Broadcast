import { timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MapExecutionResetReason, RuntimeTime } from '@rivalhub-broadcast/core/runtime';

import type { DebugRuntimeResponse } from '../runtime/debug-state.js';
import type { ProgramRuntime, ProgramRuntimeSnapshot } from '../runtime/program-runtime.js';
import {
  resolveCaptureRecorder,
  type CaptureRecorderSource,
  type RecorderHealth,
} from '../telemetry/capture-recorder.js';
import {
  QUALIFICATION_CHECK_KEYS,
  QUALIFICATION_LIVE_MARKER_KINDS,
  QUALIFICATION_MARKER_KINDS,
  QUALIFICATION_OBJECTIVE_SCENARIO_MARKER_KINDS,
  QUALIFICATION_RESET_KIND,
  QUALIFICATION_RESET_REASON,
  QUALIFICATION_SCHEMA_VERSION,
  type QualificationClock,
  type QualificationEvidenceStore,
  type QualificationFreshness,
  type QualificationMarker,
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
  readonly recorder: CaptureRecorderSource;
  readonly rotateRecorder?: () => Promise<{
    readonly previousCaptureId: string;
    readonly captureId: string;
  }>;
  readonly onAcceptedMapReset?: () => void;
  readonly onFinish?: (input: QualificationFinishInput) => void | Promise<void>;
}

export interface QualificationFinishInput {
  readonly debug: DebugRuntimeResponse;
  readonly runtime: ProgramRuntimeSnapshot;
  readonly recorderHealth: RecorderHealth;
}

interface QualificationCheck {
  readonly label: string;
  readonly status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly reason: string;
}

const RESET_REASON = QUALIFICATION_RESET_REASON satisfies MapExecutionResetReason;

const defaultClock: QualificationClock = {
  now: () => ({ monotonicMs: performance.now(), utc: new Date().toISOString() }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMarkerKind(value: unknown): value is QualificationMarkerKind {
  return typeof value === 'string' && QUALIFICATION_MARKER_KINDS.some((kind) => kind === value);
}

function isObjectiveScenarioMarkerKind(value: QualificationMarkerKind): boolean {
  return QUALIFICATION_OBJECTIVE_SCENARIO_MARKER_KINDS.some((kind) => kind === value);
}

function hasMarker(
  markers: readonly { readonly kind: QualificationMarkerKind }[],
  kind: QualificationMarkerKind,
): boolean {
  return markers.some((marker) => marker.kind === kind);
}

function realSilenceToStalePassed(
  markers: readonly QualificationMarker[],
  resetBefore: QualificationMarker | undefined,
): boolean {
  const demoALive = markers.find((marker) => marker.kind === 'demo-a-live');
  const runtimeStale = markers.find((marker) => marker.kind === 'runtime-stale');
  const cs2Closed = markers.find((marker) => marker.kind === 'cs2-closed');
  if (demoALive === undefined || runtimeStale === undefined || cs2Closed === undefined)
    return false;
  if (
    runtimeStale.freshness !== 'stale' ||
    runtimeStale.monotonicMs <= demoALive.monotonicMs ||
    cs2Closed.monotonicMs <= demoALive.monotonicMs
  )
    return false;
  if (resetBefore === undefined) return true;
  return (
    runtimeStale.monotonicMs < resetBefore.monotonicMs &&
    cs2Closed.monotonicMs < resetBefore.monotonicMs
  );
}

function observationIsConsistent(marker: QualificationMarker | undefined): boolean {
  if (marker === undefined || marker.observation === null || marker.freshness !== 'fresh')
    return false;
  const observation = marker.observation;
  return (
    observation.sequence >= 0 &&
    observation.receivedMonotonicMs <= marker.monotonicMs &&
    observation.producerInstanceId === marker.producerInstanceId &&
    observation.sourceGeneration === marker.sourceGeneration &&
    observation.mapEpoch === marker.mapEpoch &&
    observation.runtimeSeq === marker.runtimeSeq &&
    observation.freshness === marker.freshness
  );
}

function observedMapBoundaryPassed(
  marker: QualificationMarker | undefined,
  resetAfter: QualificationMarker | undefined,
  recentTransitions: readonly unknown[],
): boolean {
  if (marker === undefined || resetAfter === undefined || marker.observation === null) return false;
  const observation = marker.observation;
  return recentTransitions.some((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.kind !== 'map_execution_changed' ||
      candidate.reason !== 'observed-map-name-change' ||
      !isRecord(candidate.at)
    )
      return false;
    const previousMapEpoch = candidate.previousMapEpoch;
    const mapEpoch = candidate.mapEpoch;
    const sourceGeneration = candidate.sourceGeneration;
    const receiveSequence = candidate.receiveSequence;
    const runtimeSeq = candidate.runtimeSeq;
    const atMonotonicMs = candidate.at.monotonicMs;
    const previousMapName = candidate.previousMapName;
    const mapName = candidate.mapName;
    if (
      typeof previousMapEpoch !== 'number' ||
      typeof mapEpoch !== 'number' ||
      typeof receiveSequence !== 'number' ||
      typeof runtimeSeq !== 'number'
    )
      return false;
    return (
      isSafeNonNegativeInteger(previousMapEpoch) &&
      isSafeNonNegativeInteger(mapEpoch) &&
      mapEpoch > previousMapEpoch &&
      previousMapEpoch === resetAfter.mapEpoch &&
      mapEpoch === marker.mapEpoch &&
      candidate.producerInstanceId === marker.producerInstanceId &&
      sourceGeneration === marker.sourceGeneration &&
      isSafeNonNegativeInteger(receiveSequence) &&
      receiveSequence < observation.sequence &&
      isSafeNonNegativeInteger(runtimeSeq) &&
      runtimeSeq < marker.runtimeSeq &&
      typeof atMonotonicMs === 'number' &&
      Number.isFinite(atMonotonicMs) &&
      atMonotonicMs > resetAfter.monotonicMs &&
      atMonotonicMs < observation.receivedMonotonicMs &&
      typeof previousMapName === 'string' &&
      typeof mapName === 'string' &&
      previousMapName.trim().length > 0 &&
      mapName.trim().length > 0 &&
      previousMapName.trim() !== mapName.trim()
    );
  });
}

function liveMarkerIsInExecution(
  marker: QualificationMarker | undefined,
  resetBefore: QualificationMarker | undefined,
  resetAfter: QualificationMarker | undefined,
  recentTransitions: readonly unknown[],
  execution: 'first' | 'second',
): boolean {
  if (!observationIsConsistent(marker)) return false;
  if (marker === undefined) return false;
  const observation = marker.observation;
  if (observation === null) return false;
  if (execution === 'first') {
    return (
      marker.mapEpoch > 0 &&
      (resetBefore === undefined ||
        (marker.monotonicMs < resetBefore.monotonicMs &&
          observation.receivedMonotonicMs < resetBefore.monotonicMs))
    );
  }
  return (
    resetAfter !== undefined &&
    marker.monotonicMs > resetAfter.monotonicMs &&
    observation.receivedMonotonicMs > resetAfter.monotonicMs &&
    (marker.mapEpoch === resetAfter.mapEpoch ||
      observedMapBoundaryPassed(marker, resetAfter, recentTransitions))
  );
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
  const demoALive = markers.find((marker) => marker.kind === 'demo-a-live');
  const demoBLive = markers.find((marker) => marker.kind === 'demo-b-live');
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
    resetAfter.reset.mapEpoch === resetAfter.mapEpoch &&
    resetAfter.reset.programTelemetryCleared === true;

  const productionChainPassed = liveMarkerIsInExecution(
    demoALive,
    resetBefore,
    resetAfter,
    response.recentTransitions,
    'first',
  );
  const demoBRecoveryPassed =
    liveMarkerIsInExecution(
      demoBLive,
      resetBefore,
      resetAfter,
      response.recentTransitions,
      'second',
    ) &&
    response.raw.current !== null &&
    response.freshness === 'fresh';

  const silenceToStalePassed = realSilenceToStalePassed(markers, resetBefore);
  const checks: Record<string, QualificationCheck> = {
    productionChain: {
      label: '第一场数据进入制播数据链路',
      status: productionChainPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: productionChainPassed
        ? '第一场场景标记已绑定第一场地图执行内的已接收正常观测。'
        : '等待第一场地图执行内与采集记录对应的已接收正常观测。',
    },
    realSilenceToStale: {
      label: '停止输入后进入数据已过期状态',
      status: silenceToStalePassed ? 'PASS' : 'INCONCLUSIVE',
      reason: silenceToStalePassed
        ? '本地制播服务未重启即观察到数据已过期，并在下一场显式重置前记录了 CS2 退出。'
        : '等待第一场数据后运行状态进入数据已过期，并在下一场显式重置前确认 CS2 退出。',
    },
    explicitNextExecution: {
      label: '下一场从显式新地图执行开始',
      status: resetPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: resetPassed
        ? '显式重置已推进地图执行编号，并清理上一场正式节目数据。'
        : '等待一次成功的“开始下一场”控制。',
    },
    demoBRecovery: {
      label: '第二场恢复且无上一场残留',
      status:
        hasMarker(markers, 'cs2-reopened') && resetPassed && demoBRecoveryPassed
          ? 'PASS'
          : 'INCONCLUSIVE',
      reason:
        hasMarker(markers, 'cs2-reopened') && resetPassed && demoBRecoveryPassed
          ? '第二场场景标记已绑定显式重置后新地图执行中的已接收正常观测。'
          : '等待 CS2 重开、显式重置后的正常第二场观测与状态恢复。',
    },
    captureIntegrity: {
      label: '采集记录可安全导出',
      status:
        snapshot.scenarioWriteFailed ||
        recorderHealth.state === 'failed' ||
        recorderHealth.incomplete
          ? 'FAIL'
          : recorderHealth.state === 'closed' && recorderHealth.frameCount > 0
            ? 'PASS'
            : 'INCONCLUSIVE',
      reason: snapshot.scenarioWriteFailed
        ? '场景标记写入失败。'
        : recorderHealth.state === 'failed' || recorderHealth.incomplete
          ? '采集记录已报告失败或不完整。'
          : recorderHealth.state === 'closed' && recorderHealth.frameCount > 0
            ? '采集记录已完成整理，且存在已接收的数据帧。'
            : '等待服务正常结束并完成采集记录整理。',
    },
  };
  const checkKeys = Object.keys(checks);
  if (
    checkKeys.length !== QUALIFICATION_CHECK_KEYS.length ||
    QUALIFICATION_CHECK_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(checks, key))
  ) {
    throw new Error('现场验收检查与证据契约不一致');
  }
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
    schemaVersion: QUALIFICATION_SCHEMA_VERSION,
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
    throw new Error('现场验收控制令牌不能为空。');
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
      resolveCaptureRecorder(options.recorder).getHealth(),
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
    if (kind === 'runtime-stale' || kind === 'next-execution') {
      return reply.code(409).send({
        error: 'qualification_marker_automatic',
        message: '数据过期状态由系统自动记录；下一场执行请使用“开始下一场”控制。',
      });
    }
    try {
      const debug = getDebug();
      const runtime = options.programRuntime.getSnapshot();
      if (
        QUALIFICATION_LIVE_MARKER_KINDS.includes(kind) &&
        (debug.freshness !== 'fresh' || runtime.current.programSource.lastAccepted === undefined)
      ) {
        return reply.code(409).send({
          error: 'qualification_observation_required',
          message: '请先等待页面显示正在接收比赛数据，再记录这一场。',
        });
      }
      if (isObjectiveScenarioMarkerKind(kind)) {
        const phase = isRecord(body) ? body.phase : undefined;
        if (phase !== 'before' && phase !== 'after') {
          return reply.code(400).send({
            error: 'invalid_objective_scenario_phase',
            message: '目标时钟场景标记必须指定“开始”或“结束”。',
          });
        }
        const recorder = resolveCaptureRecorder(options.recorder);
        const captureId = recorder.captureId;
        const at = clock.now();
        const captureElapsedUs = recorder.captureElapsedUsAt?.(at.monotonicMs);
        if (captureId === undefined || captureElapsedUs === undefined) {
          return reply.code(409).send({
            error: 'objective_scenario_capture_unavailable',
            message: '当前无法为场景标记绑定采集记录时间。',
          });
        }
        if (
          kind === 'objective-reconnect-restart' &&
          phase === 'after' &&
          (freshnessFromDebug(debug) !== 'fresh' ||
            runtime.current.programSource.lastAccepted === undefined ||
            recorder.getHealth().frameCount < 1)
        ) {
          return reply.code(409).send({
            error: 'objective_recovery_observation_required',
            message: '重连或接收端重启后的结束标记必须绑定新的正常观测。',
          });
        }
        await options.evidence.recordMarker(kind, runtime, freshnessFromDebug(debug), {
          phase,
          captureId,
          captureElapsedUs,
        });
      } else {
        await options.evidence.recordMarker(kind, runtime, freshnessFromDebug(debug));
      }
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
      await options.evidence.recordMarker('cs2-closed', runtime, freshnessFromDebug(debug));
      return {
        ok: true,
        kind: 'cs2-closed',
        message: '已确认 CS2 退出，等待页面确认数据进入过期状态',
      };
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
      reason: QUALIFICATION_RESET_KIND,
      resetReason: RESET_REASON,
      previousMapEpoch: beforeEpoch,
      mapEpoch: after.current.map.epoch,
      programTelemetryCleared: after.current.programTelemetry === undefined,
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
      programTelemetryCleared: reset.programTelemetryCleared,
      disposition: result.disposition,
    };
    return reply.code(result.disposition.kind === 'accepted' ? 200 : 409).send(body);
  });

  app.post('/qualification/recorder/rotate', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    if (options.rotateRecorder === undefined) {
      return reply.code(409).send({
        error: 'qualification_recorder_rotation_unavailable',
        message: '当前现场验收服务不支持在同一轮验收中切换采集记录。',
      });
    }
    try {
      const result = await options.rotateRecorder();
      return {
        ok: true,
        ...result,
        message: '已在同一轮现场验收中开始新的采集记录。',
      };
    } catch (error: unknown) {
      return reply.code(503).send({
        error: 'qualification_recorder_rotation_failed',
        message: String(error),
      });
    }
  });

  app.post('/qualification/finish', async (request, reply) => {
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }
    const status = await getStatus();
    const finishDebug = getDebug();
    const finishRuntime = options.programRuntime.getSnapshot();
    const finishInput: QualificationFinishInput = {
      debug: finishDebug,
      runtime: finishRuntime,
      recorderHealth: resolveCaptureRecorder(options.recorder).getHealth(),
    };
    setImmediate(() => {
      void Promise.resolve(options.onFinish?.(finishInput)).catch(() => {
        // Shutdown is independently guarded by the process-level watchdog.
      });
    });
    return reply.code(202).send({
      status: 'stopping',
      result: status.result,
      runId: options.runId,
      finalizationPath: '/qualification/finalization',
      message: '正在整理现场验收证据',
    });
  });
}

function markerMessage(kind: QualificationMarkerKind): string {
  switch (kind) {
    case 'demo-a-live':
      return '第一场数据已记录';
    case 'cs2-closed':
      return 'CS2 退出已记录';
    case 'runtime-stale':
      return '数据过期状态已记录';
    case 'next-execution':
      return '下一场执行已记录';
    case 'cs2-reopened':
      return 'CS2 重开已记录';
    case 'demo-b-live':
      return '第二场数据已记录';
  }
  return '操作已记录';
}
