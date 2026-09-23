import { verifyRadarAssets } from './radar.mjs';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_SOURCE_PREFIXES,
  CATALOG_PATH,
  MANIFEST_PATH,
  PACKAGE_ROOT,
  PUBLIC_ROOT,
  REPOSITORY_ROOT,
  SHA256_PATTERN,
  TOOLCHAIN_PATH,
  assert,
  isRecord,
  listFiles,
  readCatalog,
  readJson,
  readManifest,
  sha256File,
  validateCatalog,
  validateBroadcastOutputPath,
  validateOutputPath,
  validateSourcePath,
} from './common.mjs';

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertSortedObjectKeys(value, label) {
  const keys = Object.keys(value);
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  assert(JSON.stringify(keys) === JSON.stringify(expected), `${label} keys 必须按稳定字典序排列`);
}

function validateManifestShape(manifest, toolchain) {
  assert(isRecord(manifest), 'manifest 必须是 JSON object');
  assert(manifest.schemaVersion === 1, 'manifest schemaVersion 必须为 1');
  assert(isRecord(manifest.source), 'manifest.source 必须是 object');
  assert(manifest.source.appId === 730, 'manifest.source.appId 必须为 730');
  assert(
    /^\d+$/.test(manifest.source.steamBuildId) ||
      manifest.source.steamBuildId === 'pending-local-import',
    'manifest.source.steamBuildId 必须是 Steam build id',
  );
  assert(manifest.source.container === 'game/csgo/pak01_dir.vpk', 'manifest.source.container 无效');
  assert(isRecord(manifest.extractor), 'manifest.extractor 必须是 object');
  assert(
    manifest.extractor.project === toolchain.valveResourceFormat.project,
    'manifest extractor project 与 toolchain 不一致',
  );
  assert(
    manifest.extractor.tool === toolchain.valveResourceFormat.tool,
    'manifest extractor tool 与 toolchain 不一致',
  );
  assert(
    manifest.extractor.version === toolchain.valveResourceFormat.version,
    'manifest extractor version 与 toolchain 不一致',
  );
  assert(isRecord(manifest.assets), 'manifest.assets 必须是 object');
  assertSortedObjectKeys(manifest.assets, 'manifest.assets');
}

function validateAssetRecord(assetId, record) {
  const label = `manifest.assets.${assetId}`;
  assert(isRecord(record), `${label} 必须是 object`);
  validateSourcePath(record.sourcePath);
  assert(SHA256_PATTERN.test(record.sourceSha256), `${label}.sourceSha256 无效`);
  assert(SHA256_PATTERN.test(record.outputSha256), `${label}.outputSha256 无效`);
  const relativeOutputPath = validateOutputPath(record.outputPath);
  assert(record.mediaType === 'image/svg+xml', `${label}.mediaType 必须为 image/svg+xml`);
  assert(record.tintMode === 'mask' || record.tintMode === 'none', `${label}.tintMode 无效`);

  const hashMatch = /\.([a-f0-9]{12,64})\.svg$/.exec(basename(relativeOutputPath));
  assert(hashMatch !== null, `${label}.outputPath 必须以 12-64 位 content hash prefix 结尾`);
  const outputHashPrefix = hashMatch[1];
  assert(
    outputHashPrefix.length >= 12 &&
      outputHashPrefix.length <= 64 &&
      (outputHashPrefix.length - 12) % 4 === 0,
    `${label}.outputPath hash prefix 长度必须为 12/16/20/.../64`,
  );
  assert(
    record.outputSha256.startsWith(outputHashPrefix),
    `${label}.outputPath hash prefix 必须匹配 outputSha256`,
  );
  return relativeOutputPath;
}

export async function verifyCs2Assets({ rootDir = REPOSITORY_ROOT, generatedRoot } = {}) {
  const packageRoot = join(rootDir, relative(REPOSITORY_ROOT, PACKAGE_ROOT));
  const catalogPath = join(packageRoot, relative(PACKAGE_ROOT, CATALOG_PATH));
  const manifestPath = generatedRoot
    ? join(generatedRoot, 'manifest.json')
    : join(packageRoot, relative(PACKAGE_ROOT, MANIFEST_PATH));
  const publicRoot = generatedRoot
    ? join(generatedRoot, 'public')
    : join(packageRoot, relative(PACKAGE_ROOT, PUBLIC_ROOT));
  const toolchainPath = join(rootDir, relative(REPOSITORY_ROOT, TOOLCHAIN_PATH));
  const [catalog, manifest, toolchain] = await Promise.all([
    readCatalog(catalogPath),
    readManifest(manifestPath),
    readJson(toolchainPath),
  ]);
  const catalogIndexes = validateCatalog(catalog);
  validateManifestShape(manifest, toolchain);

  const magazineItem = catalog.items.find((item) => item.canonicalKey === 'ammo.magazine');
  if (magazineItem !== undefined) {
    const magazineAsset = manifest.assets[magazineItem.assetId];
    assert(
      magazineItem.assetId === 'ammo.magazine' &&
        magazineItem.sourcePath === 'panorama/images/hud/ammo_reserve_magazine.vsvg_c' &&
        magazineItem.ammoPresentation === 'magazine' &&
        magazineItem.gsiWeaponNames.length === 0,
      'ammo.magazine 必须映射 Valve 的 reserve-magazine HUD 图形且不得成为 GSI weapon identity',
    );
    assert(
      manifest.source.steamBuildId === '25218825',
      'ammo.magazine 必须来自 pinned Steam build 25218825',
    );
    assert(
      magazineAsset !== undefined &&
        magazineAsset.sourcePath === magazineItem.sourcePath &&
        SHA256_PATTERN.test(magazineAsset.sourceSha256) &&
        SHA256_PATTERN.test(magazineAsset.outputSha256),
      'ammo.magazine 必须在 manifest 记录 sourcePath 与 source/output SHA-256',
    );
  }

  const manifestAssetIds = new Set(Object.keys(manifest.assets));
  assert(
    JSON.stringify([...catalogIndexes.assetIds].sort()) ===
      JSON.stringify([...manifestAssetIds].sort()),
    'catalog assetId 集合必须与 manifest assets 集合完全一致',
  );

  const outputPaths = new Set();
  const expectedPublicFiles = new Set();
  for (const [assetId, record] of Object.entries(manifest.assets)) {
    const relativeOutputPath = validateAssetRecord(assetId, record);
    assert(!outputPaths.has(record.outputPath), `manifest outputPath 重复：${record.outputPath}`);
    outputPaths.add(record.outputPath);
    expectedPublicFiles.add(relativeOutputPath);
    const outputFile = join(publicRoot, relativeOutputPath);
    assert(await fileExists(outputFile), `manifest asset 文件不存在：${outputFile}`);
    const actualHash = await sha256File(outputFile);
    assert(actualHash === record.outputSha256, `asset output hash 不一致：${assetId}`);
    assert(
      record.sourcePath.startsWith(
        ALLOWED_SOURCE_PREFIXES.find((prefix) => record.sourcePath.startsWith(prefix)) ?? '',
      ),
      `sourcePath 不在 allowlist：${record.sourcePath}`,
    );
  }

  const radarManifest = join(dirname(publicRoot), 'radar-maps.json');
  if (await fileExists(radarManifest)) {
    for (const path of await verifyRadarAssets(dirname(publicRoot))) expectedPublicFiles.add(path);
  }
  const broadcastManifestPath = join(dirname(publicRoot), 'broadcast-assets.json');
  let broadcastAssets = 0;
  if (await fileExists(broadcastManifestPath)) {
    const broadcastManifest = await readJson(broadcastManifestPath);
    assert(isRecord(broadcastManifest), 'broadcast-assets manifest 必须是 JSON object');
    assert(broadcastManifest.schemaVersion === 1, 'broadcast-assets schemaVersion 必须为 1');
    assert(isRecord(broadcastManifest.assets), 'broadcast-assets.assets 必须是 object');
    assertSortedObjectKeys(broadcastManifest.assets, 'broadcast-assets.assets');
    for (const [assetId, record] of Object.entries(broadcastManifest.assets)) {
      const label = `broadcast-assets.assets.${assetId}`;
      assert(isRecord(record), `${label} 必须是 object`);
      assert(typeof record.sourceRepository === 'string', `${label}.sourceRepository 无效`);
      assert(/^[a-f0-9]{40}$/.test(record.sourceCommit), `${label}.sourceCommit 无效`);
      assert(
        typeof record.sourcePath === 'string' && record.sourcePath.length > 0,
        `${label}.sourcePath 无效`,
      );
      assert(
        typeof record.sourceUrl === 'string' && record.sourceUrl.includes(record.sourceCommit),
        `${label}.sourceUrl 必须固定到 sourceCommit`,
      );
      assert(SHA256_PATTERN.test(record.sourceSha256), `${label}.sourceSha256 无效`);
      assert(
        typeof record.transformation === 'string' && record.transformation.length > 0,
        `${label}.transformation 无效`,
      );
      assert(SHA256_PATTERN.test(record.outputSha256), `${label}.outputSha256 无效`);
      assert(record.owner === 'Valve / Counter-Strike 2 game asset', `${label}.owner 无效`);
      assert(
        record.mediaType === 'image/jpeg' || record.mediaType === 'image/svg+xml',
        `${label}.mediaType 无效`,
      );
      const relativeOutputPath = validateBroadcastOutputPath(record.outputPath);
      const hashMatch = /\.([a-f0-9]{12,64})\.(?:jpg|svg)$/.exec(record.outputPath);
      assert(
        hashMatch !== null && record.outputSha256.startsWith(hashMatch[1]),
        `${label}.outputPath hash 不匹配`,
      );
      expectedPublicFiles.add(relativeOutputPath);
      const outputFile = join(publicRoot, relativeOutputPath);
      assert(await fileExists(outputFile), `broadcast asset 文件不存在：${outputFile}`);
      assert(
        (await sha256File(outputFile)) === record.outputSha256,
        `broadcast asset output hash 不一致：${assetId}`,
      );
      broadcastAssets += 1;
    }
  }
  const publicFiles = await listFiles(publicRoot);
  for (const file of publicFiles) {
    const relativeFile = relative(publicRoot, file).replaceAll('\\', '/');
    if (relativeFile === '.gitkeep') continue;
    if (relativeFile === 'assets/cs2/manifest.json') {
      assert(
        (await readFile(file, 'utf8')) === `${JSON.stringify(manifest, null, 2)}\n`,
        'public manifest 必须与 generated/manifest.json 完全一致',
      );
      continue;
    }
    assert(
      expectedPublicFiles.has(relativeFile),
      `generated/public 存在未声明 orphan：${relativeFile}`,
    );
  }

  if (catalog.items.length === 0) {
    assert(
      manifest.assets && Object.keys(manifest.assets).length === 0,
      '空 catalog 不得有 manifest asset',
    );
  } else {
    assert(
      /^\d+$/.test(manifest.source.steamBuildId),
      '非空 production catalog 不得使用 pending-local-import',
    );
  }

  return {
    catalogItems: catalog.items.length,
    assets: Object.keys(manifest.assets).length,
    broadcastAssets,
    publicFiles: publicFiles.length,
  };
}

async function main() {
  const summary = await verifyCs2Assets();
  console.log(`CS2_ASSETS_VERIFY_PASS ${JSON.stringify(summary)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(
      `CS2_ASSETS_VERIFY_FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
