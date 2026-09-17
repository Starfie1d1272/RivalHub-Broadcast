import { describe, expect, it } from 'vitest';

import {
  classifyProgramWeapon,
  projectProgramCue,
  type RoleScopedGameEventObservation,
} from '../src/game-events/index.js';

type ProgramPlayerHurt = Extract<
  RoleScopedGameEventObservation<'program'>,
  { readonly kind: 'player-hurt' }
>;
type ProgramPlayerDeath = Extract<
  RoleScopedGameEventObservation<'program'>,
  { readonly kind: 'player-death' }
>;

const cursor = {
  kind: 'cs2-cstv' as const,
  role: 'program' as const,
  generation: 3,
  sequence: 41,
  tick: 12_345,
  observedAt: '2026-09-18T00:00:00.000Z',
  observedMonotonicMs: 100,
  mapName: 'de_mirage',
};

function player(sourcePlayerId?: string) {
  return {
    sourceUserId: 7,
    ...(sourcePlayerId === undefined ? {} : { sourcePlayerId }),
  };
}

function hurt(
  overrides: Partial<Omit<ProgramPlayerHurt, 'kind' | 'cursor'>> = {},
): ProgramPlayerHurt {
  return {
    kind: 'player-hurt',
    cursor,
    victim: player('76561198000000001'),
    attacker: player('76561198000000002'),
    weapon: 'hegrenade',
    healthRemaining: 34,
    armorRemaining: 0,
    damageHealth: 66,
    damageArmor: 0,
    hitgroup: 1,
    ...overrides,
  };
}

function death(
  overrides: Partial<Omit<ProgramPlayerDeath, 'kind' | 'cursor'>> = {},
): ProgramPlayerDeath {
  return {
    kind: 'player-death',
    cursor,
    victim: player('76561198000000001'),
    attacker: player('76561198000000002'),
    assister: player('76561198000000003'),
    weapon: 'awp',
    assistedFlash: true,
    headshot: true,
    penetratedObjects: 2,
    noScope: false,
    throughSmoke: true,
    attackerBlind: false,
    attackerInAir: true,
    distance: 42,
    damageHealth: 100,
    damageArmor: 0,
    hitgroup: 1,
    ...overrides,
  };
}

function project(observation: RoleScopedGameEventObservation<'program'>) {
  return projectProgramCue({
    observation,
    producerInstanceId: 'producer-a',
    mapEpoch: 2,
  });
}

describe('ProgramCue projector', () => {
  it.each([
    ['hegrenade', 'he'],
    ['weapon_hegrenade', 'he'],
    ['taser', 'zeus'],
    ['awp', 'sniper'],
    ['ssg08', 'sniper'],
    ['scar20', 'sniper'],
    ['g3sg1', 'sniper'],
    ['ak47', 'other'],
  ] as const)('classifies %s as %s', (weapon, family) => {
    expect(classifyProgramWeapon(weapon)).toBe(family);
  });

  it('projects supported impact families with deterministic source identity and id', () => {
    const cue = project(hurt({ healthRemaining: 0 }));

    expect(cue).toEqual({
      kind: 'player-impact',
      id: 'pc:producer-a:3:41',
      mapEpoch: 2,
      source: { generation: 3, sequence: 41, tick: 12_345 },
      effect: 'he',
      targetSourcePlayerId: '76561198000000001',
      attackerSourcePlayerId: '76561198000000002',
      weapon: 'hegrenade',
      damageHealth: 66,
      healthRemaining: 0,
      hitgroup: 1,
      lethal: true,
    });
  });

  it('projects elimination modifiers and keeps absent attacker evidence nullable', () => {
    const { attacker, assister, ...deathWithoutAssist } = death();
    void attacker;
    void assister;
    const cue = project({ ...deathWithoutAssist, weapon: 'knife' });

    expect(cue).toMatchObject({
      kind: 'player-elimination',
      victimSourcePlayerId: '76561198000000001',
      attackerSourcePlayerId: null,
      assisterSourcePlayerId: null,
      weapon: 'knife',
      weaponFamily: 'other',
      modifiers: {
        assistedFlash: true,
        headshot: true,
        penetratedObjects: 2,
        noScope: false,
        throughSmoke: true,
        attackerBlind: false,
        attackerInAir: true,
      },
    });
  });

  it('does not create ordinary hurt, unsupported event, or missing-target cues', () => {
    expect(project(hurt({ weapon: 'ak47' }))).toBeNull();
    expect(
      project({
        kind: 'weapon-fire',
        cursor,
        player: player('76561198000000002'),
        weapon: 'awp',
        silenced: false,
      }),
    ).toBeNull();
    expect(project(hurt({ victim: player('   ') }))).toBeNull();
    expect(project(death({ victim: player(undefined) }))).toBeNull();
  });

  it('does not accept a Lookahead-scoped observation at the Program projector boundary', () => {
    const lookahead = {
      ...hurt(),
      cursor: { ...cursor, role: 'lookahead' as const },
    } as RoleScopedGameEventObservation<'lookahead'>;

    expect(
      // @ts-expect-error Lookahead observations must not reach the Program projector.
      projectProgramCue({ observation: lookahead, producerInstanceId: 'producer-a', mapEpoch: 2 }),
    ).toBeNull();
  });
});
