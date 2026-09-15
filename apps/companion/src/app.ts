import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import Fastify, { type FastifyInstance } from 'fastify';

import { DebugEvidenceStore, type DebugRuntimeClock } from './runtime/debug-state.js';
import type { LatestWinsConsumerHealth } from './runtime/latest-wins.js';
import { createProgramRuntime, type ProgramRuntime } from './runtime/program-runtime.js';
import {
  registerQualificationRoutes,
  type QualificationControllerOptions,
} from './qualification/controller.js';
import {
  createQualificationEvidenceStore,
  type QualificationClock,
  type QualificationEvidenceStore,
} from './qualification/evidence.js';
import { createDisabledRecorder, type CaptureRecorder } from './telemetry/capture-recorder.js';
import {
  GSI_REQUEST_TIMEOUT_MS,
  registerGsiIngress,
  type AcceptedRawSink,
  type CompanionRuntimeDiagnosticCode,
  type GsiClock,
  type GsiDiagnosticsSink,
  type GsiSequenceSource,
  type ObservationSink,
} from './telemetry/gsi-ingress.js';

export interface CompanionAppOptions {
  readonly logger?: boolean;
  readonly gsiToken?: string;
  readonly recorder?: CaptureRecorder;
  readonly producerInstanceId?: string;
  readonly gsiSequenceSource?: GsiSequenceSource;
  readonly programRuntime?: ProgramRuntime;
  readonly debugEvidenceStore?: DebugEvidenceStore;
  readonly debugClock?: DebugRuntimeClock;
  readonly deliveryConsumers?: readonly DeliveryHealthSource[];
  readonly onAcceptedRaw?: AcceptedRawSink;
  readonly onObservation?: ObservationSink;
  readonly onGsiDiagnostics?: GsiDiagnosticsSink;
  readonly clock?: GsiClock;
  readonly qualificationMode?: boolean;
  readonly qualificationControlToken?: string;
  readonly qualificationRunId?: string;
  readonly qualificationScenarioPath?: string;
  readonly qualificationClock?: QualificationClock;
  readonly qualificationEvidenceStore?: QualificationEvidenceStore;
  readonly onQualificationFinish?: () => void | Promise<void>;
}

export interface DeliveryHealthSource {
  getHealth(): LatestWinsConsumerHealth;
  close(): Promise<void>;
}

export function buildApp(options: CompanionAppOptions = {}): FastifyInstance {
  const recorder = options.recorder ?? createDisabledRecorder('recorder_not_configured');
  const programRuntime =
    options.programRuntime ?? createProgramRuntime(options.producerInstanceId ?? randomUUID());
  const debugEvidenceStore =
    options.debugEvidenceStore ?? new DebugEvidenceStore(programRuntime.getSnapshot());
  debugEvidenceStore.recordRuntime(programRuntime.getSnapshot());
  const debugClock = options.debugClock ?? { nowMonotonicMs: () => performance.now() };
  const deliveryConsumers = options.deliveryConsumers ?? [];
  const qualificationMode = options.qualificationMode ?? false;
  let runtimeDegraded = false;
  const emittedRuntimeDiagnostics = new Set<CompanionRuntimeDiagnosticCode>();

  const app = Fastify({
    logger: options.logger ?? false,
    requestTimeout: GSI_REQUEST_TIMEOUT_MS,
  });

  app.get('/health', () => {
    const recorderHealth = recorder.getHealth();
    const recorderDegraded =
      recorderHealth.state === 'degraded' || recorderHealth.state === 'failed';
    return {
      status: runtimeDegraded || recorderDegraded ? 'degraded' : 'ok',
      recorder: recorderHealth,
    };
  });

  app.get('/debug/runtime', () =>
    debugEvidenceStore.getResponse({
      nowMonotonicMs: debugClock.nowMonotonicMs(),
      recorderHealth: recorder.getHealth(),
      deliveryHealth: deliveryConsumers.map((consumer) => consumer.getHealth()),
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
        programRuntime.acceptObservation(observation);
        debugEvidenceStore.recordNormalizedObservation(observation);
        debugEvidenceStore.recordRuntime(programRuntime.getSnapshot());
        options.onObservation?.(observation);
      },
      onGsiDiagnostics: (diagnostics) => {
        debugEvidenceStore.recordGsiDiagnostics(diagnostics);
        options.onGsiDiagnostics?.(diagnostics);
      },
      onRuntimeDiagnostic: (code) => {
        runtimeDegraded = true;
        debugEvidenceStore.recordRuntimeDiagnostic(code);
        if (emittedRuntimeDiagnostics.has(code)) return;
        emittedRuntimeDiagnostics.add(code);
        app.log.warn({ code }, 'Companion telemetry path degraded');
      },
    });
  }

  if (qualificationMode) {
    const controlToken = options.qualificationControlToken;
    if (controlToken === undefined || controlToken.trim().length === 0) {
      throw new Error('qualificationControlToken must be set when qualificationMode is enabled');
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
        }),
      programRuntime,
      recorder,
      onAcceptedMapReset: () => {
        debugEvidenceStore.clearCurrentTelemetry();
        debugEvidenceStore.recordRuntime(programRuntime.getSnapshot());
      },
      ...(options.onQualificationFinish === undefined
        ? {}
        : { onFinish: options.onQualificationFinish }),
    };
    registerQualificationRoutes(app, qualificationOptions);
  }

  app.addHook('onClose', async () => {
    await Promise.all(deliveryConsumers.map((consumer) => consumer.close()));
    await recorder.finalize();
  });

  return app;
}
