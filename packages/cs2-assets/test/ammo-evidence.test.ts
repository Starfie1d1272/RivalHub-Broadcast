import { describe, expect, it } from 'vitest';

import { CS2_ITEM_CATALOG, getCs2Item, resolveCs2ItemByGsiName } from '../src/index.js';

describe('@rivalhub-broadcast/cs2-assets ammo evidence matrix', () => {
  it('strictly maps HUD-relevant weapon and item presentation metadata to official evidence', () => {
    // 1. SSG08 => magazine (official game-data m_bReserveAmmoAsClips = true)
    const ssg08 = getCs2Item('weapon.ssg08');
    expect(ssg08).toBeDefined();
    expect(ssg08?.ammoPresentation).toBe('magazine');

    // 2. Shotguns: MAG-7 => magazine, Nova/XM1014/Sawed-Off => shells
    const mag7 = getCs2Item('weapon.mag7');
    expect(mag7).toBeDefined();
    expect(mag7?.ammoPresentation).toBe('magazine');

    const nova = getCs2Item('weapon.nova');
    expect(nova).toBeDefined();
    expect(nova?.ammoPresentation).toBe('shells');

    const xm1014 = getCs2Item('weapon.xm1014');
    expect(xm1014).toBeDefined();
    expect(xm1014?.ammoPresentation).toBe('shells');

    const sawedoff = getCs2Item('weapon.sawedoff');
    expect(sawedoff).toBeDefined();
    expect(sawedoff?.ammoPresentation).toBe('shells');

    // 3. Machine guns: M249 => magazine, Negev => magazine
    const m249 = getCs2Item('weapon.m249');
    expect(m249).toBeDefined();
    expect(m249?.ammoPresentation).toBe('magazine');

    const negev = getCs2Item('weapon.negev');
    expect(negev).toBeDefined();
    expect(negev?.ammoPresentation).toBe('magazine');

    // 4. Melee: knife => none
    const knife = getCs2Item('weapon.knife');
    expect(knife).toBeDefined();
    expect(knife?.ammoPresentation).toBe('none');

    // 5. Utility: flashbang, HE, smoke, molotov, incendiary => utility
    const flashbang = getCs2Item('utility.flashbang');
    expect(flashbang).toBeDefined();
    expect(flashbang?.ammoPresentation).toBe('utility');

    const he = getCs2Item('utility.hegrenade');
    expect(he).toBeDefined();
    expect(he?.ammoPresentation).toBe('utility');

    const smoke = getCs2Item('utility.smokegrenade');
    expect(smoke).toBeDefined();
    expect(smoke?.ammoPresentation).toBe('utility');

    const molotov = getCs2Item('utility.molotov');
    expect(molotov).toBeDefined();
    expect(molotov?.ammoPresentation).toBe('utility');

    const incgrenade = getCs2Item('utility.incgrenade');
    expect(incgrenade).toBeDefined();
    expect(incgrenade?.ammoPresentation).toBe('utility');

    // 6. Objective: C4 => objective
    const c4 = getCs2Item('objective.c4');
    expect(c4).toBeDefined();
    expect(c4?.ammoPresentation).toBe('objective');
  });

  it('proves that ammo presentation is strictly per-item metadata and forbids family-wide heuristics', () => {
    // Shotgun family: MAG-7 has clip reload and reserve clips; others reload per shell
    const shotguns = CS2_ITEM_CATALOG.filter((item) => item.family === 'shotgun');
    expect(shotguns.length).toBeGreaterThanOrEqual(4);
    const shotgunAmmoTypes = new Set(shotguns.map((item) => item.ammoPresentation));
    expect(shotgunAmmoTypes.has('magazine')).toBe(true);
    expect(shotgunAmmoTypes.has('shells')).toBe(true);
    expect(shotgunAmmoTypes.size).toBe(2);

    // Machinegun family: M249 and Negev both report magazine, not reserve-rounds
    const machineguns = CS2_ITEM_CATALOG.filter((item) => item.family === 'machinegun');
    expect(machineguns.length).toBe(2);
    for (const mg of machineguns) {
      expect(mg.ammoPresentation).toBe('magazine');
    }

    // Sniper rifle family: each item has explicit official game-data evidence
    const snipers = CS2_ITEM_CATALOG.filter((item) => item.family === 'sniper-rifle');
    expect(snipers.length).toBeGreaterThanOrEqual(4);
    for (const sniper of snipers) {
      expect(sniper.ammoPresentation).toBe('magazine');
    }
  });

  it('keeps Zeus/Taser without artificial numeric charge or local recharge timers', () => {
    // Zeus has no stable GSI numeric charge contract; presentation must remain none
    const taser = getCs2Item('utility.taser');
    expect(taser).toBeDefined();
    expect(taser?.ammoPresentation).toBe('none');

    const resolution = resolveCs2ItemByGsiName('weapon_taser');
    expect(resolution).toMatchObject({
      kind: 'known',
      item: {
        canonicalKey: 'utility.taser',
        ammoPresentation: 'none',
      },
    });
  });

  it('distinguishes sanitized real-derived GSI evidence from official game-data evidence', () => {
    // H&K P2000 has explicit sanitized real-derived GSI evidence in the repository
    const hkp2000 = getCs2Item('weapon.hkp2000');
    expect(hkp2000).toBeDefined();
    expect(hkp2000?.ammoPresentation).toBe('magazine');
    const liveGsiEvidence = hkp2000?.evidence.find((e) => e.kind === 'live-gsi');
    expect(liveGsiEvidence).toBeDefined();
    expect(liveGsiEvidence?.reference).toContain(
      'packages/telemetry-gsi/test/fixtures/real-derived.ts',
    );

    // Standard rifles and pistols without dedicated live GSI fixtures cite official game-data evidence
    const officialGameDataWeapons = [
      'weapon.ak47',
      'weapon.m4a1',
      'weapon.m4a1-silencer',
      'weapon.mp9',
      'weapon.awp',
      'weapon.glock',
      'weapon.usp-silencer',
      'weapon.galilar',
    ];

    for (const canonicalKey of officialGameDataWeapons) {
      const item = getCs2Item(canonicalKey);
      expect(item).toBeDefined();
      expect(item?.ammoPresentation).toBe('magazine');
      expect(item?.evidence.length).toBeGreaterThanOrEqual(1);

      // Must cite official game data, not fabricate non-existent live-gsi references
      const officialData = item?.evidence.find((e) => e.kind === 'official-game-data');
      expect(officialData).toBeDefined();
      expect(officialData?.reference).toContain('Steam build 25218825');
    }
  });

  it('resolves items by GSI weapon names consistent with the ammo evidence matrix', () => {
    expect(resolveCs2ItemByGsiName('weapon_ssg08')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'magazine' },
    });
    expect(resolveCs2ItemByGsiName('weapon_nova')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'shells' },
    });
    expect(resolveCs2ItemByGsiName('weapon_xm1014')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'shells' },
    });
    expect(resolveCs2ItemByGsiName('weapon_sawedoff')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'shells' },
    });
    expect(resolveCs2ItemByGsiName('weapon_mag7')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'magazine' },
    });
    expect(resolveCs2ItemByGsiName('weapon_m249')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'magazine' },
    });
    expect(resolveCs2ItemByGsiName('weapon_negev')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'magazine' },
    });
    expect(resolveCs2ItemByGsiName('weapon_knife')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'none' },
    });
    expect(resolveCs2ItemByGsiName('weapon_c4')).toMatchObject({
      kind: 'known',
      item: { ammoPresentation: 'objective' },
    });
  });
});
