import { describe, expect, it } from 'vitest';

import {
  createInitialRuntimeState,
  getProgramSourceFreshness,
  reduceRuntime,
} from '../src/index.js';
import { observation, telemetryInput, TEST_POLICY } from './helpers.js';

describe('Program source freshness', () => {
  it('reports awaiting before the first current-generation frame', () => {
    const state = createInitialRuntimeState('producer-1');
    expect(getProgramSourceFreshness(state, 0, TEST_POLICY)).toBe('awaiting');
  });

  it('uses monotonic time and the explicit policy threshold', () => {
    const initial = createInitialRuntimeState('producer-1');
    const state = reduceRuntime(initial, telemetryInput(0, observation(1, 100)), TEST_POLICY).state;

    expect(getProgramSourceFreshness(state, 200, TEST_POLICY)).toBe('fresh');
    expect(getProgramSourceFreshness(state, 201, TEST_POLICY)).toBe('stale');
    expect(getProgramSourceFreshness(state, 10_000, TEST_POLICY)).toBe('stale');
  });

  it('ignores UTC jumps when monotonic order is unchanged', () => {
    const initial = createInitialRuntimeState('producer-1');
    const first = observation(1, 100);
    const state = reduceRuntime(initial, telemetryInput(0, first), TEST_POLICY).state;
    const jumped = observation(2, 150);
    const withJumpedUtc = {
      ...jumped,
      receive: { ...jumped.receive, receivedAt: '2036-01-01T00:00:00.000Z' },
    };
    const next = reduceRuntime(state, telemetryInput(0, withJumpedUtc), TEST_POLICY).state;

    expect(next.programSource.lastAccepted).toMatchObject({
      sequence: 2,
      receivedMonotonicMs: 150,
      receivedAt: '2036-01-01T00:00:00.000Z',
    });
    expect(getProgramSourceFreshness(next, 250, TEST_POLICY)).toBe('fresh');
  });

  it('returns awaiting after source generation advance until the new generation is accepted', () => {
    const initial = createInitialRuntimeState('producer-1');
    const withFrame = reduceRuntime(
      initial,
      telemetryInput(0, observation(1, 100)),
      TEST_POLICY,
    ).state;
    const advanced = reduceRuntime(
      withFrame,
      {
        kind: 'advance-program-source-generation',
        nextGeneration: 1,
        at: { monotonicMs: 200, utc: '2026-09-14T00:00:00.200Z' },
      },
      TEST_POLICY,
    ).state;

    expect(getProgramSourceFreshness(advanced, 201, TEST_POLICY)).toBe('awaiting');
    const recovered = reduceRuntime(
      advanced,
      telemetryInput(1, observation(2, 250)),
      TEST_POLICY,
    ).state;
    expect(getProgramSourceFreshness(recovered, 350, TEST_POLICY)).toBe('fresh');
  });

  it('returns awaiting after an explicit map reset until the new execution baseline arrives', () => {
    const initial = createInitialRuntimeState('producer-1');
    const withFrame = reduceRuntime(
      initial,
      telemetryInput(0, observation(1, 100)),
      TEST_POLICY,
    ).state;
    const reset = reduceRuntime(
      withFrame,
      {
        kind: 'reset-map-execution',
        reason: 'restore',
        at: { monotonicMs: 200, utc: '2026-09-14T00:00:00.200Z' },
      },
      TEST_POLICY,
    ).state;

    expect(getProgramSourceFreshness(reset, 201, TEST_POLICY)).toBe('awaiting');
    const recovered = reduceRuntime(
      reset,
      telemetryInput(0, observation(2, 250)),
      TEST_POLICY,
    ).state;
    expect(getProgramSourceFreshness(recovered, 350, TEST_POLICY)).toBe('fresh');
  });

  it('rejects invalid thresholds rather than inventing a production default', () => {
    const state = createInitialRuntimeState('producer-1');
    expect(() => getProgramSourceFreshness(state, 0, { staleAfterMs: -1 })).toThrow(
      'staleAfterMs must be a finite non-negative number',
    );
    expect(() => getProgramSourceFreshness(state, 0, { staleAfterMs: Number.NaN })).toThrow(
      'staleAfterMs must be a finite non-negative number',
    );
  });
});
