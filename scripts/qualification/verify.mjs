import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { QualificationEvidenceError, readQualificationEvidence } from './evidence.mjs';

function runCommand(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'inherit', 'pipe'], shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${command} failed with ${signal ?? `exit ${code}`}: ${stderr.trim()}`));
    });
  });
}

async function extractArchive(archivePath, destination) {
  const commands =
    process.platform === 'win32'
      ? [
          ['tar', ['-xf', archivePath, '-C', destination]],
          ['unzip', ['-q', archivePath, '-d', destination]],
        ]
      : [
          ['unzip', ['-q', archivePath, '-d', destination]],
          ['tar', ['-xf', archivePath, '-C', destination]],
        ];
  let lastError;
  for (const [command, args] of commands) {
    try {
      await runCommand(command, args, destination);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`cannot extract ${archivePath}`);
}

async function findEvidenceDirectories(root) {
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'runtime')
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name === 'qualification.json') {
        result.push(dirname(path));
      }
    }
  }
  await visit(root);
  return result.sort();
}

async function resolveEvidenceDirectory(input) {
  const inputPath = resolve(input);
  const inputStat = await stat(inputPath);
  if (inputStat.isDirectory()) {
    const candidates = await findEvidenceDirectories(inputPath);
    if (candidates.length !== 1) {
      throw new Error(
        `expected exactly one evidence directory under ${inputPath}, found ${candidates.length}`,
      );
    }
    return { runDir: candidates[0], cleanup: undefined };
  }
  if (!inputStat.isFile() || !inputPath.toLowerCase().endsWith('.zip')) {
    throw new Error(`input must be an evidence directory or .zip archive: ${inputPath}`);
  }
  const extractionRoot = await mkdtemp(join(tmpdir(), 'rivalhub-qualification-verify-'));
  try {
    await extractArchive(inputPath, extractionRoot);
    const candidates = await findEvidenceDirectories(extractionRoot);
    if (candidates.length !== 1) {
      await rm(extractionRoot, { recursive: true, force: true });
      throw new Error(
        `expected exactly one evidence directory in ${basename(inputPath)}, found ${candidates.length}`,
      );
    }
    return { runDir: candidates[0], cleanup: extractionRoot };
  } catch (error) {
    await rm(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main(argv) {
  if (argv.length !== 1) throw new Error('usage: pnpm qualification:verify <evidence-dir-or-zip>');
  const resolved = await resolveEvidenceDirectory(argv[0]);
  try {
    const evidence = await readQualificationEvidence(resolved.runDir);
    console.log(
      JSON.stringify(
        {
          result: evidence.qualification.result,
          runId: evidence.qualification.runId,
          gitSha: evidence.qualification.artifact.gitSha,
          checks: evidence.qualification.checks,
          captureCount: evidence.captureResults.length,
        },
        null,
        2,
      ),
    );
  } finally {
    if (resolved.cleanup !== undefined)
      await rm(resolved.cleanup, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof QualificationEvidenceError ? `${error.code}: ` : '';
    console.error(
      `QUALIFICATION_VERIFY_ERROR: ${code}${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
