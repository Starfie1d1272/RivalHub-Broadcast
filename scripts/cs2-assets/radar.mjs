import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { basename, dirname, join, relative } from 'node:path';
import {
  assert,
  PACKAGE_ROOT,
  REPOSITORY_ROOT,
  readJson,
  sha256,
  sha256File,
  listFiles,
  TOOLCHAIN_PATH,
} from './common.mjs';

/** Maintainer-only reader; the Radar registry remains the sole supported-map list. */
export async function supportedRadarMaps(root = REPOSITORY_ROOT) {
  const source = await readFile(
    join(root, 'packages/radar/src/cs2-overview-calibrations.ts'),
    'utf8',
  );
  const body = /SUPPORTED_RADAR_MAP_KEYS\s*=\s*\[([^\]]+)\]/.exec(source)?.[1];
  assert(body, 'Radar canonical registry not found');
  return [...body.matchAll(/'(de_[a-z0-9]+)'/g)].map((m) => m[1]);
}

export function normalizeOverviewText(raw) {
  const text = raw
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trimEnd();
  return text + '\n';
}

export function parseOverview(text, mapKey) {
  const tokens = text.replace(/\/\/[^\r\n]*/g, '').match(/"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+/g) ?? [];
  let i = 0;
  const token = () => {
    const v = tokens[i++];
    assert(v !== undefined, 'Truncated overview');
    return v.startsWith('"') ? JSON.parse(v) : v;
  };
  const object = () => {
    const result = {};
    while (i < tokens.length && tokens[i] !== '}') {
      const key = token();
      assert(!Object.hasOwn(result, key), `Duplicate overview key: ${key}`);
      const value = token();
      result[key] = value === '{' ? object() : value;
    }
    assert(token() === '}', 'Unclosed overview');
    return result;
  };
  assert(token() === mapKey && token() === '{', 'Overview map identity mismatch');
  const value = object();
  assert(i === tokens.length, 'Trailing overview content');
  assert(
    typeof value.material === 'string' && /^overviews\/de_[a-z0-9_]+$/.test(value.material),
    'Invalid overview material reference',
  );
  for (const key of ['pos_x', 'pos_y', 'scale'])
    assert(
      typeof value[key] === 'string' && Number.isFinite(Number(value[key])),
      `Invalid overview ${key}`,
    );
  assert(Number(value.scale) > 0, 'Invalid overview scale');
  if (value.verticalsections) {
    assert(
      value.verticalsections.default &&
        value.verticalsections.lower &&
        Object.keys(value.verticalsections).length === 2,
      'Unsupported vertical sections',
    );
    for (const section of Object.values(value.verticalsections))
      for (const k of ['AltitudeMin', 'AltitudeMax'])
        assert(Number.isFinite(Number(section[k])), `Invalid ${k}`);
    assert(
      Number(value.verticalsections.default.AltitudeMin) ===
        Number(value.verticalsections.lower.AltitudeMax),
      'Non-contiguous floors',
    );
  }
  return value;
}

/** Valve overview material + section -> compiled Panorama PSD resource.
 * This Source 2 resource naming rule is confined to the controlled importer.
 * Legacy *_tga resources do not replace the current PSD material resource.
 */
export function resolveOverviewTexture(overview, section, available) {
  // App 730 build 25218825 retains a Source 1 material alias in de_dust2.txt;
  // its VPK contains exactly the current de_dust2 PSD resource, no *_v2 resource.
  const material =
    overview.material === 'overviews/de_dust2_v2' ? 'overviews/de_dust2' : overview.material;
  const stem = basename(material).replace(/_radar$/, '');
  const resource = `panorama/images/overheadmaps/${stem}${section === 'lower' ? '_lower' : ''}_radar_psd.vtex_c`;
  assert(available.has(resource), `Overview texture reference unavailable: ${resource}`);
  return resource;
}

export async function importRadarAssets({
  input,
  launcher,
  runCommand,
  version,
  target,
  replaceDirectoryTransactionally,
}) {
  const temp = await mkdtemp(join(dirname(target), '.radar-import-'));
  const staging = join(temp, 'generated');
  try {
    await cp(target, staging, { recursive: true });
    await rm(join(staging, 'public/assets/cs2/maps'), { recursive: true, force: true });
    await rm(join(staging, 'radar-overviews'), { recursive: true, force: true });
    const listing = await runCommand(launcher.command, [
      ...launcher.prefixArgs,
      '-i',
      input.vpk,
      '--vpk_list',
    ]);
    const available = new Set(
      listing.stdout.split(/\r?\n/).map((line) => line.trim().split(' ')[0]),
    );
    const maps = {};
    const metadata = {};
    for (const mapKey of await supportedRadarMaps()) {
      const sourcePath = `resource/overviews/${mapKey}.txt`;
      const metadataPath = join(staging, 'radar-overviews', `${mapKey}.txt`);
      await mkdir(dirname(metadataPath), { recursive: true });
      await runCommand(launcher.command, [
        ...launcher.prefixArgs,
        '-i',
        input.vpk,
        '-o',
        metadataPath,
        '-f',
        sourcePath,
      ]);
      const rawText = await readFile(metadataPath, 'utf8');
      const normalizedText = normalizeOverviewText(rawText);
      await writeFile(metadataPath, normalizedText, 'utf8');
      const overview = parseOverview(normalizedText, mapKey);
      metadata[mapKey] = {
        sourcePath,
        sourceSha256: await sha256(Buffer.from(normalizedText, 'utf8')),
        material: overview.material,
        posX: Number(overview.pos_x),
        posY: Number(overview.pos_y),
        scale: Number(overview.scale),
        verticalSections: overview.verticalsections ?? null,
      };
      const assets = {};
      for (const section of overview.verticalsections ? ['default', 'lower'] : ['default']) {
        const texture = resolveOverviewTexture(overview, section, available);
        const raw = join(temp, `${mapKey}-${section}.vtex_c`);
        const png = join(temp, `${mapKey}-${section}.png`);
        await runCommand(launcher.command, [
          ...launcher.prefixArgs,
          '-i',
          input.vpk,
          '-o',
          raw,
          '-f',
          texture,
        ]);
        await runCommand(launcher.command, [...launcher.prefixArgs, '-i', raw, '-o', png, '-d']);
        const bytes = await readFile(png);
        assert(
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          'Expected PNG',
        );
        assert(
          bytes.readUInt32BE(16) === 1024 && bytes.readUInt32BE(20) === 1024,
          'Overview raster must match 1024 calibration',
        );
        const outputSha256 = await sha256(bytes);
        const outputPath = `/assets/cs2/maps/${mapKey}-${section}.${outputSha256.slice(0, 12)}.png`;
        const output = join(staging, 'public', outputPath.slice(1));
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, bytes);
        assets[section === 'default' ? 'overview' : 'lower'] = {
          sourcePath: texture,
          sourceSha256: await sha256File(raw),
          outputPath,
          outputSha256,
        };
      }
      if (overview.verticalsections) assets.upper = assets.overview;
      maps[mapKey] = assets;
    }
    const manifest = {
      schemaVersion: 1,
      source: {
        appId: 730,
        steamBuildId: input.steamBuildId,
        container: 'game/csgo/pak01_dir.vpk',
      },
      extractor: { tool: 'Source2Viewer-CLI', version },
      metadata,
      maps,
    };
    await writeFile(join(staging, 'radar-maps.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyRadarAssets(staging);
    await replaceDirectoryTransactionally(staging, target);
    return { maps: Object.keys(maps).length, outputRoot: target };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function verifyRadarAssets(generatedRoot = join(PACKAGE_ROOT, 'generated')) {
  const manifest = await readJson(join(generatedRoot, 'radar-maps.json'));
  const toolchain = await readJson(TOOLCHAIN_PATH);
  assert(
    manifest.schemaVersion === 1 &&
      manifest.source?.appId === 730 &&
      /^\d+$/.test(manifest.source.steamBuildId),
    'Invalid Radar asset provenance',
  );
  assert(
    manifest.extractor?.version === toolchain.valveResourceFormat.version,
    'Radar toolchain mismatch',
  );
  const keys = await supportedRadarMaps();
  assert(
    JSON.stringify(Object.keys(manifest.maps).sort()) === JSON.stringify([...keys].sort()),
    'Radar map coverage differs from canonical registry',
  );
  const expected = new Set();
  for (const key of keys) {
    const meta = manifest.metadata[key];
    const file = join(generatedRoot, 'radar-overviews', `${key}.txt`);
    const fileContent = await readFile(file, 'utf8');
    assert((await sha256File(file)) === meta.sourceSha256, `Overview hash mismatch: ${key}`);
    assert(
      (await sha256(Buffer.from(normalizeOverviewText(fileContent), 'utf8'))) === meta.sourceSha256,
      `Overview canonical hash mismatch: ${key}`,
    );
    const overview = parseOverview(fileContent, key);
    assert(
      meta.material === overview.material &&
        meta.posX === Number(overview.pos_x) &&
        meta.posY === Number(overview.pos_y) &&
        meta.scale === Number(overview.scale) &&
        JSON.stringify(meta.verticalSections) === JSON.stringify(overview.verticalsections ?? null),
      `Overview metadata mismatch: ${key}`,
    );
    const assets = manifest.maps[key];
    assert(assets.overview, `Missing overview: ${key}`);
    if (overview.verticalsections) assert(assets.upper && assets.lower, `Missing floor: ${key}`);
    for (const [layer, asset] of Object.entries(assets)) {
      assert(['overview', 'upper', 'lower'].includes(layer), 'Unknown asset layer');
      assert(
        /^\/assets\/cs2\/maps\/de_[a-z0-9]+-(default|lower)\.[a-f0-9]{12}\.png$/.test(
          asset.outputPath,
        ),
        'Invalid map output path',
      );
      assert(
        /^[a-f0-9]{64}$/.test(asset.sourceSha256) && /^[a-f0-9]{64}$/.test(asset.outputSha256),
        'Missing map hash',
      );
      assert(
        asset.sourcePath ===
          resolveOverviewTexture(
            overview,
            layer === 'lower' ? 'lower' : 'default',
            new Set([asset.sourcePath]),
          ),
        'Map resource mismatch',
      );
      assert(
        asset.outputPath.includes(asset.outputSha256.slice(0, 12)),
        'Map filename hash mismatch',
      );
      assert(
        (await sha256File(join(generatedRoot, 'public', asset.outputPath.slice(1)))) ===
          asset.outputSha256,
        'Map output hash mismatch',
      );
      expected.add(asset.outputPath.slice(1));
    }
  }
  for (const file of await listFiles(join(generatedRoot, 'public/assets/cs2/maps')))
    assert(
      expected.has(relative(join(generatedRoot, 'public'), file).replaceAll('\\', '/')),
      `Orphan map: ${file}`,
    );
  return expected;
}
