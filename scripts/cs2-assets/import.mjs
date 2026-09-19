import { Buffer } from 'node:buffer';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  readCatalog,
  readJson,
  sha256,
  sha256File,
  validateCatalog,
  validateSourcePath,
} from './common.mjs';

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
  const isWindowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindowsBatch,
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

async function commandVersion(cli) {
  const result = await runCommand(cli, ['--version']);
  return `${result.stdout}\n${result.stderr}`.trim();
}

function versionMatches(actual, expected) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^0-9])${escaped}(?:$|[^0-9])`).test(actual);
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

function canonicalOutputPath(item, outputSha256) {
  const category = item.kind === 'firearm' || item.kind === 'melee' ? 'weapon' : item.kind;
  const slug = item.assetId.replace(/^[^.]+\./, '');
  return `/assets/cs2/${category}/${slug}.${outputSha256.slice(0, 12)}.svg`;
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

async function atomicReplaceDirectory(sourceDirectory, targetDirectory) {
  const backup = `${targetDirectory}.previous-${process.pid}`;
  await rm(backup, { recursive: true, force: true });
  try {
    await rename(targetDirectory, backup);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await rename(sourceDirectory, targetDirectory);
  } catch (error) {
    try {
      await rename(backup, targetDirectory);
    } catch {
      // Preserve the original error; the recovery failure is reported by the caller's next verify.
    }
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
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
  const actualVersion = await commandVersion(cli);
  const expectedVersion = toolchain.valveResourceFormat.version;
  assert(
    versionMatches(actualVersion, expectedVersion),
    `Source2Viewer-CLI 版本不匹配：期望 ${expectedVersion}，实际输出 ${actualVersion}`,
  );

  const temporaryRoot = await mkdtemp(join(repositoryRoot, '.agent-tmp-cs2-assets-'));
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
    for (const [index, { item, sourcePath }] of sourcePaths.entries()) {
      const rawExportRoot = join(rawRoot, `asset-${index}`);
      await mkdir(rawExportRoot, { recursive: true });
      const rawResult = await runCommand(cli, [
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
      const decompileResult = await runCommand(cli, ['-i', rawPath, '-o', svgPath, '-d']);
      void decompileResult;
      const outputBytes = normalizeSvg(await readFile(svgPath));
      const outputSha256 = await sha256(outputBytes);
      const outputPath = canonicalOutputPath(item, outputSha256);
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
    await atomicReplaceDirectory(outputStagingRoot, targetOutputRoot);
    return { input, assets: Object.keys(assets).length, outputRoot: targetOutputRoot };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await importCs2Assets({ options });
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
