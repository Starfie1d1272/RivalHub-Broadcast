import { describe, expect, it } from 'vitest';

import {
  identityEvidenceFromObservation,
  resolveIdentity,
  unboundIdentityResolution,
  type IdentityResolution,
} from '../src/identity/index.js';
import {
  createInitialRuntimeState,
  reduceRuntime,
  type RuntimeContinuityPolicy,
  type RuntimeState,
} from '../src/runtime/index.js';
import {
  getProjectionIdentityCapabilities,
  projectObserverAssist,
  projectProgram,
  selectProgramSafeRuntimeView,
} from '../src/projection/index.js';
import type { MatchContext } from '../src/match-context/index.js';
import type { ObservedPlayer, TelemetryObservation } from '../src/telemetry/index.js';

const POLICY: RuntimeContinuityPolicy = { staleAfterMs: 100 };

function steam64(index: number): string {
  return String(76561198000000000n + BigInt(index));
}

function contextFixture(): MatchContext {
  const entrant = (entryId: 'a' | 'b', name: string, offset: number) => ({
    entryId,
    name,
    logoUrl: `https://example.test/${entryId}.svg`,
    rosterId: `${entryId}-roster`,
    players: Array.from({ length: 5 }, (_, index) => ({
      playerId: `${entryId}-player-${index + 1}`,
      steam64: steam64(offset + index),
      displayName: `${name} Player ${index + 1}`,
      avatarUrl: null,
      isStarter: true,
    })),
  });

  return {
    matchId: 'match-29',
    competition: {
      competitionId: 'competition-1',
      slug: 'issue-29',
      name: 'Issue 29 Cup',
      themeColor: '#123456',
    },
    status: 'in_progress',
    format: 'bo3',
    stage: 'final',
    round: 1,
    entryRound: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    scoreA: 1,
    scoreB: 0,
    isForfeit: false,
    entrants: {
      a: entrant('a', 'Alpha', 1),
      b: entrant('b', 'Bravo', 6),
    },
    maps: [1, 2, 3].map((mapOrder) => ({
      mapId: `map-${mapOrder}`,
      mapOrder,
      mapName: mapOrder === 1 ? 'de_mirage' : `de_map_${mapOrder}`,
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

function player(index: number, side: 'CT' | 'T', reverse = false): ObservedPlayer {
  return {
    sourcePlayerId: steam64(index),
    displayName: `Observed ${index}`,
    side,
    observerSlot: index,
    activity: 'playing',
    state: {
      health: index === 1 ? 100 : 0,
      armor: 100,
      hasHelmet: true,
      money: 1200,
      roundKills: index === 1 ? 2 : 0,
    },
    matchStats: { kills: index === 1 ? 4 : 0, deaths: 0, score: 10 },
    weapons: reverse
      ? [
          { sourceWeaponId: 'weapon-z', name: 'AK-47', state: 'holstered' },
          { sourceWeaponId: 'weapon-a', name: 'Knife', state: 'active' },
        ]
      : [{ sourceWeaponId: 'weapon-a', name: 'Knife', state: 'active' }],
    position: { x: index, y: index + 1, z: 0 },
    forward: { x: 1, y: 0, z: 0 },
  };
}

function observation(reverse = false): TelemetryObservation {
  const allPlayers = [
    ...Array.from({ length: 5 }, (_, index) => player(index + 1, 'CT', reverse)),
    ...Array.from({ length: 5 }, (_, index) => player(index + 6, 'T', reverse)),
  ];
  if (reverse) allPlayers.reverse();

  return {
    receive: {
      sequence: 7,
      receivedAt: '2026-09-16T00:00:00.007Z',
      receivedMonotonicMs: 7,
    },
    source: { kind: 'cs2-gsi', providerTimestampSeconds: 1_700_000_007 },
    coverage: {
      provider: 'present',
      map: 'present',
      round: 'present',
      phaseCountdowns: 'present',
      player: 'present',
      allPlayers: 'present',
      bomb: 'present',
      grenades: 'present',
    },
    telemetry: {
      map: {
        name: 'de_mirage',
        mode: 'competitive',
        phase: 'live',
        roundNumber: 3,
        sides: {
          ct: { name: 'Alpha', score: 8, timeoutsRemaining: 1 },
          t: { name: 'Bravo', score: 6, timeoutsRemaining: 0 },
        },
      },
      round: { phase: 'live', winnerSide: 'unknown' },
      phaseCountdowns: { phase: 'live', endsInSeconds: 42 },
      player: allPlayers[0]!,
      allPlayers,
      bomb: {
        state: 'dropped',
        position: { x: 10, y: 20, z: 0 },
        sourcePlayerId: allPlayers[0]!.sourcePlayerId,
        countdownSeconds: 12,
      },
    },
  };
}

function acceptedState(input: TelemetryObservation): RuntimeState {
  const initial = createInitialRuntimeState('producer-29', {
    kind: 'bound',
    liveSessionId: 'live-29',
  });
  return reduceRuntime(
    initial,
    { kind: 'program-telemetry', sourceGeneration: 0, observation: input },
    POLICY,
  ).state;
}

function matchedIdentity(context: MatchContext, input: TelemetryObservation): IdentityResolution {
  const state = acceptedState(input);
  return resolveIdentity(context, identityEvidenceFromObservation(input, 0, state.map.epoch));
}

describe('Program-safe projections', () => {
  it('projects deterministic canonical Program data without mutating RuntimeState', () => {
    const context = contextFixture();
    const input = observation(true);
    const state = acceptedState(input);
    const before = structuredClone(state);
    const identity = matchedIdentity(context, input);
    const runtime = selectProgramSafeRuntimeView(state);

    const first = projectProgram({
      runtime,
      context,
      identity,
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });
    const second = projectProgram({
      runtime,
      context,
      identity,
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });

    expect(first).toEqual(second);
    expect(state).toEqual(before);
    expect(first.status).toEqual({ telemetry: 'fresh', context: 'fresh', identity: 'matched' });
    expect(first.teams.ct).toMatchObject({
      mode: 'canonical',
      entryId: 'a',
      name: 'Alpha',
      seriesScore: 1,
    });
    expect(first.teams.t).toMatchObject({
      mode: 'canonical',
      entryId: 'b',
      name: 'Bravo',
      seriesScore: 0,
    });
    expect(first.players.map((item) => item.sourcePlayerId)).toEqual(
      [...first.players].map((item) => item.sourcePlayerId).sort(),
    );
    expect(first.players[0]?.weapons.map((item) => item.sourceWeaponId)).toEqual([
      'weapon-a',
      'weapon-z',
    ]);
    expect(first.players[0]).not.toHaveProperty('position');
    expect(first.bomb).not.toHaveProperty('position');
    expect(first).not.toHaveProperty('lookahead');
    expect(first).not.toHaveProperty('identityIssues');
  });

  it('keeps normalized values while marking telemetry stale and hides stale series score', () => {
    const context = contextFixture();
    const input = observation();
    const state = acceptedState(input);
    const identity = matchedIdentity(context, input);
    const projection = projectProgram({
      runtime: selectProgramSafeRuntimeView(state),
      context,
      contextFreshness: 'stale',
      identity,
      nowMonotonicMs: 108,
      continuityPolicy: POLICY,
    });

    expect(projection.status.telemetry).toBe('stale');
    expect(projection.status.context).toBe('stale');
    expect(projection.teams.ct.seriesScore).toBeNull();
    expect(projection.teams.t.seriesScore).toBeNull();
    expect(projection.map.name).toBe('de_mirage');
    expect(projection.clock?.endsInSeconds).toBe(42);
  });

  it('keeps proven player enrichment while degraded identity forces neutral teams', () => {
    const context = contextFixture();
    const input = observation();
    const state = acceptedState(input);
    const partialInput: TelemetryObservation = {
      ...input,
      telemetry: {
        ...input.telemetry,
        allPlayers: input.telemetry.allPlayers!.slice(0, 1),
      },
    };
    const identity = resolveIdentity(
      context,
      identityEvidenceFromObservation(partialInput, 0, state.map.epoch),
    );
    const projection = projectProgram({
      runtime: selectProgramSafeRuntimeView(state),
      context,
      identity,
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });

    expect(identity.state).toBe('degraded');
    expect(identity.capabilities.canonicalPlayerMapping).toBe(true);
    expect(projection.teams.ct.mode).toBe('neutral');
    expect(projection.players[0]?.canonicalPlayerId).not.toBeNull();
    expect(projection.players[1]?.canonicalPlayerId).toBeNull();
  });

  it('keeps neutral telemetry but removes canonical enrichment for mismatch and unbound identity', () => {
    const context = contextFixture();
    const input = observation();
    const state = acceptedState(input);
    const unexpected = player(20, 'T');
    const mismatchInput: TelemetryObservation = {
      ...input,
      telemetry: {
        ...input.telemetry,
        allPlayers: [...(input.telemetry.allPlayers?.slice(1) ?? []), unexpected],
      },
    };
    const mismatchIdentity = resolveIdentity(
      context,
      identityEvidenceFromObservation(mismatchInput, 0, state.map.epoch),
    );
    const mismatchProjection = projectProgram({
      runtime: selectProgramSafeRuntimeView(state),
      context,
      identity: mismatchIdentity,
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });
    const unboundProjection = projectProgram({
      runtime: selectProgramSafeRuntimeView(state),
      context,
      identity: unboundIdentityResolution(),
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });

    expect(mismatchIdentity.state).toBe('mismatch');
    expect(mismatchProjection.map.name).toBe('de_mirage');
    expect(mismatchProjection.players.every((item) => item.canonicalPlayerId === null)).toBe(true);
    expect(unboundProjection.status.identity).toBe('unbound');
    expect(unboundProjection.teams.ct.mode).toBe('neutral');
    expect(unboundProjection.players[0]?.displayName).toBe('Observed 1');
  });

  it('fails closed to neutral teams and player ids across an identity epoch change', () => {
    const context = contextFixture();
    const input = observation();
    const state = acceptedState(input);
    const identity = matchedIdentity(context, input);
    const projection = projectProgram({
      runtime: selectProgramSafeRuntimeView(state),
      context,
      identity: { ...identity, sourceGeneration: 1 },
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });

    expect(projection.teams.ct).toEqual({
      mode: 'neutral',
      entryId: null,
      name: 'CT',
      logoUrl: null,
      seriesScore: null,
    });
    expect(projection.players.every((item) => item.canonicalPlayerId === null)).toBe(true);
    expect(projection.status.identity).toBe('resolving');
    expect(
      getProjectionIdentityCapabilities(selectProgramSafeRuntimeView(state), {
        ...identity,
        sourceGeneration: 1,
      }),
    ).toEqual({
      canonicalPlayerMapping: false,
      canonicalTeamBranding: false,
      identityDependentResult: false,
      neutralTelemetry: true,
    });
  });

  it('does not expose the previous Program source after a source generation advance', () => {
    const input = observation();
    const state = acceptedState(input);
    const advanced = reduceRuntime(
      state,
      {
        kind: 'advance-program-source-generation',
        nextGeneration: 1,
        at: { monotonicMs: 8, utc: '2026-09-16T00:00:00.008Z' },
      },
      POLICY,
    ).state;
    const runtime = selectProgramSafeRuntimeView(advanced);

    expect(runtime.cursor.programSourceGeneration).toBe(1);
    expect(runtime.cursor.programReceiveSequence).toBeNull();
    expect(runtime.programSourceLastAccepted).toBeNull();
    expect(runtime.telemetry).toBeNull();
  });

  it('keeps the Observer Assist seam unavailable and free of future fields', () => {
    const state = acceptedState(observation());
    const assist = projectObserverAssist(selectProgramSafeRuntimeView(state));

    expect(assist.availability).toBe('unavailable');
    expect(Object.keys(assist).sort()).toEqual(['availability', 'cursor']);
    expect(assist).not.toHaveProperty('future');
    expect(assist).not.toHaveProperty('cue');
  });

  it('keeps absent and degraded allplayers frame-local instead of inventing player LKG', () => {
    const context = contextFixture();
    const input = observation();
    const state = acceptedState(input);
    const identity = matchedIdentity(context, input);
    const telemetryWithoutPlayers = { ...state.programTelemetry!.telemetry };
    delete telemetryWithoutPlayers.allPlayers;
    const absent = projectProgram({
      runtime: selectProgramSafeRuntimeView({
        ...state,
        programTelemetry: {
          ...state.programTelemetry!,
          coverage: { ...state.programTelemetry!.coverage, allPlayers: 'absent' },
          telemetry: telemetryWithoutPlayers,
        },
      }),
      context,
      identity,
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });
    const degraded = projectProgram({
      runtime: selectProgramSafeRuntimeView({
        ...state,
        programTelemetry: {
          ...state.programTelemetry!,
          coverage: { ...state.programTelemetry!.coverage, allPlayers: 'degraded' },
        },
      }),
      context,
      identity,
      nowMonotonicMs: 7,
      continuityPolicy: POLICY,
    });

    expect(absent.coverage.allPlayers).toBe('absent');
    expect(absent.players).toEqual([]);
    expect(degraded.coverage.allPlayers).toBe('degraded');
    expect(degraded.players).toHaveLength(10);
  });
});
