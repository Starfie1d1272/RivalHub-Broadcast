import { join } from 'node:path';

import { buildApp } from './app.js';
import {
  createCaptureRecorder,
  createDisabledRecorder,
  RECORDER_SHUTDOWN_DRAIN_TIMEOUT_MS,
  type CaptureRecorder,
} from './telemetry/capture-recorder.js';
import { PRODUCTION_GSI_CONFIG } from './telemetry/gsi-ingress.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const gsiToken = process.env.GSI_TOKEN;
const captureDir = process.env.CAPTURE_DIR || join(process.cwd(), 'recordings', 'gsi');
const broadcastCommit = process.env.BROADCAST_COMMIT ?? 'unknown';
const COMPANION_SHUTDOWN_WATCHDOG_TIMEOUT_MS = RECORDER_SHUTDOWN_DRAIN_TIMEOUT_MS + 2_000;

if (gsiToken === undefined || gsiToken.trim().length === 0) {
  console.error('Companion startup failed: GSI_TOKEN must be set to a non-empty value');
  process.exitCode = 1;
} else {
  let recorder: CaptureRecorder;

  try {
    recorder = await createCaptureRecorder({
      captureDir,
      broadcastCommit,
      gsiConfig: PRODUCTION_GSI_CONFIG,
      onDiagnostic: (diagnostic) => {
        console.warn(`Companion capture recorder diagnostic: ${diagnostic.code}`);
      },
    });
  } catch (error: unknown) {
    recorder = createDisabledRecorder('recorder_start_failed');
    console.error(`Companion capture recorder unavailable: ${String(error)}`);
  }

  const app = buildApp({ logger: true, gsiToken, recorder });
  let shutdownPromise: Promise<void> | undefined;

  function shutdown(signal: string): void {
    shutdownPromise ??= (async () => {
      let appClosed = false;
      const watchdog = setTimeout(() => {
        if (appClosed && recorder.getHealth().state === 'closed') return;
        console.error(
          `Companion shutdown watchdog expired after ${COMPANION_SHUTDOWN_WATCHDOG_TIMEOUT_MS}ms`,
        );
        process.exit(1);
      }, COMPANION_SHUTDOWN_WATCHDOG_TIMEOUT_MS);
      watchdog.unref();

      try {
        await app.close();
        appClosed = true;
        app.log.info({ signal }, 'Companion stopped');
      } catch (error: unknown) {
        app.log.error(error, 'Companion shutdown failed');
        process.exitCode = 1;
      } finally {
        if (recorder.getHealth().state === 'closed') clearTimeout(watchdog);
      }
    })();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ host, port });
    app.log.info({ host, port }, 'Companion listening');
  } catch (error: unknown) {
    app.log.error(error, 'Companion startup failed');
    await app.close();
    process.exitCode = 1;
  }
}
