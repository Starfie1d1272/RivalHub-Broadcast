import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUNDLE_ROOT = resolve(MODULE_DIR, '..');
const FINALIZATION_SCHEMA_VERSION = 1;
const FINALIZATION_WAIT_TIMEOUT_MS = 60_000;

function loadQualificationContract() {
  for (const path of [
    join(MODULE_DIR, 'qualification-contract.json'),
    resolve(MODULE_DIR, '../../apps/companion/src/qualification/contract.json'),
  ]) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // Try the next repository or bundle location.
    }
  }
  throw new Error('qualification contract is missing');
}

const QUALIFICATION_RESULT_VALUES = new Set(loadQualificationContract().resultValues);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function runCommand(command, args, { cwd, logPath }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', async (code, signal) => {
      const output = `${stdout}${stderr}`;
      if (output.length > 0) await appendFile(logPath, output, 'utf8').catch(() => undefined);
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${command} failed with ${signal ?? `exit ${code}`}\n${stderr.trim()}`));
    });
  });
}

function waitForChild(child) {
  return new Promise((resolvePromise) => {
    child.once('error', (error) => resolvePromise({ code: null, signal: null, error }));
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

function waitForStream(stream) {
  if (stream.closed || stream.destroyed) return Promise.resolve();
  return new Promise((resolvePromise) => {
    stream.once('close', resolvePromise);
    stream.once('error', resolvePromise);
  });
}

function relativeBundlePath(bundleRoot, path) {
  return relative(bundleRoot, path).replaceAll('\\', '/');
}

function tokenMatches(request, expected) {
  const provided = request.headers['x-qualification-token'];
  if (typeof provided !== 'string') return false;
  const actualBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
}

function completionPage(completion) {
  const result = escapeHtml(completion.result ?? 'INCONCLUSIVE');
  const reportPath = escapeHtml(completion.reportPath ?? 'evidence/<runId>/REPORT.md');
  const verification =
    completion.verification === 'passed'
      ? 'Evidence verification passed'
      : 'Evidence verification failed';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qualification result</title></head>
<body><main><h1>Qualification result: ${result}</h1><p>${escapeHtml(verification)}</p><p>Report: <code>${reportPath}</code></p></main></body></html>`;
}

async function listenCompletionServer({ port, controlToken, getCompletion }) {
  const server = createServer((request, response) => {
    if (
      request.method === 'GET' &&
      (request.url === '/qualification' || request.url === '/qualification/')
    ) {
      const body = completionPage(getCompletion());
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }
    if (!tokenMatches(request, controlToken)) {
      sendJson(response, 401, { error: 'qualification_unauthorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/qualification/finalization') {
      sendJson(response, 200, getCompletion());
      return;
    }
    if (request.method === 'GET' && request.url === '/qualification/status') {
      sendJson(response, 200, getCompletion());
      return;
    }
    if (request.method === 'POST' && request.url === '/qualification/finalization/ack') {
      sendJson(response, 200, { ok: true });
      setTimeout(() => server.close(), 100).unref();
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  });

  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await new Promise((resolvePromise, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolvePromise();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host: '127.0.0.1', port });
      });
      return server;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EADDRINUSE') throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw lastError ?? new Error('completion server did not become available');
}

export async function finalizeQualificationRun({
  nodePath,
  evidenceScript,
  runDir,
  bundleRoot,
  logPath,
}) {
  await runCommand(nodePath, [evidenceScript, '--finish', runDir], { cwd: bundleRoot, logPath });
  await runCommand(nodePath, [evidenceScript, '--verify', runDir], { cwd: bundleRoot, logPath });
  const qualification = await readJson(join(runDir, 'qualification.json'));
  return {
    result: QUALIFICATION_RESULT_VALUES.has(qualification.result)
      ? qualification.result
      : 'INCONCLUSIVE',
    verification: 'passed',
    reportPath: relativeBundlePath(bundleRoot, join(runDir, 'REPORT.md')),
    qualificationPath: relativeBundlePath(bundleRoot, join(runDir, 'qualification.json')),
  };
}

async function restoreGsiConfig(statePath) {
  const state = await readJson(statePath);
  if (state.gsiRestored === true) return;
  const cfgPath = typeof state.cfgPath === 'string' ? state.cfgPath : undefined;
  if (cfgPath === undefined) throw new Error('qualification cfg path is missing');
  if (state.hadExistingConfig === true) {
    if (typeof state.backupPath !== 'string')
      throw new Error('qualification cfg backup is missing');
    await copyFile(state.backupPath, cfgPath);
    await rm(state.backupPath, { force: true });
  } else {
    await rm(cfgPath, { force: true });
  }
  await writeJson(statePath, { ...state, gsiRestored: true });
}

async function main() {
  const bundleRoot = resolve(process.env.QUALIFICATION_BUNDLE_ROOT ?? DEFAULT_BUNDLE_ROOT);
  const appRoot = resolve(process.env.QUALIFICATION_APP_ROOT ?? join(bundleRoot, 'app'));
  const nodePath = resolve(
    process.env.QUALIFICATION_NODE_PATH ?? join(bundleRoot, 'runtime', 'node.exe'),
  );
  const runDir = resolve(process.env.QUALIFICATION_RUN_DIR);
  const statePath = resolve(process.env.QUALIFICATION_RUN_STATE_PATH);
  const finalizationStatePath = resolve(
    process.env.QUALIFICATION_FINALIZATION_PATH ?? join(dirname(statePath), 'finalization.json'),
  );
  const controlToken = process.env.QUALIFICATION_CONTROL_TOKEN;
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error('qualification port is invalid');
  if (controlToken === undefined || controlToken.length === 0)
    throw new Error('qualification control token is missing');

  const logsDir = join(runDir, 'logs');
  await mkdir(logsDir, { recursive: true });
  const companionStdoutPath = join(logsDir, 'companion.log');
  const companionStderrPath = join(logsDir, 'companion.stderr.log');
  const supervisorLogPath = join(dirname(statePath), 'supervisor.log');
  const child = spawn(nodePath, ['dist/server.js'], {
    cwd: appRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  const companionStdout = createWriteStream(companionStdoutPath, { flags: 'a' });
  const companionStderr = createWriteStream(companionStderrPath, { flags: 'a' });
  child.stdout.pipe(companionStdout);
  child.stderr.pipe(companionStderr);

  const runState = await readJson(statePath);
  await writeJson(statePath, { ...runState, processId: child.pid });

  const reportPath = relativeBundlePath(bundleRoot, join(runDir, 'REPORT.md'));
  let completion = {
    schemaVersion: FINALIZATION_SCHEMA_VERSION,
    status: 'finalizing',
    runId: typeof runState.runId === 'string' ? runState.runId : 'unknown',
    result: 'INCONCLUSIVE',
    verification: 'pending',
    reportPath,
  };
  await writeJson(finalizationStatePath, completion);

  await waitForChild(child);
  await Promise.all([waitForStream(companionStdout), waitForStream(companionStderr)]);
  let completionServer;
  try {
    completionServer = await listenCompletionServer({
      port,
      controlToken,
      getCompletion: () => completion,
    });
  } catch (error) {
    await appendFile(
      supervisorLogPath,
      `completion server failed: ${String(error)}\n`,
      'utf8',
    ).catch(() => undefined);
  }

  let exitCode = 1;
  try {
    const finalization = await finalizeQualificationRun({
      nodePath,
      evidenceScript: join(bundleRoot, 'scripts', 'verify-evidence.mjs'),
      runDir,
      bundleRoot,
      logPath: supervisorLogPath,
    });
    completion = { ...completion, ...finalization, status: 'complete' };
    exitCode = finalization.result === 'PASS' ? 0 : 2;
  } catch (error) {
    completion = {
      ...completion,
      status: 'complete',
      result: 'INCONCLUSIVE',
      verification: 'failed',
      error: 'qualification evidence finalization failed',
    };
    await appendFile(
      supervisorLogPath,
      `evidence finalization failed: ${String(error)}\n`,
      'utf8',
    ).catch(() => undefined);
  }

  try {
    await restoreGsiConfig(statePath);
    completion = { ...completion, cleanup: 'passed' };
  } catch (error) {
    completion = {
      ...completion,
      result: completion.result === 'PASS' ? 'FAIL' : completion.result,
      verification: 'failed',
      cleanup: 'failed',
      error: 'qualification GSI config restore failed',
    };
    exitCode = 1;
    await appendFile(
      supervisorLogPath,
      `GSI config restore failed: ${String(error)}\n`,
      'utf8',
    ).catch(() => undefined);
  }
  await writeJson(finalizationStatePath, completion);

  if (completionServer !== undefined) {
    const closed = new Promise((resolvePromise) => completionServer.once('close', resolvePromise));
    const timeout = setTimeout(() => completionServer.close(), FINALIZATION_WAIT_TIMEOUT_MS);
    await closed;
    clearTimeout(timeout);
  }
  if (completionServer !== undefined && completion.cleanup === 'passed') {
    await rm(dirname(statePath), { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `QUALIFICATION_SUPERVISOR_ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
