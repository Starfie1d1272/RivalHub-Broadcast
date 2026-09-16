import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  RADAR_CALIBRATION_REVISION,
  RADAR_CALIBRATIONS,
  SUPPORTED_RADAR_MAP_KEYS,
} from '../src/cs2-overview-calibrations.js';
import { classifyRadarLayer, projectWorldPosition } from '../src/map-geometry.js';

type MutableCalibration = {
  mapKey: string;
  posX: number;
  posY: number;
  scale: number;
  radarSize: number;
  layerRule: { kind: 'single' } | { kind: 'z-threshold'; splitZ: number };
};

type MutableSnapshot = Record<string, MutableCalibration>;

const EXPECTED_CALIBRATIONS = {
  de_dust2: {
    mapKey: 'de_dust2',
    posX: -2476,
    posY: 3239,
    scale: 4.4,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_mirage: {
    mapKey: 'de_mirage',
    posX: -3230,
    posY: 1713,
    scale: 5,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_inferno: {
    mapKey: 'de_inferno',
    posX: -2087,
    posY: 3870,
    scale: 4.9,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_nuke: {
    mapKey: 'de_nuke',
    posX: -3453,
    posY: 2887,
    scale: 7,
    radarSize: 1024,
    layerRule: { kind: 'z-threshold', splitZ: -495 },
  },
  de_ancient: {
    mapKey: 'de_ancient',
    posX: -2953,
    posY: 2164,
    scale: 5,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_anubis: {
    mapKey: 'de_anubis',
    posX: -2796,
    posY: 3328,
    scale: 5.22,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_cache: {
    mapKey: 'de_cache',
    posX: -2000,
    posY: 3250,
    scale: 5.5,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_overpass: {
    mapKey: 'de_overpass',
    posX: -4831,
    posY: 1781,
    scale: 5.2,
    radarSize: 1024,
    layerRule: { kind: 'single' },
  },
  de_train: {
    mapKey: 'de_train',
    posX: -2308,
    posY: 2078,
    scale: 4.082077,
    radarSize: 1024,
    layerRule: { kind: 'z-threshold', splitZ: -50 },
  },
  de_vertigo: {
    mapKey: 'de_vertigo',
    posX: -3168,
    posY: 1762,
    scale: 4,
    radarSize: 1024,
    layerRule: { kind: 'z-threshold', splitZ: 11700 },
  },
} as const;

type ProviderModule = typeof import('../src/default-map-geometry-provider.js');

let providerModule: ProviderModule;

beforeAll(async () => {
  providerModule = await import('../src/default-map-geometry-provider.js');
});

function cloneSnapshot(): MutableSnapshot {
  return Object.fromEntries(
    Object.entries(RADAR_CALIBRATIONS).map(([mapKey, calibration]) => [
      mapKey,
      {
        mapKey: calibration.mapKey,
        posX: calibration.posX,
        posY: calibration.posY,
        scale: calibration.scale,
        radarSize: calibration.radarSize,
        layerRule:
          calibration.layerRule.kind === 'single'
            ? { kind: 'single' }
            : { kind: 'z-threshold', splitZ: calibration.layerRule.splitZ },
      },
    ]),
  );
}

async function expectProviderImportToFail(
  mutate: (snapshot: MutableSnapshot) => void,
  expectedMessage: string | RegExp,
  revision: string = RADAR_CALIBRATION_REVISION,
): Promise<void> {
  vi.resetModules();
  const snapshot = cloneSnapshot();
  mutate(snapshot);
  vi.doMock('../src/cs2-overview-calibrations.js', () => ({
    RADAR_CALIBRATION_REVISION: revision,
    RADAR_CALIBRATIONS: snapshot,
    SUPPORTED_RADAR_MAP_KEYS,
  }));

  try {
    await expect(import('../src/default-map-geometry-provider.js')).rejects.toThrow(
      expectedMessage,
    );
  } finally {
    vi.doUnmock('../src/cs2-overview-calibrations.js');
    vi.resetModules();
  }
}

describe('default radar map geometry provider', () => {
  it('keeps the exact bounded calibration snapshot and revision', () => {
    expect(RADAR_CALIBRATION_REVISION).toBe('cs2-overview/2026-09-16');
    expect(SUPPORTED_RADAR_MAP_KEYS).toEqual(Object.keys(EXPECTED_CALIBRATIONS));
    expect(Object.keys(RADAR_CALIBRATIONS)).toEqual(Object.keys(EXPECTED_CALIBRATIONS));
    expect(RADAR_CALIBRATIONS).toEqual(EXPECTED_CALIBRATIONS);
  });

  it('resolves all supported maps and exposes no asset contract', () => {
    for (const mapKey of SUPPORTED_RADAR_MAP_KEYS) {
      const geometry = providerModule.defaultMapGeometryProvider.resolve(mapKey);

      expect(geometry).not.toBeNull();
      expect(geometry?.mapKey).toBe(mapKey);
      expect(geometry?.calibrationRevision).toBe(RADAR_CALIBRATION_REVISION);
      const calibration = RADAR_CALIBRATIONS[mapKey];
      expect(geometry).toMatchObject({
        originWorld: { x: calibration.posX, y: calibration.posY },
        scaleWorldUnitsPerPixel: calibration.scale,
        referenceSize: { width: calibration.radarSize, height: calibration.radarSize },
        layerRule: calibration.layerRule,
      });
      expect(Object.keys(geometry ?? {}).sort()).toEqual([
        'calibrationRevision',
        'layerRule',
        'mapKey',
        'originWorld',
        'referenceSize',
        'scaleWorldUnitsPerPixel',
      ]);
    }
  });

  it('supports only the explicit display aliases and rejects unknown maps', () => {
    const aliases = {
      dust2: 'de_dust2',
      'dust 2': 'de_dust2',
      'dust ii': 'de_dust2',
      mirage: 'de_mirage',
      inferno: 'de_inferno',
      nuke: 'de_nuke',
      ancient: 'de_ancient',
      anubis: 'de_anubis',
      cache: 'de_cache',
      overpass: 'de_overpass',
      train: 'de_train',
      vertigo: 'de_vertigo',
    } as const;

    for (const [alias, mapKey] of Object.entries(aliases)) {
      expect(providerModule.defaultMapGeometryProvider.resolve(alias)?.mapKey).toBe(mapKey);
      expect(
        providerModule.defaultMapGeometryProvider.resolve(`  ${alias.toUpperCase()} `)?.mapKey,
      ).toBe(mapKey);
    }

    for (const mapName of [null, '', 'de_workshop_custom', 'workshop/de_mirage', 'custom-map']) {
      expect(providerModule.defaultMapGeometryProvider.resolve(mapName)).toBeNull();
    }
  });

  it('preserves calibration landmarks and split-map layer thresholds', () => {
    const mirage = providerModule.defaultMapGeometryProvider.resolve('de_mirage');
    const nuke = providerModule.defaultMapGeometryProvider.resolve('de_nuke');
    const cache = providerModule.defaultMapGeometryProvider.resolve('de_cache');
    const train = providerModule.defaultMapGeometryProvider.resolve('de_train');
    const vertigo = providerModule.defaultMapGeometryProvider.resolve('de_vertigo');

    expect(mirage).not.toBeNull();
    expect(projectWorldPosition({ x: -3230, y: 1713, z: 0 }, mirage!)).toMatchObject({
      x: 0,
      y: 0,
      layer: 'single',
      outOfBounds: false,
    });
    const mirageBombA = projectWorldPosition({ x: -465.2, y: -2178.2, z: 0 }, mirage!);
    expect(mirageBombA?.x).toBeCloseTo(0.54, 12);
    expect(mirageBombA?.y).toBeCloseTo(0.76, 12);

    expect(nuke).not.toBeNull();
    expect(classifyRadarLayer(-496, nuke!)).toBe('lower');
    expect(classifyRadarLayer(-495, nuke!)).toBe('upper');
    expect(classifyRadarLayer(null, nuke!)).toBe('unknown');
    const nukeBombA = projectWorldPosition({ x: 704.44, y: -553.64, z: 0 }, nuke!);
    expect(nukeBombA?.x).toBeCloseTo(0.58, 12);
    expect(nukeBombA?.y).toBeCloseTo(0.48, 12);

    expect(cache).not.toBeNull();
    const cacheCenter = projectWorldPosition(
      { x: -2000 + (5.5 * 1024) / 2, y: 3250 - (5.5 * 1024) / 2, z: 0 },
      cache!,
    );
    expect(cacheCenter).toMatchObject({ x: 0.5, y: 0.5, outOfBounds: false, layer: 'single' });
    const cacheBombA = projectWorldPosition({ x: -169.6, y: 1785.68, z: 0 }, cache!);
    expect(cacheBombA?.x).toBeCloseTo(0.325, 12);
    expect(cacheBombA?.y).toBeCloseTo(0.26, 12);

    expect(train).not.toBeNull();
    expect(classifyRadarLayer(-51, train!)).toBe('lower');
    expect(classifyRadarLayer(-50, train!)).toBe('upper');
    expect(classifyRadarLayer(-49, train!)).toBe('upper');

    expect(vertigo).not.toBeNull();
    expect(classifyRadarLayer(11699, vertigo!)).toBe('lower');
    expect(classifyRadarLayer(11700, vertigo!)).toBe('upper');
    expect(classifyRadarLayer(11701, vertigo!)).toBe('upper');
  });

  it('fails during module initialization when snapshot metadata is malformed', async () => {
    await expectProviderImportToFail((snapshot) => {
      delete snapshot.de_dust2;
    }, 'snapshot keys must exactly match supported map keys');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_mirage!.mapKey = 'de_dust2';
    }, 'mapKey must equal de_mirage');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_dust2!.posX = Number.NaN;
    }, 'posX must be finite');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_dust2!.scale = 0;
    }, 'scale must be greater than zero');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_dust2!.radarSize = 0;
    }, 'radarSize must be greater than zero');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_nuke!.layerRule = { kind: 'z-threshold', splitZ: Number.NaN };
    }, 'splitZ must be finite');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_vertigo!.layerRule = { kind: 'z-threshold', splitZ: 11701 };
    }, 'splitZ must equal 11700');
    await expectProviderImportToFail((snapshot) => {
      snapshot.de_custom = { ...snapshot.de_dust2! };
    }, 'snapshot keys must exactly match supported map keys');
    await expectProviderImportToFail(() => undefined, 'calibrationRevision must not be empty', '');
  });
});
