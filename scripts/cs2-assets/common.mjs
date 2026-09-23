import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PACKAGE_ROOT = join(REPOSITORY_ROOT, 'packages', 'cs2-assets');
export const CATALOG_PATH = join(PACKAGE_ROOT, 'catalog', 'items.json');
export const MANIFEST_PATH = join(PACKAGE_ROOT, 'generated', 'manifest.json');
export const PUBLIC_ROOT = join(PACKAGE_ROOT, 'generated', 'public');
export const TOOLCHAIN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'toolchain.json');
export const ASSET_PATH_PREFIX = '/assets/cs2/';
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const ALLOWED_SOURCE_PREFIXES = Object.freeze([
  'panorama/images/icons/equipment/',
  'panorama/images/hud/ammo_',
  'panorama/images/hud/teamcounter/',
]);

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readCatalog(path = CATALOG_PATH) {
  return readJson(path);
}

export async function readManifest(path = MANIFEST_PATH) {
  return readJson(path);
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRelativePath(value) {
  return (
    typeof value === 'string' &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.includes('..')
  );
}

export function assertSorted(values, label) {
  const expected = [...values].sort((left, right) => left.localeCompare(right));
  assert(JSON.stringify(values) === JSON.stringify(expected), `${label} 必须按稳定字典序排列`);
}

export function validateCatalog(catalog) {
  assert(isRecord(catalog), 'catalog 必须是 JSON object');
  assert(catalog.schemaVersion === 1, 'catalog schemaVersion 必须为 1');
  assert(Array.isArray(catalog.items), 'catalog.items 必须是数组');

  const canonicalKeys = new Set();
  const assetIds = new Set();
  const gsiNames = new Map();
  const validKinds = new Set(['firearm', 'melee', 'utility', 'equipment', 'objective']);
  const validAmmo = new Set([
    'magazine',
    'shells',
    'reserve-rounds',
    'charge',
    'none',
    'utility',
    'objective',
  ]);
  const validEvidenceKinds = new Set(['live-gsi', 'official-game-data', 'official-release-note']);

  assertSorted(
    catalog.items.map((item) => item?.canonicalKey ?? ''),
    'catalog.items',
  );

  for (const [index, item] of catalog.items.entries()) {
    const label = `catalog.items[${index}]`;
    assert(isRecord(item), `${label} 必须是 object`);
    assert(
      typeof item.canonicalKey === 'string' && item.canonicalKey.length > 0,
      `${label}.canonicalKey 无效`,
    );
    assert(!canonicalKeys.has(item.canonicalKey), `canonicalKey 重复：${item.canonicalKey}`);
    canonicalKeys.add(item.canonicalKey);
    assert(Array.isArray(item.gsiWeaponNames), `${label}.gsiWeaponNames 必须是数组`);
    assert(Array.isArray(item.aliases), `${label}.aliases 必须是数组`);
    assert(
      item.kind === 'equipment' || item.gsiWeaponNames.length > 0,
      `${label} 缺少 gsiWeaponNames`,
    );
    assert(validKinds.has(item.kind), `${label}.kind 无效：${String(item.kind)}`);
    validateSourcePath(item.sourcePath);
    assert(typeof item.family === 'string' && item.family.length > 0, `${label}.family 无效`);
    assert(
      typeof item.displayCategory === 'string' && item.displayCategory.length > 0,
      `${label}.displayCategory 无效`,
    );
    assert(typeof item.assetId === 'string' && item.assetId.length > 0, `${label}.assetId 无效`);
    assert(!assetIds.has(item.assetId), `assetId 重复：${item.assetId}`);
    assetIds.add(item.assetId);
    assert(validAmmo.has(item.ammoPresentation), `${label}.ammoPresentation 无效`);
    assert(item.tintMode === 'mask' || item.tintMode === 'none', `${label}.tintMode 无效`);
    assert(Array.isArray(item.evidence), `${label}.evidence 必须是数组`);
    assert(item.evidence.length > 0, `${label} 必须至少包含一条 evidence`);

    for (const key of ['gsiWeaponNames', 'aliases']) {
      const values = item[key];
      assert(
        values.every((value) => typeof value === 'string' && value.length > 0),
        `${label}.${key} 含无效字符串`,
      );
      assertSorted(values, `${label}.${key}`);
      for (const value of values) {
        const owner = gsiNames.get(value);
        assert(
          owner === undefined || owner === item.canonicalKey,
          `GSI weapon name/alias 冲突：${value}`,
        );
        gsiNames.set(value, item.canonicalKey);
      }
    }

    for (const evidence of item.evidence) {
      assert(isRecord(evidence), `${label}.evidence 含无效项`);
      assert(validEvidenceKinds.has(evidence.kind), `${label}.evidence.kind 无效`);
      assert(
        typeof evidence.reference === 'string' && evidence.reference.length > 0,
        `${label}.evidence.reference 无效`,
      );
    }
  }

  return { canonicalKeys, assetIds, gsiNames };
}

export function validateSourcePath(sourcePath) {
  assert(
    isRelativePath(sourcePath),
    `sourcePath 必须是无机器路径的相对 POSIX path：${String(sourcePath)}`,
  );
  assert(sourcePath.endsWith('.vsvg_c'), `sourcePath 必须指向 .vsvg_c：${sourcePath}`);
  assert(
    ALLOWED_SOURCE_PREFIXES.some((prefix) => sourcePath.startsWith(prefix)),
    `sourcePath 不在 CS2 HUD allowlist：${sourcePath}`,
  );
}

export function validateOutputPath(outputPath) {
  assert(
    typeof outputPath === 'string' && outputPath.startsWith(ASSET_PATH_PREFIX),
    `outputPath 必须位于 ${ASSET_PATH_PREFIX}`,
  );
  const relativePath = outputPath.slice(1);
  assert(isRelativePath(relativePath), `outputPath 含无效路径：${outputPath}`);
  assert(
    relativePath.startsWith(ASSET_PATH_PREFIX.slice(1)),
    `outputPath 必须位于 ${ASSET_PATH_PREFIX}`,
  );
  assert(relativePath.endsWith('.svg'), `outputPath 必须是 SVG：${outputPath}`);
  assert(relativePath.includes('.'), `outputPath 必须包含 content hash：${outputPath}`);
  return relativePath;
}

export function validateBroadcastOutputPath(outputPath) {
  assert(
    typeof outputPath === 'string' && outputPath.startsWith(ASSET_PATH_PREFIX),
    `broadcast outputPath 必须位于 ${ASSET_PATH_PREFIX}`,
  );
  const relativePath = outputPath.slice(1);
  assert(isRelativePath(relativePath), `broadcast outputPath 含无效路径：${outputPath}`);
  assert(
    /^assets\/cs2\/(?:thumbnails|sides)\/[^/]+\.[a-f0-9]{12,64}\.(?:jpg|svg)$/.test(relativePath),
    `broadcast outputPath 必须是带内容 hash 的缩图或阵营 SVG：${outputPath}`,
  );
  return relativePath;
}

export async function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}
