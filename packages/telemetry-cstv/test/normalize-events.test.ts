import { describe, expect, it } from 'vitest';

import { normalizeGameEvent } from '../src/index.js';

const cursor = {
  kind: 'cs2-cstv' as const,
  role: 'program' as const,
  generation: 2,
  sequence: 7,
  tick: 1234,
  observedAt: '2026-09-16T00:00:00.000Z',
  observedMonotonicMs: 9001,
  mapName: 'de_mirage',
  ticksPerSecond: 64,
};

function player(name: string, teamNumber = 3) {
  return { steamId: `7656119800000000${name.length}`, name, teamNumber };
}

describe('CSTV game-event normalization', () => {
  it('copies scalar player evidence and keeps no raw player object reference', () => {
    const victim = player('Victim');
    const event = normalizeGameEvent(
      'player_death',
      {
        userid: 11,
        player: victim,
        attacker: 22,
        attackerPlayer: player('Attacker', 2),
        assister: 0,
        weapon: 'ak47',
        assistedflash: false,
        headshot: true,
        penetrated: 0,
        noscope: false,
        thrusmoke: true,
        attackerblind: false,
        attackerinair: false,
        distance: 42.5,
        dmg_health: 100,
        dmg_armor: 0,
        hitgroup: 1,
      },
      { cursor },
    );

    expect(event).toMatchObject({
      kind: 'player-death',
      cursor,
      victim: {
        sourceUserId: 11,
        sourcePlayerId: victim.steamId,
        displayName: 'Victim',
        side: 'CT',
      },
      attacker: { sourceUserId: 22, displayName: 'Attacker', side: 'T' },
      weapon: 'ak47',
      headshot: true,
    });
    expect(event).not.toHaveProperty('assister');

    victim.name = 'Changed after callback';
    if (event.kind !== 'player-death') throw new Error('expected player-death');
    expect(event).toMatchObject({ victim: { displayName: 'Victim' } });
    expect(event.victim).not.toBe(victim);
  });

  it.each([
    [
      'player_hurt',
      {
        userid: 1,
        player: player('Hurt'),
        attacker: 2,
        attackerPlayer: player('Hit'),
        weapon: 'glock',
        health: 40,
        armor: 10,
        dmg_health: 60,
        dmg_armor: 5,
        hitgroup: 2,
      },
    ],
    ['weapon_fire', { userid: 1, player: player('Shooter'), weapon: 'm4a1', silenced: true }],
    ['grenade_thrown', { userid: 1, player: player('Thrower'), weapon: 'smokegrenade' }],
    ['bomb_beginplant', { userid: 1, player: player('Planter'), site: 1 }],
    ['bomb_abortplant', { userid: 1, player: player('Planter'), site: 1 }],
    ['bomb_planted', { userid: 1, player: player('Planter'), site: 1, c4: 100 }],
    ['bomb_begindefuse', { userid: 1, player: player('Defuser'), haskit: true }],
    ['bomb_abortdefuse', { userid: 1, player: player('Defuser') }],
    ['bomb_defused', { userid: 1, player: player('Defuser'), site: 1, c4: 100 }],
    ['bomb_exploded', { userid: 1, player: player('Planter'), site: 1, c4: 100 }],
    ['bomb_dropped', { userid: 1, player: player('Planter'), entindex: 100 }],
    ['bomb_pickup', { userid_pawn: 1001 }],
  ] as const)('normalizes supported %s events', (eventName, payload) => {
    const event = normalizeGameEvent(eventName, payload, { cursor });
    expect(event.cursor).toBe(cursor);
    expect(event.kind).toMatch(/^(?:player|weapon|grenade|bomb)-/);
  });

  it('rejects malformed required fields so the live session can diagnose and continue', () => {
    expect(() =>
      normalizeGameEvent(
        'weapon_fire',
        { userid: 1, player: player('Shooter'), weapon: 'm4a1' },
        { cursor },
      ),
    ).toThrow('event field silenced is not a boolean');
  });
});
