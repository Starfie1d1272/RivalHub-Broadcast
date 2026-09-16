import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareScheduleMatches,
  validateBroadcastManifest,
  validateBroadcastScheduleWindow,
  type BroadcastManifestV1,
  type BroadcastScheduleWindowV1,
} from '../src/index.js';

const fixtureRoot = resolve(process.cwd(), 'packages/rivalhub/test/fixtures');

async function readJson<T>(fileName: string): Promise<T> {
  return JSON.parse(await readFile(resolve(fixtureRoot, fileName), 'utf8')) as T;
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

describe('BroadcastManifestV1 contract', () => {
  it('accepts the full same-shape fixture with a null canonical startedAt', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const result = validateBroadcastManifest(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('fixture should validate');
    expect(result.value.match.startedAt).toBeNull();
    expect(result.value.entrants.a.roster.players).toHaveLength(6);
    expect(result.value.entrants.a.roster.players.some((player) => !player.isStarter)).toBe(true);
  });

  it('accepts a non-null canonical startedAt without deriving or rewriting it', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = mutableClone(fixture);
    candidate.match.startedAt = '2026-09-16T10:03:00.123Z';

    const result = validateBroadcastManifest(candidate);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('startedAt candidate should validate');
    expect(result.value.match.startedAt).toBe('2026-09-16T10:03:00.123Z');
  });

  it('returns a typed diagnostic for unsupported schema versions', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = { ...fixture, schemaVersion: 'rivalhub.broadcast-manifest.v9' };

    const result = validateBroadcastManifest(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'structural',
          code: 'unsupported_schema_version',
          severity: 'error',
        }),
      ]),
    );
  });

  it.each([
    [
      'duplicate entry',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.entrants.b.entryId = candidate.entrants.a.entryId;
      },
      'duplicate_entry_id',
    ],
    [
      'duplicate playerId',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.entrants.b.roster.players[0]!.playerId =
          candidate.entrants.a.roster.players[0]!.playerId;
      },
      'duplicate_player_id',
    ],
    [
      'duplicate Steam64',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.entrants.b.roster.players[0]!.steam64 =
          candidate.entrants.a.roster.players[0]!.steam64;
      },
      'duplicate_steam64',
    ],
    [
      'invalid map order',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.maps[1]!.mapOrder = candidate.maps[0]!.mapOrder;
      },
      'duplicate_map_order',
    ],
    [
      'invalid map order range',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.maps[0]!.mapOrder = 0;
      },
      'invalid_map_order',
    ],
    [
      'invalid round',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.match.round = 1.5;
      },
      'invalid_round',
    ],
    [
      'unknown map picker',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.maps[0]!.pickedByEntryId = 'entry-not-in-match';
      },
      'unknown_entry_reference',
    ],
    [
      'unknown veto entry',
      (candidate: Mutable<BroadcastManifestV1>) => {
        candidate.veto[0]!.entryId = 'entry-not-in-match';
      },
      'unknown_entry_reference',
    ],
  ] as const)('rejects %s with a typed semantic diagnostic', async (_name, mutate, code) => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = mutableClone(fixture);
    mutate(candidate);

    const result = validateBroadcastManifest(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('keeps missing canonical fields representable and reports local warnings', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = mutableClone(fixture);
    candidate.entrants.a.roster.players[0]!.steam64 = null;
    candidate.entrants.a.roster.players[0]!.displayName = null;
    candidate.entrants.a.logoUrl = null;
    candidate.commentators[0]!.avatarUrl = null;

    const result = validateBroadcastManifest(candidate);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_steam64', severity: 'warning' }),
        expect.objectContaining({ code: 'missing_display_name', severity: 'warning' }),
      ]),
    );
  });

  it('rejects malformed timestamp and score-pair shapes without throwing', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = mutableClone(fixture);
    candidate.match.scheduledAt = 'not-a-timestamp';
    candidate.match.scoreA = 1;
    candidate.match.scoreB = null;

    const result = validateBroadcastManifest(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_timestamp' }),
        expect.objectContaining({ code: 'incomplete_score_pair' }),
      ]),
    );
  });

  it('accepts additive V1 fields and strips them before DTO consumption', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = {
      ...fixture,
      futureCoverage: { producer: 'rivalhub' },
      entrants: {
        ...fixture.entrants,
        a: {
          ...fixture.entrants.a,
          futureShortName: 'A',
          roster: {
            ...fixture.entrants.a.roster,
            futurePairing: 'opaque',
            players: fixture.entrants.a.roster.players.map((player) => ({
              ...player,
              futureIdentityHint: 'must-not-cross-contract',
            })),
          },
        },
      },
    };
    const result = validateBroadcastManifest(candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('additive V1 fields should be accepted');
    expect(result.value).not.toHaveProperty('futureCoverage');
    expect(result.value.entrants.a).not.toHaveProperty('futureShortName');
    expect(result.value.entrants.a.roster).not.toHaveProperty('futurePairing');
    expect(result.value.entrants.a.roster.players[0]).not.toHaveProperty('futureIdentityHint');
  });

  it('rejects veto action types outside the canonical V1 domain', async () => {
    const fixture = await readJson<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const candidate = mutableClone(fixture);
    candidate.veto[0]!.actionType = 'remove' as never;

    const result = validateBroadcastManifest(candidate);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_shape' })]),
    );
  });
});

describe('BroadcastScheduleWindowV1 contract', () => {
  it('accepts nullable and non-null startedAt and applies deterministic sorting', async () => {
    const fixture = await readJson<BroadcastScheduleWindowV1>(
      'broadcast-schedule-window-v1.valid.json',
    );
    const result = validateBroadcastScheduleWindow(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('schedule fixture should validate');
    expect(result.value.matches.map((match) => match.matchId)).toEqual([
      'match-m2-00',
      'match-m2-01',
      'match-m2-unknown-time',
    ]);
    expect(result.value.matches[0]?.startedAt).toBe('2026-09-16T09:02:00.000Z');
    expect(result.value.matches[1]?.startedAt).toBeNull();
  });

  it.each([
    [
      'invalid time window',
      (candidate: Mutable<BroadcastScheduleWindowV1>) => {
        candidate.from = '2026-09-16T15:00:00.000Z';
      },
      'invalid_time_window',
    ],
    [
      'duplicate matchId',
      (candidate: Mutable<BroadcastScheduleWindowV1>) => {
        candidate.matches[1]!.matchId = candidate.matches[0]!.matchId;
      },
      'duplicate_match_id',
    ],
    [
      'same entrant on both sides',
      (candidate: Mutable<BroadcastScheduleWindowV1>) => {
        candidate.matches[0]!.entrantB.entryId = candidate.matches[0]!.entrantA.entryId;
      },
      'duplicate_entry_id',
    ],
    [
      'invalid round',
      (candidate: Mutable<BroadcastScheduleWindowV1>) => {
        candidate.matches[0]!.round = 0;
      },
      'invalid_round',
    ],
  ] as const)('rejects %s with a typed diagnostic', async (_name, mutate, code) => {
    const fixture = await readJson<BroadcastScheduleWindowV1>(
      'broadcast-schedule-window-v1.valid.json',
    );
    const candidate = mutableClone(fixture);
    mutate(candidate);

    const result = validateBroadcastScheduleWindow(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('sorts multiple null scheduledAt values deterministically after reverse input', async () => {
    const fixture = await readJson<BroadcastScheduleWindowV1>(
      'broadcast-schedule-window-v1.valid.json',
    );
    const candidate = mutableClone(fixture);
    candidate.matches = [...candidate.matches]
      .reverse()
      .map((match) => ({ ...match, scheduledAt: null }));

    const result = validateBroadcastScheduleWindow(candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('null schedule times should validate');
    expect(result.value.matches.map((match) => match.matchId)).toEqual([
      'match-m2-00',
      'match-m2-01',
      'match-m2-unknown-time',
    ]);
    expect(compareScheduleMatches(result.value.matches[0]!, result.value.matches[1]!)).toBeLessThan(
      0,
    );
    expect(compareScheduleMatches(result.value.matches[1]!, result.value.matches[2]!)).toBeLessThan(
      0,
    );
  });

  it('accepts additive ScheduleWindow fields without changing the known DTO', async () => {
    const fixture = await readJson<BroadcastScheduleWindowV1>(
      'broadcast-schedule-window-v1.valid.json',
    );
    const candidate = {
      ...fixture,
      futureCoverage: 'optional',
      matches: fixture.matches.map((match) => ({
        ...match,
        futurePairing: { auth: 'opaque' },
        entrantA: { ...match.entrantA, shortName: 'A' },
      })),
    };

    const result = validateBroadcastScheduleWindow(candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('additive ScheduleWindow fields should be accepted');
    expect(result.value).not.toHaveProperty('futureCoverage');
    expect(result.value.matches[0]).not.toHaveProperty('futurePairing');
    expect(result.value.matches[0]?.entrantA).not.toHaveProperty('shortName');
  });
});
