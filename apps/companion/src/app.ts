import Fastify, { type FastifyInstance } from 'fastify';

import { createDisabledRecorder, type CaptureRecorder } from './telemetry/capture-recorder.js';
import {
  GSI_REQUEST_TIMEOUT_MS,
  registerGsiIngress,
  type CompanionRuntimeDiagnosticCode,
  type GsiClock,
  type GsiDiagnosticsSink,
  type ObservationSink,
} from './telemetry/gsi-ingress.js';

export interface CompanionAppOptions {
  readonly logger?: boolean;
  readonly gsiToken?: string;
  readonly recorder?: CaptureRecorder;
  readonly onObservation?: ObservationSink;
  readonly onGsiDiagnostics?: GsiDiagnosticsSink;
  readonly clock?: GsiClock;
}

export function buildApp(options: CompanionAppOptions = {}): FastifyInstance {
  const recorder = options.recorder ?? createDisabledRecorder('recorder_not_configured');
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

  if (options.gsiToken !== undefined) {
    registerGsiIngress(app, {
      gsiToken: options.gsiToken,
      recorder,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.onObservation === undefined ? {} : { onObservation: options.onObservation }),
      ...(options.onGsiDiagnostics === undefined
        ? {}
        : { onGsiDiagnostics: options.onGsiDiagnostics }),
      onRuntimeDiagnostic: (code) => {
        runtimeDegraded = true;
        if (emittedRuntimeDiagnostics.has(code)) return;
        emittedRuntimeDiagnostics.add(code);
        app.log.warn({ code }, 'Companion telemetry path degraded');
      },
    });
  }

  app.addHook('onClose', async () => {
    await recorder.finalize();
  });

  return app;
}
