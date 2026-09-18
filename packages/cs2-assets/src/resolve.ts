import { CS2_ITEMS_BY_CANONICAL_KEY, CS2_ITEMS_BY_SOURCE_WEAPON_ID } from './catalog.js';
import { CS2_ASSETS_BY_ID } from './manifest.js';
import type { Cs2AssetResolution } from './types.js';

export function getCs2Item(canonicalKey: string) {
  return CS2_ITEMS_BY_CANONICAL_KEY.get(canonicalKey);
}

export function getCs2Asset(assetId: string) {
  return CS2_ASSETS_BY_ID.get(assetId);
}

export function resolveCs2Item(sourceWeaponId: string): Cs2AssetResolution {
  const item = CS2_ITEMS_BY_SOURCE_WEAPON_ID.get(sourceWeaponId);
  if (item === undefined) return { kind: 'unknown', sourceWeaponId };

  const asset = getCs2Asset(item.assetId);
  if (asset === undefined) {
    throw new Error(`CS2 asset manifest missing catalog asset: ${item.assetId}`);
  }

  return { kind: 'known', item, asset };
}
