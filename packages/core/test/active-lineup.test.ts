import { describe, expect, it } from 'vitest';

import {
  emptyActiveLineup,
  resolveActiveLineup,
  type ActiveLineupResolution,
} from '../src/identity/index.js';
import type { ObservedPlayer } from '../src/telemetry/index.js';

const SOURCE_IDS = Array.from(
  { length: 12 },
  (_, index) => `76561198${String(index + 1).padStart(9, '0')}`,
);

function player(
  index: number,
  side: 'CT' | 'T',
  overrides: Partial<ObservedPlayer> = {},
): ObservedPlayer {
  return {
    sourcePlayerId: SOURCE_IDS[index] ?? `source-${index}`,
    displayName: `Player ${index}`,
    side,
    observerSlot: index,
    activity: 'playing',
    state: { health: 100 },
    ...overrides,
  };
}

function allPlayers(ctCount = 5, tCount = 5): readonly ObservedPlayer[] {
  return [
    ...Array.from({ length: ctCount }, (_, index) => player(index, 'CT')),
    ...Array.from({ length: tCount }, (_, index) => player(index + ctCount, 'T')),
  ];
}

function resolve(
  players: readonly ObservedPlayer[] | undefined,
  previous?: ActiveLineupResolution,
  options: Partial<Parameters<typeof resolveActiveLineup>[0]> = {},
): ActiveLineupResolution {
  return resolveActiveLineup({
    sourceGeneration: 0,
    mapEpoch: 1,
    ...(players === undefined ? {} : { allPlayers: players }),
    ...(players === undefined ? {} : { allPlayersCoverage: 'present' as const }),
    ...(previous === undefined ? {} : { previous }),
    ...options,
  });
}

describe('Core ActiveLineupResolution', () => {
  it('waits for an unambiguous 5+5 instead of locking an initial 6+4 frame', () => {
    const resolving = resolve(allPlayers(6, 4));
    expect(resolving.state).toBe('resolving');
    expect(resolving.ct).toHaveLength(0);
    expect(resolving.t).toHaveLength(0);

    const complete = resolve(allPlayers());
    expect(complete.state).toBe('complete');
    expect(complete.ct).toHaveLength(5);
    expect(complete.t).toHaveLength(5);
  });

  it('does not use observer slot bounds as membership filtering', () => {
    const highObserverSlots = allPlayers().map((entry, index) => ({
      ...entry,
      observerSlot: index + 11,
    }));
    const complete = resolve(highObserverSlots);

    expect(complete.state).toBe('complete');
    expect(complete.ct).toHaveLength(5);
    expect(complete.t).toHaveLength(5);
  });

  it('requires stable Steam64 keys before establishing a new baseline', () => {
    const nonSteam = allPlayers().map((entry, index) =>
      index === 0 ? { ...entry, sourcePlayerId: 'BOT-001' } : entry,
    );
    const resolving = resolve(nonSteam);

    expect(resolving.state).toBe('resolving');
    expect(resolving.ct).toHaveLength(0);
    expect(resolving.t).toHaveLength(0);
  });

  it('retains a stable cohort through missing or extra source entries', () => {
    const baseline = resolve(allPlayers());
    const missing = resolve(
      allPlayers().filter((entry) => entry.sourcePlayerId !== SOURCE_IDS[0]),
      baseline,
    );
    expect(missing.state).toBe('degraded');
    expect(missing.ct).toHaveLength(5);
    expect(missing.ct.find((entry) => entry.sourcePlayerId === SOURCE_IDS[0])?.lineupEvidence).toBe(
      'retained',
    );
    expect(missing.ct.find((entry) => entry.sourcePlayerId === SOURCE_IDS[0])?.observed).toBeNull();

    const extra = resolve(
      [
        ...allPlayers(),
        {
          sourcePlayerId: SOURCE_IDS[10]!,
          displayName: 'Coach',
          side: 'CT',
          observerSlot: 10,
          activity: 'coach',
        },
      ],
      baseline,
    );
    expect(extra.ct).toHaveLength(5);
    expect(extra.t).toHaveLength(5);
    expect(extra.extras.map((entry) => entry.sourcePlayerId)).toEqual([SOURCE_IDS[10]]);
  });

  it('allows a new exact 5+5 cohort, including a substitute, without isStarter filtering', () => {
    const baseline = resolve(allPlayers());
    const replacement = player(10, 'CT', { activity: 'playing', state: { health: 100 } });
    const next = resolve(
      [...allPlayers().filter((entry) => entry.sourcePlayerId !== SOURCE_IDS[0]), replacement],
      baseline,
    );
    expect(next.state).toBe('complete');
    expect(next.ct.map((entry) => entry.sourcePlayerId)).toContain(SOURCE_IDS[10]);
    expect(next.ct.map((entry) => entry.sourcePlayerId)).not.toContain(SOURCE_IDS[0]);
  });

  it('supports deterministic local exclude/include recovery and rejects ambiguous cohorts otherwise', () => {
    const ambiguous = resolve(allPlayers(6, 5));
    expect(ambiguous.state).toBe('resolving');
    expect(ambiguous.ct).toHaveLength(0);

    const recovered = resolve(allPlayers(6, 5), undefined, {
      override: { excludeSourcePlayerIds: [SOURCE_IDS[5]!] },
    });
    expect(recovered.state).toBe('complete');
    expect(recovered.ct).toHaveLength(5);
    expect(recovered.t).toHaveLength(5);
  });

  it('keeps source generation reconnects in the same map epoch eligible for retention', () => {
    const baseline = resolve(allPlayers());
    const reconnected = resolve(allPlayers().slice(1), baseline, { sourceGeneration: 1 });
    expect(reconnected.mapEpoch).toBe(1);
    expect(reconnected.ct).toHaveLength(5);
    expect(reconnected.t).toHaveLength(5);
    expect(reconnected.ct.some((entry) => entry.lineupEvidence === 'retained')).toBe(true);

    const newMap = resolve(allPlayers(), reconnected, { mapEpoch: 2 });
    expect(newMap.ct.every((entry) => entry.lineupEvidence === 'current')).toBe(true);
  });

  it('keeps stable membership and updates side assignment across halftime or overtime', () => {
    const baseline = resolve(allPlayers());
    const switched = resolve(
      [
        ...Array.from({ length: 5 }, (_, index) => player(index, 'T')),
        ...Array.from({ length: 5 }, (_, index) => player(index + 5, 'CT')),
      ],
      baseline,
    );

    expect(switched.state).toBe('complete');
    expect(new Set(switched.ct.concat(switched.t).map((entry) => entry.sourcePlayerId))).toEqual(
      new Set(baseline.ct.concat(baseline.t).map((entry) => entry.sourcePlayerId)),
    );
    expect(switched.ct.map((entry) => entry.sourcePlayerId)).toEqual(
      baseline.t.map((entry) => entry.sourcePlayerId),
    );
    expect(switched.t.map((entry) => entry.sourcePlayerId)).toEqual(
      baseline.ct.map((entry) => entry.sourcePlayerId),
    );
  });

  it('does not transition stable membership when allplayers evidence is absent', () => {
    const baseline = resolve(allPlayers());
    const awaiting = resolve(undefined, baseline, { sourceGeneration: 1 });
    expect(awaiting).toMatchObject({
      state: 'degraded',
      sourceGeneration: 1,
      mapEpoch: baseline.mapEpoch,
    });
    expect(awaiting.ct.map((entry) => entry.sourcePlayerId)).toEqual(
      baseline.ct.map((entry) => entry.sourcePlayerId),
    );
    expect(awaiting.t.map((entry) => entry.sourcePlayerId)).toEqual(
      baseline.t.map((entry) => entry.sourcePlayerId),
    );
    expect(awaiting.ct.every((entry) => entry.lineupEvidence === 'retained')).toBe(true);
    expect(awaiting.t.every((entry) => entry.lineupEvidence === 'retained')).toBe(true);
    expect(awaiting.ct.every((entry) => entry.observed === null)).toBe(true);
    expect(awaiting.t.every((entry) => entry.observed === null)).toBe(true);
    expect(awaiting.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['allplayers_unavailable', 'retained_baseline']),
    );
    expect(emptyActiveLineup(1, 2).ct).toEqual([]);
  });

  it('deduplicates identical duplicate Steam64 entries without increasing the Program cohort', () => {
    const duplicate = resolve([...allPlayers(), player(0, 'CT')]);
    expect(duplicate.state).toBe('complete');
    expect(duplicate.ct).toHaveLength(5);
    expect(duplicate.t).toHaveLength(5);
    expect(duplicate.issues.some((item) => item.code === 'duplicate_observed_identity')).toBe(true);
  });

  it('fails closed and deterministically on conflicting duplicate Steam64 entries', () => {
    const first = player(0, 'CT', { observerSlot: 1, state: { health: 100 } });
    const second = player(0, 'T', { observerSlot: 8, state: { health: 20 } });
    const left = resolve([first, second, ...allPlayers().slice(1)]);
    const right = resolve([second, first, ...allPlayers().slice(1)]);

    expect(left).toEqual(right);
    expect(left.state).toBe('resolving');
    expect(left.ct).toEqual([]);
    expect(left.t).toEqual([]);
    expect(left.issues.some((item) => item.code === 'duplicate_observed_identity')).toBe(true);
  });

  it('does not establish a baseline from degraded clean-looking 5+5 evidence', () => {
    const initial = resolve(allPlayers(), undefined, { allPlayersCoverage: 'degraded' });

    expect(initial.state).toBe('degraded');
    expect(initial.ct).toEqual([]);
    expect(initial.t).toEqual([]);
    expect(initial.issues.map((item) => item.code)).toContain('allplayers_degraded');
  });

  it('retains stable lineup A when degraded evidence resembles a clean lineup B', () => {
    const baseline = resolve(allPlayers());
    const replacement = player(10, 'CT');
    const degraded = resolve(
      [...allPlayers().filter((entry) => entry.sourcePlayerId !== SOURCE_IDS[0]), replacement],
      baseline,
      { allPlayersCoverage: 'degraded' },
    );

    expect(degraded.state).toBe('degraded');
    expect(degraded.ct.map((entry) => entry.sourcePlayerId)).toEqual(
      baseline.ct.map((entry) => entry.sourcePlayerId),
    );
    expect(degraded.ct.every((entry) => entry.lineupEvidence === 'retained')).toBe(true);
    expect(
      degraded.ct.find((entry) => entry.sourcePlayerId === SOURCE_IDS[0])?.observed,
    ).toBeNull();
    expect(degraded.extras.map((entry) => entry.sourcePlayerId)).toEqual([SOURCE_IDS[10]]);
  });
});
