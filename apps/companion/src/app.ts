import Fastify, { type FastifyInstance } from 'fastify';

import { createDisabledRecorder, type CaptureRecorder } from './telemetry/capture-recorder.js';
import {
  GSI_REQUEST_TIMEOUT_MS,
  registerGsiIngress,
  type GsiClock,
  type TelemetrySink,
} from './telemetry/gsi-ingress.js';

export interface CompanionAppOptions {
  readonly logger?: boolean;
  readonly gsiToken?: string;
  readonly recorder?: CaptureRecorder;
  readonly telemetrySink?: TelemetrySink;
  readonly clock?: GsiClock;
}

export function buildApp(options: CompanionAppOptions = {}): FastifyInstance {
  const recorder = options.recorder ?? createDisabledRecorder('recorder_not_configured');
  let runtimeDegraded = false;

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
      ...(options.telemetrySink === undefined ? {} : { sink: options.telemetrySink }),
      onRuntimeDiagnostic: (code) => {
        if (!runtimeDegraded) {
          app.log.warn({ code }, 'Companion telemetry path degraded');
        }
        runtimeDegraded = true;
      },
    });
  }

  app.addHook('onClose', async () => {
    await recorder.finalize();
  });

  return app;
}
