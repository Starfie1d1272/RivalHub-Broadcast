import { Buffer } from 'node:buffer';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_PATH,
  PACKAGE_ROOT,
  REPOSITORY_ROOT,
  TOOLCHAIN_PATH,
  assert,
  listFiles,
  validateBroadcastOutputPath,
  readCatalog,
  readJson,
  sha256,
  sha256File,
  validateCatalog,
  validateSourcePath,
} from './common.mjs';
import { verifyCs2Assets } from './verify.mjs';

const RAW_EXTENSION = '.vsvg_c';

function usage() {
  return [
    '用法：node scripts/cs2-assets/import.mjs --cs2-root <Counter-Strike 2 root>',
    '  或：node scripts/cs2-assets/import.mjs --vpk <pak01_dir.vpk> --steam-build-id <id>',
    '  --cli <Source2Viewer-CLI>   指定已安装的 VRF CLI（也可使用 SOURCE2VIEWER_CLI）',
    '  --steam-build-id <id>      显式指定 Steam build id',
    '  --output <directory>       覆盖 packages/cs2-assets/generated 输出目录',
    '  --help                     显示帮助',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--') continue;
    if (argument === '--radar-only') {
      options.radarOnly = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--cs2-root') {
      assert(value !== undefined && !value.startsWith('--'), `${argument} 缺少值`);
      options.cs2Root = resolve(value);
      index += 1;
    } else if (argument === '--vpk') {
      assert(value !== undefined && !value.startsWith('--'), `${argument} 缺少值`);
      options.vpk = resolve(value);
      index += 1;
    } else if (argument === '--steam-build-id') {
      assert(value !== undefined && !value.startsWith('--'), `${argument} 缺少值`);
      options.steamBuildId = value;
      index += 1;
    } else if (argument === '--cli') {
      assert(value !== undefined && !value.startsWith('--'), `${argument} 缺少值`);
      options.cli = resolve(value);
      index += 1;
    } else if (argument === '--output') {
      assert(value !== undefined && !value.startsWith('--'), `${argument} 缺少值`);
      options.output = resolve(value);
      index += 1;
    } else {
      throw new Error(`未知参数：${argument}\n${usage()}`);
    }
  }
  assert(
    options.cs2Root !== undefined || options.vpk !== undefined,
    '必须提供 --cs2-root 或 --vpk',
  );
  assert(
    !(options.cs2Root !== undefined && options.vpk !== undefined),
    '--cs2-root 与 --vpk 不能同时提供',
  );
  assert(
    options.vpk === undefined || options.steamBuildId !== undefined,
    '--vpk 模式必须显式提供 --steam-build-id',
  );
  if (options.steamBuildId !== undefined) {
    assert(/^\d+$/.test(options.steamBuildId), '--steam-build-id 必须是数字');
  }
  return options;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
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
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} ${args.join(' ')} 失败（${signal ?? `退出码 ${code}`}）\n${stderr || stdout}`,
          ),
        );
    });
  });
}

export function parseCliVersion(rawOutput) {
  const text = String(rawOutput ?? '').trim();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = /^(?:version:\s*|source\s*2\s*viewer(?:\s*-\s*v|\s+v|\s+)?)(.+)$/i.exec(trimmed);
    if (match) {
      return match[1].trim();
    }
  }
  const firstLine = text.split(/\r?\n/)[0]?.trim();
  return firstLine || text;
}

export function versionMatches(actualOutput, expectedVersion) {
  const parsed = parseCliVersion(actualOutput);
  return parsed === expectedVersion;
}

async function commandVersion(launcher) {
  const result = await runCommand(launcher.command, [...launcher.prefixArgs, '--version']);
  return `${result.stdout}\n${result.stderr}`.trim();
}

function readSteamBuildIdFromAppManifest(appManifest) {
  const text = appManifest;
  const match = /"buildid"\s*"(\d+)"/i.exec(text);
  assert(match?.[1] !== undefined, `appmanifest_730.acf 缺少 buildid：${appManifest}`);
  return match[1];
}

async function resolveInput(options) {
  if (options.vpk !== undefined) {
    assert(options.steamBuildId !== undefined, '--vpk 模式必须显式提供 --steam-build-id');
    await access(options.vpk);
    return { vpk: options.vpk, steamBuildId: options.steamBuildId };
  }

  const cs2Root = options.cs2Root;
  const vpk = join(cs2Root, 'game', 'csgo', 'pak01_dir.vpk');
  const appManifestPath = join(dirname(dirname(cs2Root)), 'appmanifest_730.acf');
  await access(vpk);
  let steamBuildId = options.steamBuildId;
  if (steamBuildId === undefined) {
    steamBuildId = readSteamBuildIdFromAppManifest(await readFile(appManifestPath, 'utf8'));
  }
  return { vpk, steamBuildId };
}

export function allocateContentHashedOutputPath({ item, outputSha256, occupiedPaths = new Map() }) {
  const category = item.kind === 'firearm' || item.kind === 'melee' ? 'weapon' : item.kind;
  const slug = item.assetId.replace(/^[^.]+\./, '');
  const baseRoute = `/assets/cs2/${category}/${slug}`;

  for (const [existingPath, existing] of occupiedPaths.entries()) {
    if (
      existing.assetId !== item.assetId &&
      existing.outputSha256 === outputSha256 &&
      existingPath.startsWith(`${baseRoute}.`)
    ) {
      throw new Error(
        `CS2 asset output route collision: 资产 ${item.assetId} 与既有资产 ${existing.assetId} 产生无法通过 64-hex SHA-256 消解的输出路径冲突（base route: ${baseRoute}）`,
      );
    }
  }

  for (let length = 12; length <= 64; length += 4) {
    const candidatePath = `${baseRoute}.${outputSha256.slice(0, length)}.svg`;
    const existing = occupiedPaths.get(candidatePath);
    if (!existing) {
      occupiedPaths.set(candidatePath, { assetId: item.assetId, outputSha256 });
      return candidatePath;
    }
    if (existing.assetId === item.assetId && existing.outputSha256 === outputSha256) {
      return candidatePath;
    }
  }

  throw new Error(
    `CS2 asset output route collision: 资产 ${item.assetId} 与既有路径产生无法通过 64-hex SHA-256 消解的输出路径冲突（base route: ${baseRoute}）`,
  );
}

export function canonicalOutputPath(item, outputSha256, occupiedPaths = new Map()) {
  return allocateContentHashedOutputPath({ item, outputSha256, occupiedPaths });
}

function normalizeSvg(value) {
  const normalized = value
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd();
  assert(normalized.startsWith('<'), 'VRF 输出不是 SVG 文本');
  assert(/<svg(?:\s|>)/i.test(normalized), 'VRF 输出缺少 <svg> 根元素');
  return Buffer.from(`${normalized}\n`, 'utf8');
}

function outputRecordPath(outputRoot, outputPath) {
  return join(outputRoot, outputPath.replace(/^\//, ''));
}

async function findExportedRawFile(root, sourcePath) {
  const expected = join(root, sourcePath);
  try {
    await access(expected);
    return expected;
  } catch {
    const files = await listFiles(root);
    const match = files.find((path) => relative(root, path).replaceAll('\\', '/') === sourcePath);
    if (match !== undefined) return match;
    throw new Error(`VRF 未导出 allowlist resource：${sourcePath}`);
  }
}

export const DEFAULT_DIRECTORY_FILE_OPS = Object.freeze({
  rename,
  rm,
  access,
});

export async function recoverInterruptedTransaction(
  targetDirectory,
  fileOps = DEFAULT_DIRECTORY_FILE_OPS,
) {
  const backupDirectory = `${targetDirectory}.previous`;
  let targetExists = false;
  let backupExists = false;

  try {
    await fileOps.access(targetDirectory);
    targetExists = true;
  } catch {
    // target absent
  }

  try {
    await fileOps.access(backupDirectory);
    backupExists = true;
  } catch {
    // backup absent
  }

  // State B: target absent, backup exists -> recover target from backup
  if (!targetExists && backupExists) {
    await fileOps.rename(backupDirectory, targetDirectory);
  } else if (targetExists && backupExists) {
    // State C: target exists, backup exists -> stale backup left after completed swap
    await fileOps.rm(backupDirectory, { recursive: true, force: true });
  }
  // State A (target exists, backup absent) & State D (both absent) require no recovery
}

export async function replaceDirectoryTransactionally(
  stagingDirectory,
  targetDirectory,
  fileOps = DEFAULT_DIRECTORY_FILE_OPS,
) {
  const backupDirectory = `${targetDirectory}.previous`;

  // Step 1: Recover any previous interrupted transaction before touching anything
  await recoverInterruptedTransaction(targetDirectory, fileOps);

  let targetExists = false;
  try {
    await fileOps.access(targetDirectory);
    targetExists = true;
  } catch {
    // target absent
  }

  // Step 2: Target -> Backup if target exists
  if (targetExists) {
    await fileOps.rename(targetDirectory, backupDirectory);
  }

  // Step 3: Staging -> Target
  try {
    await fileOps.rename(stagingDirectory, targetDirectory);
  } catch (replacementError) {
    // Step 4: If replacement fails and target was moved to backup, attempt rollback
    if (targetExists) {
      try {
        await fileOps.rename(backupDirectory, targetDirectory);
      } catch (rollbackError) {
        throw new AggregateError(
          [replacementError, rollbackError],
          `CS2 asset directory replacement failed and rollback failed; previous tree remains at ${backupDirectory}`,
          { cause: rollbackError },
        );
      }
    }
    throw replacementError;
  }

  // Step 5: Clean backup on successful replacement
  if (targetExists) {
    await fileOps.rm(backupDirectory, { recursive: true, force: true });
  }
}

export async function importCs2Assets({
  options = {},
  repositoryRoot = REPOSITORY_ROOT,
  packageRoot = PACKAGE_ROOT,
  outputRoot,
} = {}) {
  const targetOutputRoot = outputRoot ?? options.output ?? join(packageRoot, 'generated');
  const toolchain = await readJson(join(repositoryRoot, relative(REPOSITORY_ROOT, TOOLCHAIN_PATH)));
  const catalog = await readCatalog(join(packageRoot, relative(PACKAGE_ROOT, CATALOG_PATH)));
  validateCatalog(catalog);
  assert(catalog.items.length > 0, 'catalog/items.json 为空；先登记待导入的 semantic catalog');
  const input = await resolveInput(options);
  const cli = options.cli ?? process.env.SOURCE2VIEWER_CLI;
  assert(
    cli !== undefined && cli.length > 0,
    '必须提供 --cli 或 SOURCE2VIEWER_CLI；import 不自动下载 VRF binary',
  );
  const launcher = options._launcher ?? { command: cli, prefixArgs: [] };
  const actualVersion = await commandVersion(launcher);
  const expectedVersion = toolchain.valveResourceFormat.version;
  assert(
    versionMatches(actualVersion, expectedVersion),
    `Source2Viewer-CLI 版本不匹配：期望 ${expectedVersion}，实际输出 ${actualVersion}`,
  );

  const targetParent = dirname(targetOutputRoot);
  await mkdir(targetParent, { recursive: true });
  const temporaryRoot = await mkdtemp(join(targetParent, '.rivalhub-cs2-assets-'));
  const rawRoot = join(temporaryRoot, 'raw');
  const svgRoot = join(temporaryRoot, 'svg');
  const outputStagingRoot = join(temporaryRoot, 'generated');
  const outputPublicRoot = join(outputStagingRoot, 'public');
  const assets = {};
  try {
    const sourcePaths = catalog.items.flatMap((item) => {
      validateSourcePath(item.sourcePath);
      return [{ item, sourcePath: item.sourcePath }];
    });
    const occupiedPaths = new Map();
    for (const [index, { item, sourcePath }] of sourcePaths.entries()) {
      const rawExportRoot = join(rawRoot, `asset-${index}`);
      await mkdir(rawExportRoot, { recursive: true });
      const rawResult = await runCommand(launcher.command, [
        ...launcher.prefixArgs,
        '-i',
        input.vpk,
        '-o',
        rawExportRoot,
        '-e',
        RAW_EXTENSION.slice(1),
        '-f',
        sourcePath,
      ]);
      void rawResult;
      const rawPath = await findExportedRawFile(rawExportRoot, sourcePath);
      const sourceSha256 = await sha256File(rawPath);
      const svgPath = join(svgRoot, `${item.assetId}.svg`);
      const decompileResult = await runCommand(launcher.command, [
        ...launcher.prefixArgs,
        '-i',
        rawPath,
        '-o',
        svgPath,
        '-d',
      ]);
      void decompileResult;
      const outputBytes = normalizeSvg(await readFile(svgPath));
      const outputSha256 = await sha256(outputBytes);
      const outputPath = canonicalOutputPath(item, outputSha256, occupiedPaths);
      const destination = outputRecordPath(outputPublicRoot, outputPath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, outputBytes, 'utf8');
      assets[item.assetId] = {
        sourcePath,
        sourceSha256,
        outputPath,
        outputSha256,
        mediaType: 'image/svg+xml',
        tintMode: item.tintMode,
      };
    }

    const manifest = {
      schemaVersion: 1,
      source: {
        appId: 730,
        steamBuildId: input.steamBuildId,
        container: 'game/csgo/pak01_dir.vpk',
      },
      extractor: {
        project: toolchain.valveResourceFormat.project,
        tool: toolchain.valveResourceFormat.tool,
        version: toolchain.valveResourceFormat.version,
      },
      assets: Object.fromEntries(
        Object.entries(assets).sort(([left], [right]) => left.localeCompare(right)),
      ),
    };
    await writeFile(
      join(outputStagingRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await mkdir(join(outputPublicRoot, 'assets', 'cs2'), { recursive: true });
    await writeFile(
      join(outputPublicRoot, 'assets', 'cs2', 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    const broadcastManifestPath = join(packageRoot, 'generated', 'broadcast-assets.json');
    let hasBroadcastAssets = true;
    try {
      await access(broadcastManifestPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      hasBroadcastAssets = false;
    }
    if (hasBroadcastAssets) {
      const broadcastManifest = await readJson(broadcastManifestPath);
      await writeFile(
        join(outputStagingRoot, 'broadcast-assets.json'),
        `${JSON.stringify(broadcastManifest, null, 2)}\n`,
        'utf8',
      );
      for (const record of Object.values(broadcastManifest.assets ?? {})) {
        const relativePath = validateBroadcastOutputPath(record.outputPath);
        const source = join(packageRoot, 'generated', 'public', relativePath);
        const destination = outputRecordPath(outputPublicRoot, record.outputPath);
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination);
      }
    }
    // Verify the complete generated staging tree before atomic replacement
    await verifyCs2Assets({
      rootDir: repositoryRoot,
      generatedRoot: outputStagingRoot,
    });
    await replaceDirectoryTransactionally(outputStagingRoot, targetOutputRoot, options._fileOps);
    return { input, assets: Object.keys(assets).length, outputRoot: targetOutputRoot };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.radarOnly) {
    const { importRadarAssets } = await import('./radar.mjs');
    const input = await resolveInput(options);
    const cli = options.cli ?? process.env.SOURCE2VIEWER_CLI;
    assert(cli, '必须提供 --cli');
    const launcher = { command: cli, prefixArgs: [] };
    const toolchain = await readJson(TOOLCHAIN_PATH);
    const version = toolchain.valveResourceFormat.version;
    assert(
      versionMatches(await commandVersion(launcher), version),
      'Radar extractor version mismatch',
    );
    const result = await importRadarAssets({
      input,
      launcher,
      runCommand,
      version,
      target: options.output ?? join(PACKAGE_ROOT, 'generated'),
      replaceDirectoryTransactionally,
    });
    await verifyCs2Assets();
    console.log(`RADAR_ASSETS_IMPORT_PASS ${JSON.stringify(result)}`);
    return;
  }
  const result = await importCs2Assets({ options });
  await verifyCs2Assets({ generatedRoot: result.outputRoot });
  console.log(`CS2_ASSETS_IMPORT_PASS ${JSON.stringify(result)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(
      `CS2_ASSETS_IMPORT_FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
