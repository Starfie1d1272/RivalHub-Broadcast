import manifest from '../generated/broadcast-assets.json' with { type: 'json' };

export interface BroadcastAsset {
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly sourcePath: string;
  readonly sourceUrl: string;
  readonly sourceSha256: string;
  readonly transformation: string;
  readonly outputPath: string;
  readonly outputSha256: string;
  readonly mediaType: 'image/jpeg' | 'image/svg+xml';
  readonly owner: 'Valve / Counter-Strike 2 game asset';
}

export const BROADCAST_ASSETS = manifest.assets as Readonly<Record<string, BroadcastAsset>>;

export function getBroadcastAsset(id: string): BroadcastAsset | null {
  return BROADCAST_ASSETS[id] ?? null;
}

export function getMapThumbnail(mapKey: string): BroadcastAsset | null {
  return getBroadcastAsset(`map.${mapKey}`);
}

export function getSideLogo(side: 'CT' | 'T'): BroadcastAsset | null {
  return getBroadcastAsset(`side.${side.toLowerCase()}`);
}
