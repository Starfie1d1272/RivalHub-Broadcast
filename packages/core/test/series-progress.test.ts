import { describe, expect, it } from 'vitest';

import {
  createSeriesProgress,
  isSeriesProgressCheckpointCompatible,
  makeSeriesProgressCheckpoint,
  seriesMapPlanFingerprint,
  syncSeriesProgress,
  type SeriesProgressEvent,
  type SeriesSideProof,
} from '../src/series-progress/index.js';
import type { MatchContext } from '../src/match-context/index.js';

function contextFixture(format: MatchContext['format'] = 'bo3'): MatchContext {
  const mapNames =
    format === 'bo1'
      ? ['Mirage']
      : format === 'bo3'
        ? ['Mirage', 'Dust 2', 'de_inferno']
        : ['Mirage', 'Dust 2', 'de_inferno', 'de_overpass', 'de_vertigo'];
  const entrant = (entryId: 'a' | 'b', name: string) => ({
    entryId,
    name,
    logoUrl: null,
    rosterId: `${entryId}-roster`,
    players: [],
  });
  return {
    matchId: 'series-test',
    competition: {
      competitionId: 'competition-test',
      slug: 'series-test',
      name: 'Series Test',
      themeColor: null,
    },
    status: 'in_progress',
    format,
    stage: 'final',
    round: null,
    entryRound: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    scoreA: null,
    scoreB: null,
    isForfeit: false,
    entrants: { a: entrant('a', 'Alpha'), b: entrant('b', 'Bravo') },
    maps: mapNames.map((mapName, index) => ({
      mapId: `map-${index + 1}`,
      mapOrder: index + 1,
      mapName,
      pickedByEntryId: index === 0 ? 'a' : index === 1 ? 'b' : null,
      teamAStartSide: index === 0 ? 'CT' : 'T',
      scoreA: null,
      scoreB: null,
      completedAt: null,
    })),
    veto: [
      {
        stepOrder: 5,
        actionType: 'decider',
        mapName: 'de_inferno',
        entryId: null,
        side: null,
      },
    ],
    commentators: [],
  };
}

function observation(
  mapName: string,
  mapEpoch: number,
  score: { readonly ct: number | null; readonly t: number | null } = { ct: 0, t: 0 },
  roundWins: readonly {
    readonly roundNumber: number;
    readonly winnerSide: 'CT' | 'T' | 'unknown';
    readonly winCondition: 'elimination' | 'bomb' | 'defuse' | 'time' | 'unknown';
  }[] = [],
) {
  return {
    sourceGeneration: 0,
    mapEpoch,
    mapName,
    mapEnded: false,
    roundNumber: score.ct === null || score.t === null ? null : score.ct + score.t,
    score,
    roundWins,
  } as const;
}

function proof(mapEpoch: number, a: 'CT' | 'T' = 'CT'): SeriesSideProof {
  return {
    sourceGeneration: 0,
    mapEpoch,
    a,
    b: a === 'CT' ? 'T' : 'CT',
  };
}

function reduce(
  progress: ReturnType<typeof createSeriesProgress>,
  events: readonly SeriesProgressEvent[] = [],
  currentObservation = observation('Mirage', 1),
  currentProof: SeriesSideProof | null = proof(currentObservation.mapEpoch),
) {
  return syncSeriesProgress(progress, {
    events,
    observation: currentObservation,
    sideProof: currentProof,
  }).progress;
}

describe('SeriesProgress', () => {
  it('binds maps, freezes side-aware results, and marks the BO3 remainder not played', () => {
    const context = contextFixture();
    let progress = reduce(createSeriesProgress(context));
    expect(progress.maps[0]).toMatchObject({
      mapName: 'de_mirage',
      selection: { kind: 'pick', entryId: 'a' },
      status: 'current',
      executionMapEpoch: 1,
    });

    progress = reduce(
      progress,
      [
        {
          kind: 'round-ended',
          sourceGeneration: 0,
          mapEpoch: 1,
          roundNumber: 1,
          winnerSide: 'CT',
          winCondition: 'unknown',
        },
        {
          kind: 'map-ended',
          sourceGeneration: 0,
          mapEpoch: 1,
          finalScore: { ct: 13, t: 9 },
        },
      ],
      observation('Mirage', 1, { ct: 13, t: 9 }),
    );
    expect(progress.score).toEqual({ a: 1, b: 0 });
    expect(progress.maps[0]).toMatchObject({
      status: 'completed',
      finalScore: { a: 13, b: 9 },
      winnerEntryId: 'a',
      roundHistory: {
        rounds: [{ winnerSide: 'CT', winnerEntryId: 'a' }],
      },
    });

    progress = reduce(
      progress,
      [
        {
          kind: 'map-execution-changed',
          sourceGeneration: 0,
          mapEpoch: 2,
          previousMapEpoch: 1,
          previousMapName: 'Mirage',
          mapName: 'Dust 2',
          resetReason: null,
        },
      ],
      observation('dust2', 2),
    );
    expect(progress).toMatchObject({ currentMapOrder: 2, bindingState: 'bound' });

    progress = reduce(
      progress,
      [
        {
          kind: 'round-ended',
          sourceGeneration: 0,
          mapEpoch: 2,
          roundNumber: 1,
          winnerSide: 'CT',
          winCondition: 'unknown',
        },
        {
          kind: 'map-ended',
          sourceGeneration: 0,
          mapEpoch: 2,
          finalScore: { ct: 8, t: 13 },
        },
      ],
      observation('dust2', 2, { ct: 8, t: 13 }),
      proof(2, 'T'),
    );
    expect(progress.score).toEqual({ a: 2, b: 0 });
    expect(progress.maps[0]?.roundHistory.rounds[0]?.winnerEntryId).toBe('a');
    expect(progress.maps[1]).toMatchObject({ status: 'completed', finalScore: { a: 13, b: 8 } });
    expect(progress.maps[2]).toMatchObject({ status: 'not_played' });
    expect(progress.currentMapOrder).toBeNull();
  });

  it('fails closed on an unexpected map and supports a reasoned operator bind', () => {
    const context = contextFixture();
    let progress = reduce(createSeriesProgress(context), [], observation('de_overpass', 1));
    expect(progress).toMatchObject({ bindingState: 'needs_operator', currentMapOrder: null });
    expect(progress.score).toEqual({ a: 0, b: 0 });
    expect(progress.maps.every((map) => map.roundHistory.rounds.length === 0)).toBe(true);

    progress = reduce(
      progress,
      [
        {
          kind: 'operator-map-bind',
          sourceGeneration: 0,
          mapEpoch: 1,
          mapOrder: 1,
          mapName: 'de_overpass',
          reason: '赛事席确认当前服务端地图对应计划第一图',
        },
      ],
      observation('de_overpass', 1),
    );
    expect(progress).toMatchObject({ bindingState: 'bound', currentMapOrder: 1 });
    expect(progress.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'operator_bind_applied' })]),
    );

    const rejected = reduce(
      createSeriesProgress(context),
      [
        {
          kind: 'operator-map-bind',
          sourceGeneration: 0,
          mapEpoch: 1,
          mapOrder: 4,
          mapName: 'de_overpass',
          reason: '错误的计划序号',
        },
      ],
      observation('de_overpass', 1),
    );
    expect(rejected.bindingState).toBe('needs_operator');
    expect(rejected.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'operator_bind_rejected' })]),
    );
  });

  it('uses the BO5 threshold without creating another score owner', () => {
    const progress = createSeriesProgress(contextFixture('bo5'));
    expect(progress.requiredWins).toBe(3);
    expect(progress.score).toEqual({ a: 0, b: 0 });
    expect(progress.maps).toHaveLength(5);
  });

  it('keeps round_ended winner side primary and marks a conflicting snapshot partial', () => {
    const context = contextFixture('bo1');
    const wins = [
      { roundNumber: 1, winnerSide: 'CT' as const, winCondition: 'elimination' as const },
      { roundNumber: 2, winnerSide: 'T' as const, winCondition: 'defuse' as const },
      { roundNumber: 3, winnerSide: 'CT' as const, winCondition: 'bomb' as const },
    ];
    const progress = reduce(
      createSeriesProgress(context),
      [],
      observation('mirage', 1, { ct: 2, t: 1 }, wins),
    );
    expect(progress.maps[0]?.roundHistory).toEqual({
      completeness: 'complete',
      rounds: wins.map((round) => ({ ...round, winnerEntryId: null })),
    });

    const primaryProgress = reduce(
      createSeriesProgress(context),
      [
        {
          kind: 'round-ended',
          sourceGeneration: 0,
          mapEpoch: 1,
          roundNumber: 1,
          winnerSide: 'T',
          winCondition: 'unknown',
        },
      ],
      observation('mirage', 1, { ct: 2, t: 1 }, wins),
      proof(1, 'T'),
    );
    expect(primaryProgress.maps[0]?.roundHistory.rounds[0]).toMatchObject({
      winnerSide: 'T',
      winnerEntryId: 'a',
      winCondition: 'elimination',
    });
    expect(primaryProgress.maps[0]?.roundHistory.completeness).toBe('partial');
    expect(primaryProgress.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'round_history_partial' })]),
    );

    const recoveredProgress = reduce(
      createSeriesProgress(context),
      [],
      observation('mirage', 1, { ct: 2, t: 1 }, wins),
      null,
    );
    expect(recoveredProgress.maps[0]?.roundHistory).toEqual({
      completeness: 'complete',
      rounds: wins.map((round) => ({ ...round, winnerEntryId: null })),
    });

    const otProgress = reduce(
      createSeriesProgress(context),
      [],
      observation('mirage', 1, { ct: 5, t: 5 }, wins.slice(0, 2)),
    );
    expect(otProgress.maps[0]?.roundHistory.completeness).toBe('partial');
    expect(otProgress.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'round_history_partial' })]),
    );
  });

  it('downgrades restored history when the new execution is behind the checkpoint', () => {
    const context = contextFixture('bo1');
    const checkpointed = reduce(
      createSeriesProgress(context),
      [
        {
          kind: 'round-ended',
          sourceGeneration: 0,
          mapEpoch: 1,
          roundNumber: 1,
          winnerSide: 'CT',
          winCondition: 'elimination',
        },
        {
          kind: 'round-ended',
          sourceGeneration: 0,
          mapEpoch: 1,
          roundNumber: 2,
          winnerSide: 'T',
          winCondition: 'defuse',
        },
        {
          kind: 'round-ended',
          sourceGeneration: 0,
          mapEpoch: 1,
          roundNumber: 3,
          winnerSide: 'CT',
          winCondition: 'bomb',
        },
      ],
      observation('mirage', 1, { ct: 2, t: 1 }),
    );

    const restored = syncSeriesProgress(checkpointed, {
      events: [],
      observation: observation('mirage', 1, { ct: 0, t: 1 }, [
        { roundNumber: 1, winnerSide: 'CT', winCondition: 'elimination' },
      ]),
      sideProof: proof(1),
      restore: true,
    }).progress;

    expect(restored.maps[0]?.roundHistory.rounds).toHaveLength(3);
    expect(restored.maps[0]?.roundHistory.completeness).toBe('partial');
    expect(restored.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'round_history_partial' })]),
    );
  });

  it('keeps checkpoint identity canonical and caps round history', () => {
    const context = contextFixture();
    let progress = reduce(createSeriesProgress(context));
    const events = Array.from({ length: 257 }, (_, index) => ({
      kind: 'round-ended' as const,
      sourceGeneration: 0,
      mapEpoch: 1,
      roundNumber: index + 1,
      winnerSide: 'CT' as const,
      winCondition: 'unknown' as const,
    }));
    progress = reduce(progress, events, observation('mirage', 1, { ct: 130, t: 127 }));
    expect(progress.maps[0]?.roundHistory.rounds).toHaveLength(256);
    expect(progress.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'round_history_cap' })]),
    );

    const checkpoint = makeSeriesProgressCheckpoint(progress);
    expect(isSeriesProgressCheckpointCompatible(checkpoint, context)).toBe(true);
    expect(seriesMapPlanFingerprint(context)).toBe(checkpoint.identity.mapPlanFingerprint);
    expect(isSeriesProgressCheckpointCompatible(checkpoint, { ...context, matchId: 'other' })).toBe(
      false,
    );
    expect(
      isSeriesProgressCheckpointCompatible(
        {
          ...checkpoint,
          progress: { ...checkpoint.progress, matchId: 'other' },
        },
        context,
      ),
    ).toBe(false);
  });
});
