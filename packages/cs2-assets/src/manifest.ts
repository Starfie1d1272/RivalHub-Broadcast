import manifest from '../generated/manifest.json' with { type: 'json' };

import type { Cs2AssetManifest, Cs2AssetRecord } from './types.js';

export const CS2_ASSET_MANIFEST = manifest as Cs2AssetManifest;

export const CS2_ASSETS_BY_ID = new Map<string, Cs2AssetRecord>(
  Object.entries(CS2_ASSET_MANIFEST.assets),
);
