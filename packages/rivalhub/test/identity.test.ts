import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createIdentityResolver,
  resolveIdentity,
  type IdentityResolution,
} from '@rivalhub-broadcast/core/identity';
import type { MatchContext } from '@rivalhub-broadcast/core/match-context';
import type { ObservedPlayer } from '@rivalhub-broadcast/core/telemetry';
import { describe, expect, it } from 'vitest';

import { toMatchContext, type BroadcastManifestV1 } from '../src/index.js';

const fixtureRoot = resolve(process.cwd(), 'packages/rivalhub/test/fixtures');

async function readManifest(): Promise<BroadcastManifestV1> {
  return JSON.parse(
    await readFile(resolve(fixtureRoot, 'broadcast-manifest-v1.valid.json'), 'utf8'),
  ) as BroadcastManifestV1;
}

function canonicalPlayers(context: MatchContext) {
  return [
    ...context.entrants.a.players.map((player) => ({
      ...player,
      entryId: context.entrants.a.entryId,
    })),
    ...context.entrants.b.players.map((player) => ({
      ...player,
      entryId: context.entrants.b.entryId,
    })),
  ];
}

function aliasesFor(context: MatchContext): Record<string, string> {
  return Object.fromEntries(
    canonicalPlayers(context)
      .filter((player): player is typeof player & { steam64: string } => player.steam64 !== null)
      .map((player) => [`fixture-${player.playerId}`, player.steam64]),
  );
}

function observedPlayers(
  context: MatchContext,
  options: {
    readonly sideA?: 'CT' | 'T';
    readonly sideB?: 'CT' | 'T';
    readonly includeSubstitute?: boolean;
    readonly count?: number;
    readonly nicknameSuffix?: string;
    readonly slotOffset?: number;
  } = {},
): ObservedPlayer[] {
  const sideA = options.sideA ?? 'CT';
  const sideB = options.sideB ?? 'T';
  const active = canonicalPlayers(context).filter(
    (player) => player.isStarter || options.includeSubstitute === true,
  );
  const selected = active.slice(0, options.count ?? 10);
  return selected.map((player, index) => ({
    sourcePlayerId: `fixture-${player.playerId}`,
    displayName: `游戏昵称-${options.nicknameSuffix ?? '初始'}-${index}`,
    observerSlot: (options.slotOffset ?? 0) + index + 1,
    side: player.entryId === context.entrants.a.entryId ? sideA : sideB,
  }));
}

function evidence(
  players: readonly ObservedPlayer[] | undefined,
  overrides: {
    readonly sourceGeneration?: number;
    readonly mapEpoch?: number;
    readonly allPlayersCoverage?: 'present' | 'absent' | 'degraded';
    readonly mapName?: string;
    readonly mapPhase?: 'warmup' | 'live' | 'intermission' | 'gameover' | 'unknown';
  } = {},
) {
  return {
    sourceGeneration: overrides.sourceGeneration ?? 1,
    mapEpoch: overrides.mapEpoch ?? 1,
    ...(players === undefined ? {} : { allPlayers: players }),
    allPlayersCoverage:
      overrides.allPlayersCoverage ?? (players === undefined ? 'absent' : 'present'),
    ...(overrides.mapName === undefined ? {} : { mapName: overrides.mapName }),
    ...(overrides.mapPhase === undefined ? {} : { mapPhase: overrides.mapPhase }),
  } as const;
}

function issueCodes(resolution: IdentityResolution): string[] {
  return resolution.issues.map((entry) => entry.code);
}

describe('Steam64 identity resolver and dynamic side mapping', () => {
  it('matches a complete 10-player lineup by Steam64 and entryId', async () => {
    const context = toMatchContext(await readManifest());
    const resolution = resolveIdentity(
      context,
      evidence(observedPlayers(context), { mapName: 'de_ancient', mapPhase: 'live' }),
      undefined,
      { sourceIdAliases: aliasesFor(context) },
    );

    expect(resolution.state).toBe('matched');
    expect(resolution.players).toHaveLength(10);
    expect(resolution.unresolved).toHaveLength(0);
    expect(resolution.sideMapping).toEqual({ a: 'CT', b: 'T' });
    expect(resolution.capabilities).toEqual({
      canonicalPlayerMapping: true,
      canonicalTeamBranding: true,
      identityDependentResult: true,
      neutralTelemetry: true,
    });
  });

  it('updates only side mapping when halftime or overtime swaps CT/T', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const before = resolveIdentity(context, evidence(observedPlayers(context)), undefined, options);
    const after = resolveIdentity(
      context,
      evidence(observedPlayers(context, { sideA: 'T', sideB: 'CT' })),
      before,
      options,
    );

    expect(before.state).toBe('matched');
    expect(after.state).toBe('matched');
    expect(after.sideMapping).toEqual({ a: 'T', b: 'CT' });
    expect(after.players.map((player) => player.canonicalPlayerId)).toEqual(
      before.players.map((player) => player.canonicalPlayerId),
    );
  });

  it('ignores nickname and observer-slot changes for identity matching', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const before = resolveIdentity(context, evidence(observedPlayers(context)), undefined, options);
    const after = resolveIdentity(
      context,
      evidence(observedPlayers(context, { nicknameSuffix: '改名', slotOffset: 20 })),
      before,
      options,
    );

    expect(after.state).toBe('matched');
    expect(after.players.map((player) => player.canonicalPlayerId)).toEqual(
      before.players.map((player) => player.canonicalPlayerId),
    );
  });

  it('keeps a legal substitute matched and emits lineup_differs_from_expected', async () => {
    const context = toMatchContext(await readManifest());
    const resolution = resolveIdentity(
      context,
      evidence(observedPlayers(context, { includeSubstitute: true, count: 11 }), {
        mapName: 'de_ancient',
      }),
      undefined,
      { sourceIdAliases: aliasesFor(context) },
    );

    expect(resolution.state).toBe('matched');
    expect(resolution.players).toHaveLength(11);
    expect(issueCodes(resolution)).toContain('lineup_differs_from_expected');
  });

  it('treats a partial lineup as degraded while preserving the mapped players', async () => {
    const context = toMatchContext(await readManifest());
    const resolution = resolveIdentity(
      context,
      evidence(observedPlayers(context, { count: 9 })),
      undefined,
      { sourceIdAliases: aliasesFor(context) },
    );

    expect(resolution.state).toBe('degraded');
    expect(resolution.players).toHaveLength(9);
    expect(issueCodes(resolution)).toContain('partial_roster_evidence');
  });

  it('keeps legal identities on a single absent or degraded allplayers frame', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const resolver = createIdentityResolver(context, options);
    const matched = resolver.resolve(evidence(observedPlayers(context)));
    const absent = resolver.resolve(evidence(undefined, { allPlayersCoverage: 'absent' }));
    const degraded = resolver.resolve(
      evidence(observedPlayers(context), { allPlayersCoverage: 'degraded' }),
    );

    expect(matched.state).toBe('matched');
    expect(absent.state).toBe('degraded');
    expect(absent.players).toHaveLength(10);
    expect(degraded.state).toBe('degraded');
    expect(degraded.players).toHaveLength(10);
  });

  it('does not reuse old proof across source generation or map epoch baselines', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const matched = resolveIdentity(
      context,
      evidence(observedPlayers(context)),
      undefined,
      options,
    );
    const newGeneration = resolveIdentity(
      context,
      evidence(undefined, { sourceGeneration: 2 }),
      matched,
      options,
    );
    const newMap = resolveIdentity(context, evidence(undefined, { mapEpoch: 2 }), matched, options);

    expect(newGeneration.state).toBe('resolving');
    expect(newGeneration.players).toHaveLength(0);
    expect(issueCodes(newGeneration)).toContain('source_generation_changed');
    expect(newMap.state).toBe('resolving');
    expect(newMap.players).toHaveLength(0);
    expect(issueCodes(newMap)).toContain('map_epoch_changed');
  });

  it('fails closed for unexpected or duplicated human Steam64 while keeping neutral telemetry', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const unexpected = observedPlayers(context);
    unexpected[0] = { ...unexpected[0]!, sourcePlayerId: '76561198000000099' };
    const mismatch = resolveIdentity(context, evidence(unexpected), undefined, options);
    const duplicate = resolveIdentity(
      context,
      evidence([...observedPlayers(context), observedPlayers(context)[0]!]),
      undefined,
      options,
    );

    expect(mismatch.state).toBe('mismatch');
    expect(mismatch.capabilities.canonicalTeamBranding).toBe(false);
    expect(mismatch.capabilities.identityDependentResult).toBe(false);
    expect(mismatch.capabilities.neutralTelemetry).toBe(true);
    expect(issueCodes(mismatch)).toContain('unexpected_human_steam64');
    expect(duplicate.state).toBe('mismatch');
    expect(issueCodes(duplicate)).toContain('duplicate_observed_identity');
  });

  it('does not guess BOT/non-Steam64 identities and handles missing canonical Steam64 locally', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const withBot = observedPlayers(context);
    withBot[0] = { ...withBot[0]!, sourcePlayerId: 'BOT-001' };
    const degraded = resolveIdentity(context, evidence(withBot), undefined, options);
    const incompleteContext: MatchContext = {
      ...context,
      entrants: {
        ...context.entrants,
        a: {
          ...context.entrants.a,
          players: context.entrants.a.players.map((player, index) =>
            index === 0 ? { ...player, steam64: null } : player,
          ),
        },
      },
    };
    const missingCanonical = resolveIdentity(
      incompleteContext,
      evidence(observedPlayers(context)),
      undefined,
      options,
    );

    expect(degraded.state).toBe('degraded');
    expect(degraded.players).toHaveLength(9);
    expect(issueCodes(degraded)).toContain('bot_or_noncanonical_source_id');
    expect(missingCanonical.state).toBe('degraded');
    expect(issueCodes(missingCanonical)).toContain('missing_canonical_steam64');
  });

  it('only marks a wrong live map as mismatch after gameplay evidence is explicit', async () => {
    const context = toMatchContext(await readManifest());
    const options = { sourceIdAliases: aliasesFor(context) };
    const warmup = resolveIdentity(
      context,
      evidence(observedPlayers(context), { mapName: 'de_wrong', mapPhase: 'warmup' }),
      undefined,
      options,
    );
    const live = resolveIdentity(
      context,
      evidence(observedPlayers(context), { mapName: 'de_wrong', mapPhase: 'live' }),
      undefined,
      options,
    );

    expect(warmup.state).toBe('matched');
    expect(issueCodes(warmup)).toContain('map_not_confirmed');
    expect(live.state).toBe('mismatch');
    expect(issueCodes(live)).toContain('map_mismatch');
  });

  it('starts unbound and can be rebound without carrying prior identity proof', async () => {
    const context = toMatchContext(await readManifest());
    const resolver = createIdentityResolver(undefined, { sourceIdAliases: aliasesFor(context) });
    expect(resolver.getResolution().state).toBe('unbound');
    expect(resolver.bind(context).state).toBe('resolving');
    expect(
      resolver.resolve(evidence(observedPlayers(context), { mapName: 'de_ancient' })).state,
    ).toBe('matched');
  });
});
