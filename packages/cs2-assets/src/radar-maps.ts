import manifest from '../generated/radar-maps.json' with { type: 'json' };

export interface RadarMapAsset {
  readonly outputPath: string;
  readonly outputSha256: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}
export interface RadarMapAssetSet {
  readonly overview: RadarMapAsset;
  readonly upper?: RadarMapAsset;
  readonly lower?: RadarMapAsset;
}
export const RADAR_MAP_ASSETS: Readonly<Record<string, RadarMapAssetSet>> = manifest.maps;

export function getRadarMapAsset(mapKey: string, layer: string): RadarMapAsset | null {
  const map = RADAR_MAP_ASSETS[mapKey];
  if (!map) return null;
  if (layer === 'upper') return map.upper ?? null;
  if (layer === 'lower') return map.lower ?? null;
  return map.overview;
}
