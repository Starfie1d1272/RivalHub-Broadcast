import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildApp } from './app.js';
import { createProgramRuntime } from './runtime/program-runtime.js';
import { JsonSeriesProgressCheckpointStore } from './series-progress/checkpoint-store.js';
import {
  createCaptureRecorder,
  createDisabledRecorder,
  type CaptureRecorder,
  type RecorderDiagnostic,
} from './telemetry/capture-recorder.js';
import {
  createCstvSourceManagers,
  parseCstvSourceUrl,
  type CstvSourceManagers,
} from './telemetry/cstv-source-manager.js';
import { PRODUCTION_GSI_CONFIG } from './telemetry/gsi-ingress.js';
import { parseAllowedOrigins } from './local-web/origin-policy.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const webRoot = process.env.WEB_ROOT;
const localWebLanMode = /^(?:1|true)$/i.test(process.env.LOCAL_WEB_LAN_MODE ?? '');
const localWebAllowedOrigins = parseAllowedOrigins(process.env.LOCAL_WEB_ALLOWED_ORIGINS);
const gsiToken = process.env.GSI_TOKEN;
const captureDir = process.env.CAPTURE_DIR || join(process.cwd(), 'recordings', 'gsi');
const seriesProgressCheckpointPath =
  process.env.SERIES_PROGRESS_CHECKPOINT_PATH ?? join(captureDir, '..', 'series-progress.json');
const broadcastCommit = process.env.BROADCAST_COMMIT ?? 'unknown';
const qualificationMode = /^(?:1|true)$/i.test(process.env.QUALIFICATION_MODE ?? '');
const qualificationControlToken = process.env.QUALIFICATION_CONTROL_TOKEN;
const operatorControlToken = process.env.OPERATOR_CONTROL_TOKEN;
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

let cstvSourceConfig: CstvSourceManagers | undefined;
let cstvSourceConfigError: string | undefined;
try {
  const programUrl = parseCstvSourceUrl(process.env.PROGRAM_CSTV_URL, 'PROGRAM_CSTV_URL');
  const lookaheadUrl = parseCstvSourceUrl(process.env.LOOKAHEAD_CSTV_URL, 'LOOKAHEAD_CSTV_URL');
  cstvSourceConfig = createCstvSourceManagers({
    ...(programUrl === undefined ? {} : { programUrl }),
    ...(lookaheadUrl === undefined ? {} : { lookaheadUrl }),
  });
} catch (error: unknown) {
  cstvSourceConfigError =
    error instanceof Error ? error.message : 'CSTV source configuration invalid';
}

function logRecorderDiagnostic(diagnostic: RecorderDiagnostic): void {
  const fields = {
    code: diagnostic.code,
    ...(diagnostic.operation === undefined ? {} : { operation: diagnostic.operation }),
    ...(diagnostic.causeCode === undefined ? {} : { causeCode: diagnostic.causeCode }),
  };
  console.warn(`Companion capture recorder 诊断：${JSON.stringify(fields)}`);
}

async function writeFinalRuntime(path: string, response: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(response, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

if (gsiToken === undefined || gsiToken.trim().length === 0) {
  console.error('Companion 启动失败：GSI_TOKEN 必须设置为非空值');
  process.exitCode = 1;
} else if (qualificationMode && (qualificationControlToken?.trim().length ?? 0) === 0) {
  console.error('Companion 启动失败：qualification 模式下必须设置 QUALIFICATION_CONTROL_TOKEN');
  process.exitCode = 1;
} else if (qualificationMode && host !== '127.0.0.1') {
  console.error('Companion 启动失败：qualification 模式必须监听 loopback 127.0.0.1');
  process.exitCode = 1;
} else if (operatorControlToken !== undefined && operatorControlToken.trim().length === 0) {
  console.error('Companion 启动失败：OPERATOR_CONTROL_TOKEN 必须设置为非空值');
  process.exitCode = 1;
} else if (cstvSourceConfigError !== undefined) {
  console.error(`Companion 启动失败：${cstvSourceConfigError}`);
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
    console.error(`Companion capture recorder 不可用：${String(error)}`);
  }

  const seriesProgressCheckpointStore = new JsonSeriesProgressCheckpointStore({
    filePath: seriesProgressCheckpointPath,
    onDiagnostic: (code) => console.warn(`SeriesProgress checkpoint 诊断：${code}`),
  });
  const programRuntime = createProgramRuntime(producerInstanceId, {
    seriesProgressCheckpointStore,
    onSeriesProgressDiagnostic: ({ code }) =>
      console.warn(`SeriesProgress checkpoint 诊断：${code}`),
  });
  const app = buildApp({
    logger: true,
    gsiToken,
    recorder,
    programRuntime,
    ...(webRoot === undefined ? {} : { webRoot }),
    host,
    localWebLanMode,
    localWebAllowedOrigins,
    ...(cstvSourceConfig === undefined ? {} : { cstvSources: cstvSourceConfig }),
    qualificationMode,
    ...(qualificationControlToken === undefined ? {} : { qualificationControlToken }),
    ...(operatorControlToken === undefined ? {} : { operatorControlToken }),
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
              console.error(`Qualification final runtime snapshot 获取失败：${String(error)}`);
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
          `Companion shutdown watchdog 在 ${COMPANION_SHUTDOWN_WATCHDOG_TIMEOUT_MS}ms 后超时`,
        );
        process.exit(1);
      }, COMPANION_SHUTDOWN_WATCHDOG_TIMEOUT_MS);
      watchdog.unref();

      try {
        await app.close();
        appClosed = true;
        app.log.info({ signal }, 'Companion 已停止');
      } catch (error: unknown) {
        app.log.error(error, 'Companion 关闭失败');
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
    cstvSourceConfig?.program.start();
    cstvSourceConfig?.lookahead.start();
    app.log.info({ host, port }, 'Companion 正在监听');
  } catch (error: unknown) {
    app.log.error(error, 'Companion 启动失败');
    await app.close();
    process.exitCode = 1;
  }
}
