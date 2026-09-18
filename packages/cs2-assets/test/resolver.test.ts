import { describe, expect, it } from 'vitest';

import {
  CS2_ASSET_MANIFEST,
  CS2_ITEM_CATALOG,
  getCs2Asset,
  getCs2Item,
  resolveCs2Item,
} from '../src/index.js';

describe('@rivalhub-broadcast/cs2-assets resolver', () => {
  it('keeps the checked-in catalog and manifest aligned', () => {
    expect(CS2_ITEM_CATALOG).toHaveLength(Object.keys(CS2_ASSET_MANIFEST.assets).length);
    for (const item of CS2_ITEM_CATALOG) {
      expect(getCs2Item(item.canonicalKey)).toEqual(item);
      expect(getCs2Asset(item.assetId)).toBeDefined();
    }
  });

  it('returns an explicit unknown result without guessing a filename', () => {
    expect(resolveCs2Item('weapon_future_unknown')).toEqual({
      kind: 'unknown',
      sourceWeaponId: 'weapon_future_unknown',
    });
  });

  it('resolves weapon, utility, objective and melee presentation metadata', () => {
    expect(resolveCs2Item('weapon_ak47')).toMatchObject({
      kind: 'known',
      item: { canonicalKey: 'weapon.ak47', ammoPresentation: 'magazine' },
    });
    expect(resolveCs2Item('weapon_flashbang')).toMatchObject({
      kind: 'known',
      item: { canonicalKey: 'utility.flashbang', ammoPresentation: 'utility' },
    });
    expect(resolveCs2Item('weapon_c4')).toMatchObject({
      kind: 'known',
      item: { canonicalKey: 'objective.c4', ammoPresentation: 'objective' },
    });
    expect(resolveCs2Item('weapon_knife')).toMatchObject({
      kind: 'known',
      item: { canonicalKey: 'weapon.knife', ammoPresentation: 'none' },
    });
  });

  it('uses only explicit aliases for legacy/current source ids', () => {
    expect(resolveCs2Item('weapon_p2000')).toMatchObject({
      kind: 'known',
      item: { canonicalKey: 'weapon.hkp2000' },
    });
    expect(resolveCs2Item('weapon_usp_silencer_off')).toEqual({
      kind: 'unknown',
      sourceWeaponId: 'weapon_usp_silencer_off',
    });
  });
});
