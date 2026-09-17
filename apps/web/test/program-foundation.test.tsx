// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ProgramPage } from '../src/program/ProgramPage';
import { ProgramCanvas } from '../src/program/ProgramCanvas';
import { getProgramFixture, PROGRAM_FIXTURE_IDS, programFixtures } from '../src/program/fixtures';
import { ProgramVisualFixturePage } from '../src/program/testing/ProgramVisualFixturePage';

describe('Program presentation foundation', () => {
  it('provides every frozen deterministic fixture through the ProgramSnapshot schema', () => {
    expect(Object.keys(programFixtures)).toEqual([...PROGRAM_FIXTURE_IDS]);

    for (const fixtureId of PROGRAM_FIXTURE_IDS) {
      const fixture = getProgramFixture(fixtureId);
      expect(fixture).not.toBeNull();
      expect(fixture?.channel).toBe('program');
      expect(fixture?.cursor).toEqual({
        producerInstanceId: 'fixture-producer',
        liveSessionId: 'fixture-session',
        runtimeSeq: 42,
        programSourceGeneration: 1,
        programReceiveSequence: 42,
        mapEpoch: 1,
      });
    }

    expect(getProgramFixture('not-a-fixture')).toBeNull();
  });

  it('keeps neutral and identity safety semantics explicit', () => {
    const awaiting = getProgramFixture('awaiting-neutral');
    const stale = getProgramFixture('context-stale');
    const mismatch = getProgramFixture('identity-mismatch');
    const degraded = getProgramFixture('identity-degraded');

    expect(awaiting?.payload.status).toEqual({
      telemetry: 'awaiting',
      context: 'unbound',
      identity: 'unbound',
    });
    expect(awaiting?.payload.players).toHaveLength(0);
    expect(stale?.payload.teams.ct).toMatchObject({ mode: 'canonical', seriesScore: null });
    expect(stale?.payload.teams.t).toMatchObject({ mode: 'canonical', seriesScore: null });
    expect(stale?.payload.observedPlayerSourceId).toBe('fixture-player-t-8');
    expect(stale?.payload.players.map((player) => player.sourcePlayerId)).toContain(
      'fixture-player-t-8',
    );
    expect(mismatch?.payload.status.identity).toBe('mismatch');
    expect(mismatch?.payload.teams.ct.mode).toBe('neutral');
    expect(mismatch?.payload.observedPlayerSourceId).toBe('fixture-player-t-10');
    expect(mismatch?.payload.players.map((player) => player.sourcePlayerId)).toContain(
      'fixture-player-t-10',
    );
    expect(mismatch?.payload.players.every((player) => player.canonicalPlayerId === null)).toBe(
      true,
    );
    expect(degraded?.payload.status.identity).toBe('degraded');
    expect(
      degraded?.payload.players.filter((player) => player.canonicalPlayerId !== null),
    ).toHaveLength(2);
  });

  it('keeps bomb coverage aligned with the projected bomb value', () => {
    const noBombFixtureIds = [
      'awaiting-neutral',
      'live-neutral',
      'live-canonical',
      'context-stale',
      'identity-degraded',
      'identity-mismatch',
      'timeout-ct',
      'stress-long-labels',
    ] as const;

    for (const fixtureId of noBombFixtureIds) {
      const fixture = getProgramFixture(fixtureId);
      expect(fixture?.payload.bomb, fixtureId).toBeNull();
      expect(fixture?.payload.coverage.bomb, fixtureId).toBe('absent');
    }

    for (const fixtureId of ['bomb-planted', 'bomb-defusing'] as const) {
      const fixture = getProgramFixture(fixtureId);
      expect(fixture?.payload.bomb, fixtureId).not.toBeNull();
      expect(fixture?.payload.coverage.bomb, fixtureId).toBe('present');
    }
  });

  it('covers the frozen live, bomb, timeout, and long-label scenarios', () => {
    expect(getProgramFixture('live-neutral')?.payload.players).toHaveLength(10);
    expect(getProgramFixture('live-canonical')?.payload.match?.format).toBe('bo3');
    expect(getProgramFixture('context-stale')?.payload.status.context).toBe('stale');

    expect(getProgramFixture('bomb-planted')?.payload.bomb).toEqual({
      state: 'planted',
      sourcePlayerId: null,
      countdownSeconds: 28,
    });
    expect(getProgramFixture('bomb-defusing')?.payload.clock?.phase).toBe('defuse');
    expect(getProgramFixture('timeout-ct')?.payload.clock?.phase).toBe('timeout_ct');

    const stress = getProgramFixture('stress-long-labels');
    expect(stress?.payload.players).toHaveLength(10);
    expect(stress?.payload.teams.ct.name).toContain('International Academy');
  });

  it('uses the same ProgramCanvas for production and visual-only pages', () => {
    const production = ProgramPage();
    const visual = ProgramVisualFixturePage({ fixtureId: 'awaiting-neutral' });

    expect(production).toMatchObject({
      type: ProgramCanvas,
      props: {},
    });
    expect(visual).toMatchObject({
      type: ProgramCanvas,
    });
  });
});
