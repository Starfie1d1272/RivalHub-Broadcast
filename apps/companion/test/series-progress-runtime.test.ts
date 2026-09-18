import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { MatchContext } from '@rivalhub-broadcast/core/match-context';
import type {
  SeriesProgressCheckpoint,
  SeriesProgressCheckpointStore,
  SeriesSideProof,
} from '@rivalhub-broadcast/core/series-progress';
import type { TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';

import { createProgramRuntime } from '../src/runtime/program-runtime.js';
import { JsonSeriesProgressCheckpointStore } from '../src/series-progress/checkpoint-store.js';

function contextFixture(): MatchContext {
  const entrant = (entryId: 'a' | 'b', name: string) => ({
    entryId,
    name,
    logoUrl: null,
    rosterId: null,
    players: [],
  });
  return {
    matchId: 'runtime-series',
    competition: {
      competitionId: 'runtime-series-competition',
      slug: 'runtime-series',
      name: 'Runtime Series',
      themeColor: null,
    },
    status: 'in_progress',
    format: 'bo3',
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
    maps: [1, 2, 3].map((mapOrder) => ({
      mapId: `map-${mapOrder}`,
      mapOrder,
      mapName: ['de_mirage', 'de_dust2', 'de_inferno'][mapOrder - 1]!,
      pickedByEntryId: null,
      teamAStartSide: 'CT' as const,
      scoreA: null,
      scoreB: null,
      completedAt: null,
    })),
    veto: [],
    commentators: [],
  };
}

function frame(
  sequence: number,
  phase: 'live' | 'gameover',
  roundPhase: 'freezetime' | 'live' | 'over',
  score: { readonly ct: number; readonly t: number },
  winnerSide?: 'CT' | 'T',
): TelemetryObservation {
  return {
    receive: {
      sequence,
      receivedAt: `2026-09-18T00:00:00.00${sequence}Z`,
      receivedMonotonicMs: sequence,
    },
    source: { kind: 'cs2-gsi' },
    coverage: {
      provider: 'present',
      map: 'present',
      round: 'present',
      phaseCountdowns: 'absent',
      player: 'absent',
      allPlayers: 'absent',
      bomb: 'absent',
      grenades: 'absent',
    },
    telemetry: {
      map: {
        name: 'de_mirage',
        phase,
        roundNumber: 1,
        sides: { ct: { score: score.ct }, t: { score: score.t } },
      },
      round: {
        phase: roundPhase,
        ...(winnerSide === undefined ? {} : { winnerSide }),
      },
    },
  };
}

class MemoryCheckpointStore implements SeriesProgressCheckpointStore {
  checkpoint: SeriesProgressCheckpoint | undefined;

  load(): SeriesProgressCheckpoint | undefined {
    return this.checkpoint;
  }

  save(checkpoint: SeriesProgressCheckpoint): void {
    this.checkpoint = structuredClone(checkpoint);
  }

  async flush(): Promise<void> {}
}

const sideProof: SeriesSideProof = {
  sourceGeneration: 0,
  mapEpoch: 1,
  a: 'CT',
  b: 'T',
};

describe('ProgramRuntime SeriesProgress composition', () => {
  it('feeds reliable transitions once and immediately freezes a local map result', () => {
    const context = contextFixture();
    const runtime = createProgramRuntime('series-runtime');
    runtime.acceptObservation(frame(1, 'live', 'freezetime', { ct: 0, t: 0 }));
    runtime.synchronizeSeriesProgress(context, sideProof);
    runtime.acceptObservation(frame(2, 'live', 'live', { ct: 0, t: 0 }));
    runtime.acceptObservation(frame(3, 'live', 'over', { ct: 0, t: 0 }));
    runtime.acceptObservation(frame(4, 'gameover', 'over', { ct: 13, t: 9 }));

    const progress = runtime.synchronizeSeriesProgress(context, sideProof);
    expect(progress?.score).toEqual({ a: 1, b: 0 });
    expect(progress?.maps[0]).toMatchObject({
      status: 'completed',
      finalScore: { a: 13, b: 9 },
      winnerEntryId: 'a',
    });

    runtime.acceptObservation(frame(5, 'gameover', 'over', { ct: 13, t: 9 }));
    const repeated = runtime.synchronizeSeriesProgress(context, sideProof);
    expect(repeated).toEqual(progress);
  });

  it('restores a completed local map from a compatible checkpoint without MatchContext score writeback', () => {
    const context = contextFixture();
    const store = new MemoryCheckpointStore();
    const first = createProgramRuntime('series-runtime', {
      seriesProgressCheckpointStore: store,
    });
    first.acceptObservation(frame(1, 'live', 'freezetime', { ct: 0, t: 0 }));
    first.synchronizeSeriesProgress(context, sideProof);
    first.acceptObservation(frame(2, 'live', 'live', { ct: 0, t: 0 }));
    first.acceptObservation(frame(3, 'live', 'over', { ct: 0, t: 0 }));
    first.acceptObservation(frame(4, 'gameover', 'over', { ct: 13, t: 9 }));
    first.synchronizeSeriesProgress(context, sideProof);
    expect(store.checkpoint?.progress.score).toEqual({ a: 1, b: 0 });

    const restarted = createProgramRuntime('new-process', {
      seriesProgressCheckpointStore: store,
    });
    const restored = restarted.synchronizeSeriesProgress(context, null);
    expect(restored?.score).toEqual({ a: 1, b: 0 });
    expect(restored?.maps[0]?.finalScore).toEqual({ a: 13, b: 9 });
  });

  it('flushes the real async JSON checkpoint before a process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rivalhub-series-checkpoint-'));
    const checkpointPath = join(directory, 'series-progress.json');
    try {
      const context = contextFixture();
      const first = createProgramRuntime('series-runtime', {
        seriesProgressCheckpointStore: new JsonSeriesProgressCheckpointStore({
          filePath: checkpointPath,
        }),
      });
      first.acceptObservation(frame(1, 'live', 'freezetime', { ct: 0, t: 0 }));
      first.synchronizeSeriesProgress(context, sideProof);
      first.acceptObservation(frame(2, 'live', 'live', { ct: 0, t: 0 }));
      first.acceptObservation(frame(3, 'live', 'over', { ct: 0, t: 0 }));
      first.acceptObservation(frame(4, 'gameover', 'over', { ct: 13, t: 9 }));
      first.synchronizeSeriesProgress(context, sideProof);
      await first.close();

      expect(JSON.parse(await readFile(checkpointPath, 'utf8'))).toMatchObject({
        progress: { score: { a: 1, b: 0 } },
      });

      const restarted = createProgramRuntime('new-process', {
        seriesProgressCheckpointStore: new JsonSeriesProgressCheckpointStore({
          filePath: checkpointPath,
        }),
      });
      restarted.acceptObservation(frame(5, 'gameover', 'over', { ct: 13, t: 9 }));
      const restored = restarted.synchronizeSeriesProgress(context, null);
      await restarted.close();

      expect(restored?.score).toEqual({ a: 1, b: 0 });
      expect(restored?.maps[0]?.status).toBe('completed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps restore reconciliation pending until the first post-restart map observation', () => {
    const context = contextFixture();
    const store = new MemoryCheckpointStore();
    const first = createProgramRuntime('series-runtime', {
      seriesProgressCheckpointStore: store,
    });
    first.acceptObservation(frame(1, 'live', 'freezetime', { ct: 0, t: 0 }));
    first.synchronizeSeriesProgress(context, sideProof);
    first.acceptObservation(frame(2, 'live', 'live', { ct: 0, t: 0 }));
    first.acceptObservation(frame(3, 'live', 'over', { ct: 0, t: 0 }, 'CT'));
    const checkpointed = first.synchronizeSeriesProgress(context, sideProof);
    expect(checkpointed?.maps[0]?.roundHistory.completeness).toBe('complete');

    const restarted = createProgramRuntime('new-process', {
      seriesProgressCheckpointStore: store,
    });
    const withoutTelemetry = restarted.synchronizeSeriesProgress(context, null);
    expect(withoutTelemetry?.maps[0]?.roundHistory.completeness).toBe('complete');

    restarted.acceptObservation(frame(4, 'live', 'freezetime', { ct: 0, t: 0 }));
    const reconciled = restarted.synchronizeSeriesProgress(context, null);
    expect(reconciled?.maps[0]?.roundHistory.completeness).toBe('partial');
    expect(reconciled?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'round_history_partial' })]),
    );
  });
});
