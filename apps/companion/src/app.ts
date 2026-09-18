import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import Fastify, { type FastifyInstance } from 'fastify';

import { DebugEvidenceStore, type DebugRuntimeClock } from './runtime/debug-state.js';
import type { LatestWinsConsumerHealth } from './runtime/latest-wins.js';
import { createProgramRuntime, type ProgramRuntime } from './runtime/program-runtime.js';
import type { SeriesProgressCheckpointStore } from '@rivalhub-broadcast/core/series-progress';
import {
  createProjectionCoordinator,
  type ProjectionCoordinator,
} from './projections/projection-coordinator.js';
import {
  createProgramCueCoordinator,
  type ProgramCueCoordinator,
} from './projections/program-cue-coordinator.js';
import type { MatchContextBinding } from './match-context/index.js';
import {
  registerQualificationRoutes,
  type QualificationControllerOptions,
  type QualificationFinishInput,
} from './qualification/controller.js';
import {
  createQualificationEvidenceStore,
  type QualificationClock,
  type QualificationEvidenceStore,
} from './qualification/evidence.js';
import { createDisabledRecorder, type CaptureRecorder } from './telemetry/capture-recorder.js';
import {
  createCstvSourceManagers,
  type CstvSourceManagers,
} from './telemetry/cstv-source-manager.js';
import {
  GSI_REQUEST_TIMEOUT_MS,
  registerGsiIngress,
  type AcceptedRawSink,
  type GsiClock,
  type GsiDiagnosticsSink,
  type GsiSequenceSource,
  type ObservationSink,
} from './telemetry/gsi-ingress.js';
import { registerStaticHost } from './local-web/static-host.js';
import { registerOperatorCommandRoutes } from './operator/controller.js';
import {
  createLocalWebSocketTransport,
  registerLocalWebSocketTransport,
  type LocalWebSocketDiagnostic,
} from './local-web/websocket-transport.js';

export interface CompanionAppOptions {
  readonly logger?: boolean;
  readonly gsiToken?: string;
  readonly recorder?: CaptureRecorder;
  readonly producerInstanceId?: string;
  readonly gsiSequenceSource?: GsiSequenceSource;
  readonly programRuntime?: ProgramRuntime;
  readonly seriesProgressCheckpointStore?: SeriesProgressCheckpointStore;
  readonly onSeriesProgressDiagnostic?: (diagnostic: { readonly code: string }) => void;
  readonly projectionCoordinator?: ProjectionCoordinator;
  readonly programCueCoordinator?: ProgramCueCoordinator;
  readonly matchContextBinding?: MatchContextBinding;
  readonly projectionNowMonotonicMs?: () => number;
  readonly debugEvidenceStore?: DebugEvidenceStore;
  readonly debugClock?: DebugRuntimeClock;
  readonly deliveryConsumers?: readonly DeliveryHealthSource[];
  readonly cstvSources?: CstvSourceManagers;
  readonly onAcceptedRaw?: AcceptedRawSink;
  readonly onObservation?: ObservationSink;
  readonly onGsiDiagnostics?: GsiDiagnosticsSink;
  readonly clock?: GsiClock;
  readonly qualificationMode?: boolean;
  readonly qualificationControlToken?: string;
  readonly operatorControlToken?: string;
  readonly qualificationRunId?: string;
  readonly qualificationScenarioPath?: string;
  readonly qualificationClock?: QualificationClock;
  readonly qualificationEvidenceStore?: QualificationEvidenceStore;
  readonly onQualificationFinish?: (input: QualificationFinishInput) => void | Promise<void>;
  readonly webRoot?: string;
  readonly host?: string;
  readonly localWebLanMode?: boolean;
  readonly localWebAllowedOrigins?: readonly string[];
}

export interface DeliveryHealthSource {
  getHealth(): LatestWinsConsumerHealth;
  close(): Promise<void>;
}

function projectionDiagnosticDegradesRuntime(code: string): boolean {
  return code.endsWith('-schema-validation-failed') || code.endsWith('-wire-validation-failed');
}

export function buildApp(options: CompanionAppOptions = {}): FastifyInstance {
  const recorder = options.recorder ?? createDisabledRecorder('recorder_not_configured');
  const programRuntime =
    options.programRuntime ??
    createProgramRuntime(options.producerInstanceId ?? randomUUID(), {
      ...(options.seriesProgressCheckpointStore === undefined
        ? {}
        : { seriesProgressCheckpointStore: options.seriesProgressCheckpointStore }),
      ...(options.onSeriesProgressDiagnostic === undefined
        ? {}
        : { onSeriesProgressDiagnostic: options.onSeriesProgressDiagnostic }),
    });
  const debugEvidenceStore =
    options.debugEvidenceStore ?? new DebugEvidenceStore(programRuntime.getSnapshot());
  debugEvidenceStore.recordRuntime(programRuntime.getSnapshot());
  const debugClock = options.debugClock ?? { nowMonotonicMs: () => performance.now() };
  const deliveryConsumers = options.deliveryConsumers ?? [];
  const cstvSources = options.cstvSources ?? createCstvSourceManagers({});
  const projectionNowMonotonicMs =
    options.projectionNowMonotonicMs ??
    (() => {
      const lastReceived =
        programRuntime.getSnapshot().current.programSource.lastAccepted?.receivedMonotonicMs ?? 0;
      return Math.max(performance.now(), lastReceived);
    });
  const app = Fastify({
    logger: options.logger ?? false,
    requestTimeout: GSI_REQUEST_TIMEOUT_MS,
  });
  registerStaticHost(app, options.webRoot === undefined ? {} : { webRoot: options.webRoot });
  let runtimeDegraded = false;
  const emittedRuntimeDiagnostics = new Set<string>();
  const recordRuntimeDiagnostic = (
    code: string,
    source: 'projection' | 'telemetry',
    degradeRuntime = true,
  ): void => {
    if (degradeRuntime) runtimeDegraded = true;
    debugEvidenceStore.recordRuntimeDiagnostic(code);
    if (emittedRuntimeDiagnostics.has(code)) return;
    emittedRuntimeDiagnostics.add(code);
    app.log.warn(
      { code },
      degradeRuntime ? `Companion ${source} 路径已降级` : `Companion ${source} 路径记录可恢复诊断`,
    );
  };
  const projectionCoordinator =
    options.projectionCoordinator ??
    createProjectionCoordinator({
      programRuntime,
      cstvSources,
      ...(options.matchContextBinding === undefined
        ? {}
        : { matchContextBinding: options.matchContextBinding }),
      ...(projectionNowMonotonicMs === undefined
        ? {}
        : { nowMonotonicMs: projectionNowMonotonicMs }),
      onDiagnostic: ({ code }) =>
        recordRuntimeDiagnostic(code, 'projection', projectionDiagnosticDegradesRuntime(code)),
    });
  const programCueCoordinator =
    options.programCueCoordinator ??
    createProgramCueCoordinator({
      programSource: cstvSources.program,
      programRuntime,
      nowMonotonicMs: projectionNowMonotonicMs,
      onDiagnostic: ({ code }) => recordRuntimeDiagnostic(code, 'projection', false),
    });
  const localWebTransport = createLocalWebSocketTransport({
    getPublisher: (channel) =>
      channel === 'program-cue'
        ? programCueCoordinator.getPublisher()
        : projectionCoordinator.getPublisher(channel),
    originPolicyOptions: {
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.localWebLanMode === undefined ? {} : { lanMode: options.localWebLanMode }),
      ...(options.localWebAllowedOrigins === undefined
        ? {}
        : { allowedOrigins: options.localWebAllowedOrigins }),
    },
    logger: app.log,
    onDiagnostic: (diagnostic: LocalWebSocketDiagnostic) => {
      if (diagnostic.code === 'ws_closed' || diagnostic.code === 'ws_connected') return;
      app.log.debug(
        {
          code: diagnostic.code,
          ...(diagnostic.channel === undefined ? {} : { channel: diagnostic.channel }),
          ...(diagnostic.connectionId === undefined
            ? {}
            : { connectionId: diagnostic.connectionId }),
        },
        'Companion local WebSocket diagnostic',
      );
    },
  });
  registerLocalWebSocketTransport(app, localWebTransport);
  const qualificationMode = options.qualificationMode ?? false;

  app.get('/health', () => {
    const recorderHealth = recorder.getHealth();
    const recorderDegraded =
      recorderHealth.state === 'degraded' || recorderHealth.state === 'failed';
    const cstvHealth = {
      program: cstvSources.program.getHealth(),
      lookahead: cstvSources.lookahead.getHealth(),
    };
    const cstvDegraded = [cstvHealth.program, cstvHealth.lookahead].some(
      (health) => health.state === 'reconnecting' || health.state === 'failed',
    );
    return {
      status: runtimeDegraded || recorderDegraded || cstvDegraded ? 'degraded' : 'ok',
      recorder: recorderHealth,
      cstv: cstvHealth,
    };
  });

  app.get('/debug/runtime', () =>
    debugEvidenceStore.getResponse({
      nowMonotonicMs: debugClock.nowMonotonicMs(),
      recorderHealth: recorder.getHealth(),
      deliveryHealth: deliveryConsumers.map((consumer) => consumer.getHealth()),
      cstvSources: {
        program: cstvSources.program.getSnapshot(),
        lookahead: cstvSources.lookahead.getSnapshot(),
      },
    }),
  );

  if (options.gsiToken !== undefined) {
    registerGsiIngress(app, {
      gsiToken: options.gsiToken,
      recorder,
      ...(options.gsiSequenceSource === undefined
        ? {}
        : { sequenceSource: options.gsiSequenceSource }),
      onAcceptedRaw: (input) => {
        debugEvidenceStore.recordAcceptedRaw(input);
        options.onAcceptedRaw?.(input);
      },
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      onObservation: (observation) => {
        const result = programRuntime.acceptObservation(observation);
        projectionCoordinator.afterRuntimeMutation(result);
        programCueCoordinator.afterRuntimeMutation(result);
        debugEvidenceStore.recordNormalizedObservation(observation);
        debugEvidenceStore.recordRuntime(programRuntime.getSnapshot());
        options.onObservation?.(observation);
      },
      onGsiDiagnostics: (diagnostics) => {
        debugEvidenceStore.recordGsiDiagnostics(diagnostics);
        options.onGsiDiagnostics?.(diagnostics);
      },
      onRuntimeDiagnostic: (code) => {
        recordRuntimeDiagnostic(code, 'telemetry');
      },
    });
  }

  if (qualificationMode) {
    const controlToken = options.qualificationControlToken;
    if (controlToken === undefined || controlToken.trim().length === 0) {
      throw new Error('启用 qualificationMode 时必须设置 qualificationControlToken');
    }
    const runId = options.qualificationRunId ?? 'local-qualification';
    const evidence =
      options.qualificationEvidenceStore ??
      createQualificationEvidenceStore({
        runId,
        ...(options.qualificationScenarioPath === undefined
          ? {}
          : { scenarioPath: options.qualificationScenarioPath }),
        clock: options.qualificationClock ?? {
          now: () => ({ monotonicMs: performance.now(), utc: new Date().toISOString() }),
        },
      });
    const qualificationOptions: QualificationControllerOptions = {
      controlToken,
      runId,
      evidence,
      ...(options.qualificationClock === undefined ? {} : { clock: options.qualificationClock }),
      getDebugResponse: (nowMonotonicMs) =>
        debugEvidenceStore.getResponse({
          nowMonotonicMs,
          recorderHealth: recorder.getHealth(),
          deliveryHealth: deliveryConsumers.map((consumer) => consumer.getHealth()),
          cstvSources: {
            program: cstvSources.program.getSnapshot(),
            lookahead: cstvSources.lookahead.getSnapshot(),
          },
        }),
      programRuntime,
      recorder,
      onAcceptedMapReset: () => {
        debugEvidenceStore.clearCurrentTelemetry();
        debugEvidenceStore.recordRuntime(programRuntime.getSnapshot());
        projectionCoordinator.afterRuntimeMutation();
        programCueCoordinator.afterRuntimeMutation();
      },
      ...(options.onQualificationFinish === undefined
        ? {}
        : { onFinish: options.onQualificationFinish }),
    };
    registerQualificationRoutes(app, qualificationOptions);
  }

  if (options.operatorControlToken !== undefined) {
    if (options.operatorControlToken.trim().length === 0) {
      throw new Error('设置 operatorControlToken 时必须为非空值');
    }
    registerOperatorCommandRoutes(app, {
      controlToken: options.operatorControlToken,
      originPolicy: localWebTransport.getOriginPolicy(),
      execute: (command) => projectionCoordinator.executeOperatorCommand(command),
    });
  }

  app.addHook('onClose', async () => {
    await Promise.all([
      cstvSources.program.stop(),
      cstvSources.lookahead.stop(),
      ...deliveryConsumers.map((consumer) => consumer.close()),
    ]);
    await Promise.all([projectionCoordinator.close(), programCueCoordinator.close()]);
    await programRuntime.close();
    await localWebTransport.close();
    await recorder.finalize();
  });

  return app;
}
