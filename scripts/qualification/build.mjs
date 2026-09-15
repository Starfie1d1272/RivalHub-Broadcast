import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'Starfie1d1272/RivalHub-Broadcast';
const QUALIFICATION_SCHEMA_VERSION = 1;
const NODE_MAJOR = 24;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)));

function usage() {
  return [
    'usage: node scripts/qualification/build.mjs [options]',
    '  --output <directory>       output directory (default: .agent-tmp/qualification-build)',
    '  --node-version <v24.x.y>  exact official Windows Node runtime version',
    '  --skip-build               reuse existing dist outputs',
    '  --skip-node-runtime        structure-only smoke bundle; not a validator artifact',
    '  --allow-dirty               allow uncommitted source while developing locally',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    output: join(rootDir, '.agent-tmp', 'qualification-build'),
    nodeVersion: process.env.QUALIFICATION_NODE_VERSION,
    skipBuild: false,
    skipNodeRuntime: false,
    allowDirty: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-build') options.skipBuild = true;
    else if (argument === '--skip-node-runtime') options.skipNodeRuntime = true;
    else if (argument === '--allow-dirty') options.allowDirty = true;
    else if (argument === '--output' || argument === '--node-version') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`missing value for ${argument}`);
      if (argument === '--output') options.output = resolve(rootDir, value);
      else options.nodeVersion = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${argument}\n${usage()}`);
    }
  }
  return options;
}

function executable(command) {
  return process.platform === 'win32' && command === 'pnpm' ? 'pnpm.exe' : command;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn(executable(command), args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      processHandle.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      processHandle.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }
    processHandle.once('error', reject);
    processHandle.once('exit', (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} ${args.join(' ')} failed with ${signal ?? `exit ${code}`}\n${stderr}`,
          ),
        );
    });
  });
}

async function commandOutput(command, args, cwd = rootDir) {
  return (await runCommand(command, args, { cwd, capture: true })).stdout.trim();
}

async function ensureCleanCheckout(allowDirty) {
  if (allowDirty) return;
  const status = await commandOutput('git', ['status', '--porcelain']);
  if (status.length > 0)
    throw new Error(
      'qualification build requires a clean checkout; use --allow-dirty only for local development',
    );
}

async function fetchResponse(url) {
  const response = await globalThis.fetch(url);
  if (!response.ok || response.body === null)
    throw new Error(`download failed: ${url} (${response.status})`);
  return response;
}

async function resolveNodeVersion(requested) {
  if (requested !== undefined) {
    const normalized = requested.startsWith('v') ? requested : `v${requested}`;
    if (!/^v24\.\d+\.\d+$/.test(normalized))
      throw new Error(`Node qualification runtime must be an exact v24.x.y version: ${requested}`);
    return normalized;
  }
  const response = await fetchResponse('https://nodejs.org/dist/index.json');
  const releases = await response.json();
  const release = releases.find(
    (entry) =>
      typeof entry?.version === 'string' &&
      entry.version.startsWith(`v${NODE_MAJOR}.`) &&
      entry.lts,
  );
  if (release?.version === undefined)
    throw new Error('could not resolve a stable Node 24 release from nodejs.org');
  return release.version;
}

async function downloadNodeRuntime(runtimeDir, requestedVersion, temporaryDirectory) {
  const version = await resolveNodeVersion(requestedVersion);
  const archiveName = `node-${version}-win-x64.zip`;
  const baseUrl = `https://nodejs.org/dist/${version}`;
  const sumsResponse = await fetchResponse(`${baseUrl}/SHASUMS256.txt`);
  const sums = await sumsResponse.text();
  const sumLine = sums
    .split(/\r?\n/)
    .find(
      (line) => line.trim().endsWith(` ${archiveName}`) || line.trim().endsWith(`*${archiveName}`),
    );
  const expectedHash = sumLine?.trim().split(/\s+/)[0];
  if (expectedHash === undefined || !/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error(`official SHA-256 for ${archiveName} is missing`);
  const archivePath = join(temporaryDirectory, archiveName);
  const archiveResponse = await fetchResponse(`${baseUrl}/${archiveName}`);
  await pipeline(
    Readable.fromWeb(archiveResponse.body),
    createWriteStream(archivePath, { mode: 0o600 }),
  );
  const actualHash = await sha256File(archivePath);
  if (actualHash !== expectedHash)
    throw new Error(`Node runtime SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}`);
  const extractDir = join(temporaryDirectory, 'node-extract');
  await mkdir(extractDir);
  try {
    await runCommand('unzip', ['-q', archivePath, '-d', extractDir]);
  } catch (unzipError) {
    await runCommand('tar', ['-xf', archivePath, '-C', extractDir]).catch(() => {
      throw unzipError;
    });
  }
  const extractedRoot = join(extractDir, `node-${version}-win-x64`);
  await cp(extractedRoot, runtimeDir, { recursive: true, force: true });
  await access(join(runtimeDir, 'node.exe'));
  return version;
}

async function listFiles(root, ignored = new Set()) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replaceAll('\\', '/');
      if (ignored.has(relativePath)) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of (await import('node:fs')).createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function contentDigest(bundleDir) {
  const files = await listFiles(
    bundleDir,
    new Set(['metadata/artifact.json', 'metadata/SHA256SUMS']),
  );
  const hash = createHash('sha256');
  for (const path of files) {
    const digest = await sha256File(path);
    hash.update(`${relative(bundleDir, path).replaceAll('\\', '/')}\0${digest}\n`, 'utf8');
  }
  return hash.digest('hex');
}

async function createDeployWorkspace(workspaceDir) {
  await mkdir(workspaceDir, { recursive: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    await cp(join(rootDir, name), join(workspaceDir, name));
  }
  for (const group of ['apps', 'packages']) {
    const sourceGroup = join(rootDir, group);
    const targetGroup = join(workspaceDir, group);
    await mkdir(targetGroup, { recursive: true });
    for (const entry of await readdir(sourceGroup, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourcePackage = join(sourceGroup, entry.name);
      const targetPackage = join(targetGroup, entry.name);
      await mkdir(targetPackage, { recursive: true });
      await cp(join(sourcePackage, 'package.json'), join(targetPackage, 'package.json'));
      try {
        await cp(join(sourcePackage, 'dist'), join(targetPackage, 'dist'), {
          recursive: true,
          dereference: true,
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
}

async function writeShaSums(bundleDir) {
  const sumsPath = join(bundleDir, 'metadata', 'SHA256SUMS');
  const files = await listFiles(bundleDir, new Set(['metadata/SHA256SUMS']));
  const lines = [];
  for (const path of files)
    lines.push(`${await sha256File(path)}  ${relative(bundleDir, path).replaceAll('\\', '/')}`);
  await writeFile(sumsPath, `${lines.join('\n')}\n`, 'utf8');
}

async function createArchive(bundleDir, outputRoot, bundleName) {
  const archivePath = join(outputRoot, `${bundleName}.zip`);
  if (process.platform === 'win32') {
    await runCommand('tar', ['-a', '-c', '-f', archivePath, '-C', outputRoot, bundleName]);
  } else {
    await runCommand('zip', ['-q', '-r', archivePath, bundleName], { cwd: outputRoot });
  }
  return { archivePath, archiveSha256: await sha256File(archivePath) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await ensureCleanCheckout(options.allowDirty);
  const gitSha = await commandOutput('git', ['rev-parse', 'HEAD']);
  const shortSha = gitSha.slice(0, 7);
  const bundleName = `rivalhub-broadcast-qualification-${shortSha}-win-x64`;
  await mkdir(options.output, { recursive: true });
  const bundleDir = join(options.output, bundleName);
  const archivePath = join(options.output, `${bundleName}.zip`);
  for (const path of [bundleDir, archivePath]) {
    try {
      await access(path);
      throw new Error(`output already exists: ${path}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (!options.skipBuild) await runCommand('pnpm', ['build']);
  await access(join(rootDir, 'apps', 'companion', 'dist', 'server.js'));

  const stagingParent = await mkdtemp(join(options.output, '.staging-'));
  const stagingDir = join(stagingParent, bundleName);
  const deployWorkspaceDir = join(stagingParent, '.deploy-workspace');
  const deployedAppDir = join(stagingDir, '.deployed-app');
  const appDir = join(stagingDir, 'app');
  const downloadDir = await mkdtemp(join(options.output, '.node-runtime-'));
  try {
    await mkdir(join(stagingDir, 'runtime'), { recursive: true });
    await mkdir(join(stagingDir, 'scripts'), { recursive: true });
    await mkdir(join(stagingDir, 'config'), { recursive: true });
    await mkdir(join(stagingDir, 'metadata'), { recursive: true });
    await mkdir(join(stagingDir, 'evidence'), { recursive: true });
    await writeFile(join(stagingDir, 'evidence', '.gitkeep'), '', 'utf8');
    await createDeployWorkspace(deployWorkspaceDir);
    await runCommand(
      'pnpm',
      ['--filter', '@rivalhub-broadcast/companion', 'deploy', deployedAppDir, '--prod', '--legacy'],
      { cwd: deployWorkspaceDir },
    );
    await cp(deployedAppDir, appDir, { recursive: true, dereference: true });
    await rm(deployedAppDir, { recursive: true, force: true });
    const nodeVersion = options.skipNodeRuntime
      ? `v${NODE_MAJOR}.x.x-smoke-only`
      : await downloadNodeRuntime(join(stagingDir, 'runtime'), options.nodeVersion, downloadDir);
    for (const name of [
      'common.ps1',
      'install-gsi.ps1',
      'start.ps1',
      'mark.ps1',
      'check.ps1',
      'stop.ps1',
      'README.txt',
    ]) {
      await cp(
        join(scriptDir, 'bundle', name),
        join(stagingDir, name === 'README.txt' ? name : join('scripts', name)),
      );
    }
    await cp(join(scriptDir, 'evidence.mjs'), join(stagingDir, 'scripts', 'verify-evidence.mjs'));
    await cp(
      join(rootDir, 'config', 'gamestate_integration_rivalhub_broadcast.cfg.example'),
      join(stagingDir, 'config', 'gamestate_integration_rivalhub_broadcast.cfg.template'),
    );
    await writeFile(
      join(stagingDir, 'README.txt'),
      `${await readFile(join(scriptDir, 'bundle', 'README.txt'), 'utf8')}`
        .replaceAll('<SHORT_SHA>', shortSha)
        .replaceAll('<NODE_VERSION>', nodeVersion),
      'utf8',
    );

    const buildTimestamp = new Date().toISOString();
    const digest = await contentDigest(stagingDir);
    const artifact = {
      schemaVersion: 1,
      repository: REPOSITORY,
      gitSha,
      buildTimestamp,
      platform: 'win32-x64',
      nodeVersion,
      qualificationSchemaVersion: QUALIFICATION_SCHEMA_VERSION,
      artifactSha256: digest,
    };
    await writeFile(
      join(stagingDir, 'metadata', 'artifact.json'),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    );
    await writeShaSums(stagingDir);

    await rename(stagingDir, bundleDir);
    await rm(stagingParent, { recursive: true, force: true });
    await rm(downloadDir, { recursive: true, force: true });
    const archive = await createArchive(bundleDir, options.output, bundleName);
    console.log(
      JSON.stringify({
        bundleDir,
        archivePath: archive.archivePath,
        archiveSha256: archive.archiveSha256,
        artifactSha256: digest,
        gitSha,
        nodeVersion,
      }),
    );
  } catch (error) {
    await rm(stagingParent, { recursive: true, force: true });
    await rm(downloadDir, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(
    `QUALIFICATION_BUILD_ERROR: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
