import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyCs2Assets } from './verify.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeFixture({ mutateCatalog, mutateManifest } = {}) {
  const root = await mkdtemp(join(process.cwd(), '.agent-tmp-cs2-assets-test-'));
  temporaryRoots.push(root);
  const packageRoot = join(root, 'packages', 'cs2-assets');
  const publicRoot = join(packageRoot, 'generated', 'public', 'assets', 'cs2', 'weapon');
  await mkdir(publicRoot, { recursive: true });
  await mkdir(join(packageRoot, 'generated', 'public', 'assets', 'cs2'), { recursive: true });
  await mkdir(join(root, 'scripts', 'cs2-assets'), { recursive: true });

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">\n</svg>\n';
  const outputSha256 = createHash('sha256').update(svg).digest('hex');
  const outputPath = `/assets/cs2/weapon/ak47.${outputSha256.slice(0, 12)}.svg`;
  await writeFile(join(packageRoot, 'generated', 'public', outputPath.slice(1)), svg);
  const catalog = {
    schemaVersion: 1,
    items: [
      {
        canonicalKey: 'weapon.ak47',
        gsiWeaponNames: ['weapon_ak47'],
        sourcePath: 'panorama/images/icons/equipment/ak47.vsvg_c',
        kind: 'firearm',
        family: 'rifle',
        displayCategory: 'rifle',
        assetId: 'weapon.ak47',
        ammoPresentation: 'magazine',
        tintMode: 'mask',
        aliases: [],
        evidence: [{ kind: 'live-gsi', reference: 'fixture' }],
      },
    ],
  };
  mutateCatalog?.(catalog);
  const manifest = {
    schemaVersion: 1,
    source: { appId: 730, steamBuildId: '123456', container: 'game/csgo/pak01_dir.vpk' },
    extractor: { project: 'ValveResourceFormat', tool: 'Source2Viewer-CLI', version: '20.0' },
    assets: {
      'weapon.ak47': {
        sourcePath: 'panorama/images/icons/equipment/ak47.vsvg_c',
        sourceSha256: 'a'.repeat(64),
        outputPath,
        outputSha256,
        mediaType: 'image/svg+xml',
        tintMode: 'mask',
      },
    },
  };
  mutateManifest?.(manifest);
  await mkdir(join(packageRoot, 'catalog'), { recursive: true });
  await writeFile(
    join(packageRoot, 'catalog', 'items.json'),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  await mkdir(join(packageRoot, 'generated'), { recursive: true });
  await writeFile(
    join(packageRoot, 'generated', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(packageRoot, 'generated', 'public', 'assets', 'cs2', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(root, 'scripts', 'cs2-assets', 'toolchain.json'),
    `${JSON.stringify({ valveResourceFormat: manifest.extractor }, null, 2)}\n`,
  );
  return root;
}

describe('cs2-assets verify', () => {
  it('verifies a deterministic checked-in asset fixture', async () => {
    const root = await writeFixture();
    await expect(verifyCs2Assets({ rootDir: root })).resolves.toMatchObject({
      catalogItems: 1,
      assets: 1,
    });
  });

  it('rejects an output hash mismatch', async () => {
    const root = await writeFixture({
      mutateManifest: (manifest) => {
        manifest.assets['weapon.ak47'].outputSha256 = 'b'.repeat(64);
      },
    });
    await expect(verifyCs2Assets({ rootDir: root })).rejects.toThrow(
      'outputPath 必须包含 outputSha256',
    );
  });

  it('rejects a catalog-known item when its manifest asset is missing', async () => {
    const root = await writeFixture({
      mutateManifest: (manifest) => {
        delete manifest.assets['weapon.ak47'];
      },
    });
    await expect(verifyCs2Assets({ rootDir: root })).rejects.toThrow(
      'catalog assetId 集合必须与 manifest assets 集合完全一致',
    );
  });

  it('rejects duplicate GSI weapon names or aliases across catalog items', async () => {
    const root = await writeFixture({
      mutateCatalog: (catalog) => {
        catalog.items.push({
          ...catalog.items[0],
          canonicalKey: 'weapon.ak47-duplicate',
          assetId: 'weapon.ak47-duplicate',
          gsiWeaponNames: ['weapon_ak47_alt'],
          aliases: ['weapon_ak47'],
        });
      },
    });
    await expect(verifyCs2Assets({ rootDir: root })).rejects.toThrow(
      'GSI weapon name/alias 冲突：weapon_ak47',
    );
  });
});
