import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildApp } from './app.js';
import { createProgramRuntime } from './runtime/program-runtime.js';
import {
  createCaptureRecorder,
  createDisabledRecorder,
  type CaptureRecorder,
  type RecorderDiagnostic,
} from './telemetry/capture-recorder.js';
import { PRODUCTION_GSI_CONFIG } from './telemetry/gsi-ingress.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const gsiToken = process.env.GSI_TOKEN;
const captureDir = process.env.CAPTURE_DIR || join(process.cwd(), 'recordings', 'gsi');
const broadcastCommit = process.env.BROADCAST_COMMIT ?? 'unknown';
const qualificationMode = /^(?:1|true)$/i.test(process.env.QUALIFICATION_MODE ?? '');
const qualificationControlToken = process.env.QUALIFICATION_CONTROL_TOKEN;
const qualificationRunId = process.env.QUALIFICATION_RUN_ID ?? randomUUID();
const qualificationEvidenceDir = process.env.QUALIFICATION_EVIDENCE_DIR;
const qualificationScenarioPath =
  process.env.QUALIFICATION_SCENARIO_PATH ?? join(captureDir, '..', 'scenario.jsonl');
const qualificationFinalRuntimePath =
  qualificationMode && qualificationEvidenceDir !== undefined
    ? join(qualificationEvidenceDir, 'debug', 'final-runtime.json')
    : undefined;
const COMPANION_SHUTDOWN_WATCHDOG_TIMEOUT_MS = 30_000;
const producerInstanceId = randomUUID();

function logRecorderDiagnostic(diagnostic: RecorderDiagnostic): void {
  const fields = {
    code: diagnostic.code,
    ...(diagnostic.operation === undefined ? {} : { operation: diagnostic.operation }),
    ...(diagnostic.causeCode === undefined ? {} : { causeCode: diagnostic.causeCode }),
  };
  console.warn(`Companion capture recorder diagnostic: ${JSON.stringify(fields)}`);
}

async function writeFinalRuntime(path: string, response: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(response, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

if (gsiToken === undefined || gsiToken.trim().length === 0) {
  console.error('Companion startup failed: GSI_TOKEN must be set to a non-empty value');
  process.exitCode = 1;
} else if (qualificationMode && (qualificationControlToken?.trim().length ?? 0) === 0) {
  console.error(
    'Companion startup failed: QUALIFICATION_CONTROL_TOKEN must be set in qualification mode',
  );
  process.exitCode = 1;
} else if (qualificationMode && host !== '127.0.0.1') {
  console.error('Companion startup failed: qualification mode must listen on loopback 127.0.0.1');
  process.exitCode = 1;
} else {
  let recorder: CaptureRecorder;

  try {
    recorder = await createCaptureRecorder({
      captureDir,
      broadcastCommit,
      gsiConfig: PRODUCTION_GSI_CONFIG,
      onDiagnostic: logRecorderDiagnostic,
    });
  } catch (error: unknown) {
    recorder = createDisabledRecorder('recorder_start_failed');
    console.error(`Companion capture recorder unavailable: ${String(error)}`);
  }

  const programRuntime = createProgramRuntime(producerInstanceId);
  const app = buildApp({
    logger: true,
    gsiToken,
    recorder,
    programRuntime,
    qualificationMode,
    ...(qualificationControlToken === undefined ? {} : { qualificationControlToken }),
    ...(qualificationMode
      ? {
          qualificationRunId,
          qualificationScenarioPath,
          onQualificationFinish: async ({ debug }: { readonly debug: unknown }) => {
            try {
              if (qualificationFinalRuntimePath !== undefined) {
                await writeFinalRuntime(qualificationFinalRuntimePath, debug);
              }
            } catch (error: unknown) {
              console.error(`Qualification final runtime snapshot failed: ${String(error)}`);
            } finally {
              shutdown('qualification-finish');
            }
          },
        }
      : {}),
  });
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
