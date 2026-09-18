import catalogFile from '../catalog/items.json' with { type: 'json' };

import type { Cs2ItemCatalogFile, Cs2ItemMetadata } from './types.js';

export const CS2_ITEM_CATALOG_FILE = catalogFile as Cs2ItemCatalogFile;
export const CS2_ITEM_CATALOG: readonly Cs2ItemMetadata[] = CS2_ITEM_CATALOG_FILE.items;

export const CS2_ITEMS_BY_CANONICAL_KEY = new Map(
  CS2_ITEM_CATALOG.map((item) => [item.canonicalKey, item] as const),
);

const sourceWeaponIdIndex = new Map<string, Cs2ItemMetadata>();
for (const item of CS2_ITEM_CATALOG) {
  for (const sourceWeaponId of [...item.sourceWeaponIds, ...item.aliases]) {
    sourceWeaponIdIndex.set(sourceWeaponId, item);
  }
}

export const CS2_ITEMS_BY_SOURCE_WEAPON_ID = sourceWeaponIdIndex;
