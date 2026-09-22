import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './common.mjs';
import {
  parseOverview,
  resolveOverviewTexture,
  supportedRadarMaps,
  verifyRadarAssets,
} from './radar.mjs';

describe('official Radar map import', () => {
  it('verifies all supported maps, metadata, hashes and floors offline', async () => {
    expect(await supportedRadarMaps()).toHaveLength(10);
    expect((await verifyRadarAssets()).size).toBe(13);
  });
  it('resolves texture references and lower floors from Valve metadata', async () => {
    const raw = await readFile(join(PACKAGE_ROOT, 'generated/radar-overviews/de_nuke.txt'), 'utf8');
    const parsed = parseOverview(raw, 'de_nuke');
    expect(parsed.verticalsections.lower.AltitudeMax).toBe('-495');
    const resource = 'panorama/images/overheadmaps/de_nuke_lower_radar_psd.vtex_c';
    expect(resolveOverviewTexture(parsed, 'lower', new Set([resource]))).toBe(resource);
    expect(() => resolveOverviewTexture(parsed, 'lower', new Set())).toThrow('unavailable');
    expect(() => parseOverview(raw, 'de_mirage')).toThrow('identity');
    expect(() => parseOverview('"de_nuke" { "material" "../../unsafe" }', 'de_nuke')).toThrow();
  });
});
