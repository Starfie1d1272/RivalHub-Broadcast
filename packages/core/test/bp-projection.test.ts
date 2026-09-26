import { describe, expect, it } from 'vitest';
import { projectBp } from '../src/projection/bp.js';
import type { MatchContext } from '../src/match-context/index.js';

// Synthetic presentation boundary: explicit side picks and incomplete facts.
const context: MatchContext = {
  matchId: 'bp-boundary',
  competition: { competitionId: 'c', slug: 'c', name: '比赛', themeColor: null },
  status: 'scheduled',
  format: 'bo3',
  stage: '决赛',
  round: null,
  entryRound: null,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  scoreA: null,
  scoreB: null,
  isForfeit: false,
  entrants: {
    a: { entryId: 'a', name: '完整左队名', logoUrl: null, rosterId: null, players: [] },
    b: { entryId: 'b', name: '完整右队名', logoUrl: null, rosterId: null, players: [] },
  },
  maps: [
    {
      mapId: 'm',
      mapOrder: 1,
      mapName: 'de_mirage',
      pickedByEntryId: null,
      teamAStartSide: 'CT',
      scoreA: null,
      scoreB: null,
      completedAt: null,
    },
  ],
  veto: [
    { stepOrder: 1, actionType: 'ban', mapName: 'de_nuke', entryId: 'a', side: null },
    { stepOrder: 2, actionType: 'decider', mapName: 'de_mirage', entryId: 'b', side: 'T' },
  ],
  commentators: [],
};
describe('BP canonical projection', () => {
  it.each(['bo1', 'bo3', 'bo5'] as const)(
    'preserves %s orientation and neutral decider, with independent sides',
    (format) => {
      const result = projectBp({ ...context, format })!;
      expect(result.format).toBe(format);
      expect(result.cards[1]).toEqual({
        kind: 'decider',
        mapName: 'de_mirage',
        entrant: null,
        startSides: { a: 'CT', b: 'T' },
      });
      expect(result.steps).toEqual([
        { cardIndex: 0, kind: 'card' },
        { cardIndex: 1, kind: 'card' },
        { cardIndex: 1, kind: 'start-side' },
      ]);
      expect(result.entrants.a.name).toBe('完整左队名');
      expect(result).not.toHaveProperty('commentators');
      expect(result.entrants.a).not.toHaveProperty('players');
    },
  );
  it('does not guess missing sides from embedded pick/decider side', () => {
    expect(projectBp({ ...context, maps: [] })!.cards[1]!.startSides).toBeNull();
    expect(projectBp({ ...context, maps: [] })!.steps).toHaveLength(2);
  });
  it('places explicit side_pick at its canonical position without duplicating it', () => {
    const result = projectBp({
      ...context,
      veto: [
        ...context.veto,
        { stepOrder: 3, actionType: 'side_pick', mapName: 'de_mirage', entryId: 'b', side: 'T' },
      ],
    });
    expect(result!.steps).toHaveLength(3);
    expect(result!.cards[1]!.startSides).toEqual({ a: 'CT', b: 'T' });
  });
  it('fails closed for conflicting sides, foreign entrants, duplicate maps or empty context', () => {
    expect(
      projectBp({
        ...context,
        veto: [
          ...context.veto,
          { stepOrder: 3, actionType: 'side_pick', mapName: 'de_mirage', entryId: 'b', side: 'CT' },
        ],
      }),
    ).toBeNull();
    expect(
      projectBp({ ...context, veto: [{ ...context.veto[0]!, entryId: 'foreign' }] }),
    ).toBeNull();
    expect(
      projectBp({ ...context, veto: [...context.veto, { ...context.veto[0]!, stepOrder: 3 }] }),
    ).toBeNull();
    expect(projectBp(undefined)).toBeNull();
  });
});
