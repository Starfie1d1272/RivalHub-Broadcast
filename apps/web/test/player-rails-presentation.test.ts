import { describe, expect, it } from 'vitest';

import { getProgramFixture } from '../src/program/fixtures';
import {
  buildPlayerRailsPresentation,
  lossBonusForConsecutiveRoundLosses,
} from '../src/program/widgets/player-rails/presentation';

function payload() {
  const snapshot = getProgramFixture('stress-long-labels');
  if (snapshot === null) throw new Error('fixture missing');
  return snapshot.payload;
}

describe('Player Rails presentation selector', () => {
  it('maps the frozen loss-bonus tiers and fails closed for invalid values', () => {
    expect([0, 1, 2, 3, 4, 8].map(lossBonusForConsecutiveRoundLosses)).toEqual([
      1_400, 1_900, 2_400, 2_900, 3_400, 3_400,
    ]);
    expect(lossBonusForConsecutiveRoundLosses(null)).toBeNull();
    expect(lossBonusForConsecutiveRoundLosses(-1)).toBeNull();
    expect(lossBonusForConsecutiveRoundLosses(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it('sorts by observer slot with source id tie-break and caps each rail at five cards', () => {
    const current = payload();
    const players = current.players.map((player, index) =>
      index === 0 || index === 4
        ? { ...player, observerSlot: null }
        : index === 1
          ? { ...player, observerSlot: 1 }
          : player,
    );
    players.push({ ...players[0]!, sourcePlayerId: 'stress-player-6' });
    const presentation = buildPlayerRailsPresentation({ ...current, players });

    expect(presentation.ct.players.map((player) => player.sourcePlayerId)).toEqual([
      'stress-player-2',
      'stress-player-3',
      'stress-player-4',
      'stress-player-1',
      'stress-player-5',
    ]);
    expect(presentation.ct.players).toHaveLength(5);
    expect(presentation.t.players).toHaveLength(5);
  });

  it('uses official assets and applies alive/dead phase presentation rules', () => {
    const current = payload();
    const freezetime = buildPlayerRailsPresentation({
      ...current,
      round: { phase: 'freezetime', winnerSide: 'unknown' },
      clock: { phase: 'freezetime', endsInSeconds: 12 },
      players: current.players.map((player) => ({
        ...player,
        currentRoundDamage: 72,
        roundMoneySpent: 1_200,
      })),
    });
    const pistolPlayer = freezetime.ct.players[1];
    expect(freezetime.phase).toBe('freezetime');
    expect(pistolPlayer?.primaryWeapon?.asset).not.toBeNull();
    expect(pistolPlayer?.secondaryWeapon?.asset).not.toBeNull();
    expect(pistolPlayer?.roundMoneySpent).toBe(1_200);

    const deadPlayer = freezetime.ct.players[2];
    expect(deadPlayer).toMatchObject({ mode: 'dead', primaryWeapon: null, utility: [] });
    expect(deadPlayer?.currentRoundDamage).toBe(72);
  });

  it('exposes complete five-player team totals and utility only with complete evidence', () => {
    const snapshot = getProgramFixture('series-bo1');
    if (snapshot === null) throw new Error('fixture missing');
    const presentation = buildPlayerRailsPresentation(snapshot.payload);

    expect(presentation.ct.summary).toMatchObject({
      lineupComplete: true,
      utilityAvailable: true,
      money: 35_550,
      equip: 20_200,
      utility: { smoke: 4, flash: 9 },
    });
  });

  it('withholds team subtotals until the current five-player lineup is complete', () => {
    const current = payload();
    const incomplete = buildPlayerRailsPresentation({
      ...current,
      players: current.players.filter((player) => player.sourcePlayerId !== 'stress-player-5'),
    });

    expect(incomplete.ct.summary).toMatchObject({
      lineupComplete: false,
      money: null,
      equip: null,
      utility: null,
      utilityAvailable: false,
    });
  });
});
