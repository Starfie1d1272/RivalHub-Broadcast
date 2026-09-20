import { describe, expect, it } from 'vitest';

import { emptyActiveLineup, unboundIdentityResolution } from '../src/identity/index.js';
import { projectProgram, selectProgramSafeRuntimeView } from '../src/projection/index.js';
import {
  createInitialRuntimeState,
  reduceRuntime,
  type RuntimeContinuityPolicy,
} from '../src/runtime/index.js';
import type {
  BombState,
  CountdownPhase,
  ObservedPlayer,
  TelemetryObservation,
} from '../src/telemetry/index.js';

const POLICY: RuntimeContinuityPolicy = {
  staleAfterMs: 20_000,
  objectiveClockLeaseMs: 1_000,
};

function player(sourcePlayerId: string, hasDefuser: boolean): ObservedPlayer {
  return {
    sourcePlayerId,
    side: 'CT',
    state: { hasDefuser },
  };
}

function observation(
  sequence: number,
  receivedMonotonicMs: number,
  options: {
    readonly bombState?: BombState;
    readonly countdownSeconds?: number;
    readonly sourcePlayerId?: string;
    readonly bombCoverage?: 'present' | 'absent' | 'degraded';
    readonly phase?: CountdownPhase;
    readonly phaseEndsSeconds?: number;
    readonly roundPhase?: 'live' | 'over';
    readonly allPlayers?: readonly ObservedPlayer[];
    readonly player?: ObservedPlayer;
  } = {},
): TelemetryObservation {
  const bombCoverage = options.bombCoverage ?? 'present';
  const hasBomb = bombCoverage === 'present';
  return {
    receive: {
      sequence,
      receivedAt: new Date(
        Date.parse('2026-09-21T00:00:00.000Z') + receivedMonotonicMs,
      ).toISOString(),
      receivedMonotonicMs,
    },
    source: { kind: 'cs2-gsi' },
    coverage: {
      provider: 'present',
      map: 'present',
      round: 'present',
      phaseCountdowns: options.phase === undefined ? 'absent' : 'present',
      player: options.player === undefined ? 'absent' : 'present',
      allPlayers: options.allPlayers === undefined ? 'absent' : 'present',
      bomb: bombCoverage,
      grenades: 'absent',
    },
    telemetry: {
      map: { name: 'de_mirage', phase: 'live' },
      round: { phase: options.roundPhase ?? 'live' },
      ...(options.phase === undefined
        ? {}
        : {
            phaseCountdowns: {
              phase: options.phase,
              ...(options.phaseEndsSeconds === undefined
                ? {}
                : { endsInSeconds: options.phaseEndsSeconds }),
            },
          }),
      ...(options.allPlayers === undefined ? {} : { allPlayers: options.allPlayers }),
      ...(options.player === undefined ? {} : { player: options.player }),
      ...(hasBomb
        ? {
            bomb: {
              state: options.bombState ?? 'unknown',
              ...(options.countdownSeconds === undefined
                ? {}
                : { countdownSeconds: options.countdownSeconds }),
              ...(options.sourcePlayerId === undefined
                ? {}
                : { sourcePlayerId: options.sourcePlayerId }),
            },
          }
        : {}),
    },
  };
}

function accept(
  state: ReturnType<typeof createInitialRuntimeState>,
  frame: TelemetryObservation,
  sourceGeneration = state.programSource.generation,
) {
  return reduceRuntime(
    state,
    { kind: 'program-telemetry', sourceGeneration, observation: frame },
    POLICY,
  ).state;
}

function project(
  state: ReturnType<typeof createInitialRuntimeState>,
  nowMonotonicMs: number,
  continuityPolicy = POLICY,
) {
  return projectProgram({
    runtime: selectProgramSafeRuntimeView(state),
    identity: unboundIdentityResolution(),
    activeLineup: emptyActiveLineup(state.programSource.generation, state.map.epoch),
    nowMonotonicMs,
    continuityPolicy,
  });
}

describe('objective timing normalization', () => {
  it('keeps explosion time across defusing and derives kit duration only from player evidence', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(
      state,
      observation(2, 1_000, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', true)],
      }),
    );

    expect(state.objectiveTiming.explosionAnchor).toMatchObject({
      remainingSecondsAtSample: 30,
      sampledAtMonotonicMs: 0,
    });
    expect(project(state, 1_000).bomb).toEqual({
      state: 'defusing',
      sourcePlayerId: 'defuser',
      explosion: { remainingSeconds: 29, durationSeconds: null },
      action: {
        kind: 'defuse',
        sourcePlayerId: 'defuser',
        remainingSeconds: 5,
        durationSeconds: 5,
        hasDefuseKit: true,
      },
    });
  });

  it('does not synthesize an explosion clock when the first frame is defusing', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(
      state,
      observation(1, 0, {
        bombState: 'defusing',
        countdownSeconds: 9,
        sourcePlayerId: 'defuser',
        phase: 'defuse',
        phaseEndsSeconds: 9,
        allPlayers: [player('defuser', false)],
      }),
    );

    expect(project(state, 0).bomb).toMatchObject({
      explosion: null,
      action: {
        kind: 'defuse',
        durationSeconds: 10,
        hasDefuseKit: false,
      },
    });
  });

  it('recalibrates from a new planted sample without smoothing or restarting on defuse', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(
      state,
      observation(2, 1_000, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', false)],
      }),
    );
    state = accept(state, observation(3, 2_000, { bombState: 'planted', countdownSeconds: 20 }));
    state = accept(
      state,
      observation(4, 3_000, {
        bombState: 'defusing',
        countdownSeconds: 8,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', false)],
      }),
    );

    expect(project(state, 3_000).bomb?.explosion).toEqual({
      remainingSeconds: 19,
      durationSeconds: null,
    });
    expect(project(state, 3_000).bomb?.action?.remainingSeconds).toBe(8);
  });

  it('accepts a newer planted sample as an authoritative upward recalibration', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(state, observation(2, 1_000, { bombState: 'planted', countdownSeconds: 35 }));

    expect(state.objectiveTiming.explosionAnchor).toMatchObject({
      remainingSecondsAtSample: 35,
      sampledAtMonotonicMs: 1_000,
    });
    expect(project(state, 1_000).bomb?.explosion?.remainingSeconds).toBe(35);
  });

  it('clears the plant action and explosion on a plant abort', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planting', countdownSeconds: 3 }));
    state = accept(state, observation(2, 1_000, { bombState: 'carried' }));

    expect(project(state, 1_000).bomb).toEqual({
      state: 'carried',
      sourcePlayerId: null,
      explosion: null,
      action: null,
    });
  });

  it('invalidates an explosion anchor after stale recovery or a sequence gap', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(
      state,
      observation(2, 20_001, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', false)],
      }),
    );
    expect(project(state, 20_001).bomb?.explosion).toBeNull();

    state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(
      state,
      observation(3, 1, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', false)],
      }),
    );
    expect(project(state, 1).bomb?.explosion).toBeNull();
  });

  it('gates objective numerics by global freshness when staleAfterMs is shorter than the lease', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));

    expect(
      project(state, 101, { staleAfterMs: 100, objectiveClockLeaseMs: 1_000 }).bomb?.explosion,
    ).toEqual({ remainingSeconds: null, durationSeconds: null });
  });

  it('fails closed when current defuser evidence conflicts across player blocks', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(
      state,
      observation(1, 0, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', true)],
        player: player('defuser', false),
      }),
    );

    expect(project(state, 0).bomb?.action).toMatchObject({
      kind: 'defuse',
      durationSeconds: null,
      hasDefuseKit: null,
    });
  });

  it('clears round-over bomb residue before projecting actions', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(
      state,
      observation(2, 1, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        roundPhase: 'over',
        allPlayers: [player('defuser', true)],
      }),
    );

    expect(project(state, 1).bomb).toEqual({
      state: 'defusing',
      sourcePlayerId: 'defuser',
      explosion: null,
      action: null,
    });
  });

  it('clears timing on terminal, absent/degraded bomb blocks, map resets, and source generations', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(state, observation(1, 0, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(state, observation(2, 1, { bombState: 'exploded' }));
    expect(state.objectiveTiming.explosionAnchor).toBeNull();
    expect(project(state, 1).bomb?.explosion).toBeNull();

    state = accept(state, observation(3, 2, { bombState: 'planted', countdownSeconds: 30 }));
    state = accept(state, observation(4, 3, { bombCoverage: 'degraded' }));
    expect(state.objectiveTiming.explosionAnchor).toBeNull();

    state = accept(state, observation(5, 4, { bombState: 'planted', countdownSeconds: 30 }));
    state = reduceRuntime(
      state,
      {
        kind: 'reset-map-execution',
        reason: 'operator-correction',
        at: { monotonicMs: 5, utc: '2026-09-21T00:00:00.005Z' },
      },
      POLICY,
    ).state;
    expect(state.objectiveTiming.explosionAnchor).toBeNull();
    expect(project(state, 5).bomb).toBeNull();

    state = accept(state, observation(6, 6, { bombState: 'planted', countdownSeconds: 30 }));
    state = reduceRuntime(
      state,
      {
        kind: 'advance-program-source-generation',
        nextGeneration: 1,
        at: { monotonicMs: 7, utc: '2026-09-21T00:00:00.007Z' },
      },
      POLICY,
    ).state;
    expect(state.objectiveTiming.explosionAnchor).toBeNull();
    expect(selectProgramSafeRuntimeView(state).telemetry).toBeNull();
  });

  it('expires numeric interpolation after the short objective-clock lease', () => {
    let state = createInitialRuntimeState('objective-timing');
    state = accept(
      state,
      observation(1, 0, {
        bombState: 'defusing',
        countdownSeconds: 5,
        sourcePlayerId: 'defuser',
        allPlayers: [player('defuser', false)],
      }),
    );

    expect(project(state, 1_001).bomb).toEqual({
      state: 'defusing',
      sourcePlayerId: 'defuser',
      explosion: null,
      action: {
        kind: 'defuse',
        sourcePlayerId: 'defuser',
        remainingSeconds: null,
        durationSeconds: 10,
        hasDefuseKit: false,
      },
    });
  });
});
