import { access, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function executable(command) {
  return process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable(command), args, {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit ${code}`}`));
    });
  });
}

async function assertFile(path, label) {
  try {
    await access(path);
  } catch (error) {
    throw new Error(`qualification offline smoke missing ${label}: ${path}`, { cause: error });
  }
}

async function assertNoSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('qualification bundle contains symlink: ' + path);
    if (entry.isDirectory()) await assertNoSymlinks(path);
  }
}

async function assertBundleSmoke(outputRoot) {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const bundle = entries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith('rivalhub-broadcast-qualification-'),
  );
  const archive = entries.find((entry) => entry.isFile() && entry.name.endsWith('.zip'));
  if (bundle === undefined || archive === undefined)
    throw new Error('qualification build did not produce one bundle directory and one ZIP');
  const bundleDir = join(outputRoot, bundle.name);
  for (const relativePath of [
    'app/package.json',
    'app/dist/server.js',
    'app/node_modules',
    'runtime',
    'scripts/common.ps1',
    'scripts/install-gsi.ps1',
    'scripts/start.ps1',
    'scripts/mark.ps1',
    'scripts/check.ps1',
    'scripts/stop.ps1',
    'scripts/verify-evidence.mjs',
    'config/gamestate_integration_rivalhub_broadcast.cfg.template',
    'metadata/artifact.json',
    'metadata/SHA256SUMS',
    'evidence/.gitkeep',
    'README.txt',
  ])
    await assertFile(join(bundleDir, relativePath), relativePath);
  await assertNoSymlinks(join(bundleDir, 'app'));
  const artifact = JSON.parse(await readFile(join(bundleDir, 'metadata/artifact.json'), 'utf8'));
  const expectedSha = await new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
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
    child.once('exit', (code) =>
      code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(stderr)),
    );
  });
  if (artifact.gitSha !== expectedSha)
    throw new Error('qualification artifact git SHA is not bound to HEAD');
  if (artifact.platform !== 'win32-x64' || artifact.qualificationSchemaVersion !== 1)
    throw new Error('qualification artifact metadata is invalid');
  const deployedPackage = await readFile(join(bundleDir, 'app/package.json'), 'utf8');
  if (deployedPackage.includes('/Users/') || deployedPackage.includes('\\Users\\'))
    throw new Error('qualification deploy contains a host-specific absolute workspace path');
  const config = await readFile(
    join(bundleDir, 'config/gamestate_integration_rivalhub_broadcast.cfg.template'),
    'utf8',
  );
  if (!config.includes('REPLACE_WITH_GSI_TOKEN'))
    throw new Error('qualification config template lost its token placeholder');
  const scripts = await readFile(join(bundleDir, 'scripts/start.ps1'), 'utf8');
  if (!scripts.includes('runtime\\node.exe') || !scripts.includes('BROADCAST_COMMIT'))
    throw new Error('qualification start script is not portable');
}

async function main() {
  for (const command of [
    ['format:check'],
    ['lint'],
    ['architecture:check'],
    ['typecheck'],
    ['test'],
    ['build'],
  ])
    await runCommand('pnpm', command);

  const temporaryParent = join(rootDir, '.agent-tmp');
  await mkdir(temporaryParent, { recursive: true });
  const outputRoot = await mkdtemp(join(temporaryParent, 'qualification-offline-'));
  try {
    await runCommand('node', [
      'scripts/qualification/build.mjs',
      '--skip-build',
      '--skip-node-runtime',
      '--allow-dirty',
      '--output',
      outputRoot,
    ]);
    await assertBundleSmoke(outputRoot);
    console.log('QUALIFICATION_OFFLINE_PASS');
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `QUALIFICATION_OFFLINE_ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
