import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_LOCAL_BP_MAP_POOL,
  inspectBp,
  localBpSequence,
} from '@rivalhub-broadcast/core/projection';
import {
  toMatchContext,
  validateBroadcastManifest,
  type BroadcastManifestV1,
} from '@rivalhub-broadcast/rivalhub';
import { describe, expect, it } from 'vitest';

import { createLocalBpManifest } from '../src/bp/local-draft.js';
import { MatchContextController } from '../src/match-context/controller.js';
import { MatchManifestLkgStore, type MatchContextBinding } from '../src/match-context/lkg-store.js';

function draftFor(format: 'bo1' | 'bo3' | 'bo5') {
  const mapPool = [...DEFAULT_LOCAL_BP_MAP_POOL];
  const banIndexes =
    format === 'bo1' ? [0, 1, 2, 3, 4, 5] : format === 'bo3' ? [0, 1, 4, 5] : [0, 1];
  const pickIndexes = format === 'bo1' ? [] : format === 'bo3' ? [2, 3] : [2, 3, 4, 5];
  return {
    competitionName: 'NJU Rivals',
    stage: '决赛',
    format,
    entrants: {
      a: { name: '完整左队名', logoUrl: null },
      b: { name: "Team D'avenir", logoUrl: null },
    },
    vetoA: 'a' as const,
    mapPool,
    bans: banIndexes.map((index) => mapPool[index]!),
    picks: pickIndexes.map((index, position) => ({
      mapName: mapPool[index]!,
      side: position % 2 === 0 ? ('CT' as const) : ('T' as const),
    })),
    deciderSide: format === 'bo5' ? null : ('T' as const),
  };
}

async function knownManifest(): Promise<BroadcastManifestV1> {
  const candidate: unknown = JSON.parse(
    await readFile(
      resolve(process.cwd(), 'packages/rivalhub/test/fixtures/broadcast-manifest-v1.valid.json'),
      'utf8',
    ),
  );
  const result = validateBroadcastManifest(candidate);
  if (!result.ok) throw new Error('Companion test Manifest fixture is invalid');
  return result.value;
}

function bindingFor(
  manifest: BroadcastManifestV1,
  origin: MatchContextBinding['origin'],
): MatchContextBinding {
  return {
    manifest,
    context: toMatchContext(manifest),
    origin,
    freshness: 'fresh',
    diagnostics: [],
  };
}

describe('local BP authoring', () => {
  it.each([
    ['bo1', ['ban', 'ban', 'ban', 'ban', 'ban', 'ban', 'decider', 'side_pick']],
    [
      'bo3',
      [
        'ban',
        'ban',
        'pick',
        'side_pick',
        'pick',
        'side_pick',
        'ban',
        'ban',
        'decider',
        'side_pick',
      ],
    ],
    [
      'bo5',
      [
        'ban',
        'ban',
        'pick',
        'side_pick',
        'pick',
        'side_pick',
        'pick',
        'side_pick',
        'pick',
        'side_pick',
        'decider',
      ],
    ],
  ] as const)(
    'compiles the canonical %s sequence to a valid Manifest and BP context',
    (format, kinds) => {
      const result = createLocalBpManifest(draftFor(format));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.manifest.veto.map((step) => step.actionType)).toEqual(kinds);
      expect(
        result.manifest.veto.map((step) =>
          step.actionType === 'decider'
            ? null
            : step.entryId === result.manifest.entrants.a.entryId
              ? 'a'
              : step.entryId === result.manifest.entrants.b.entryId
                ? 'b'
                : null,
        ),
      ).toEqual(localBpSequence(format, 'a').map((step) => step.actor));
      expect(validateBroadcastManifest(result.manifest).ok).toBe(true);
      const projection = inspectBp(toMatchContext(result.manifest));
      expect(projection.readiness).toBe('ready');
      expect(projection.projection?.entrants.a.name).toBe('完整左队名');
      expect(projection.projection?.entrants.b.name).toBe("Team D'avenir");
      expect(result.manifest.maps).toHaveLength(format === 'bo1' ? 1 : format === 'bo3' ? 3 : 5);
      expect(result.manifest.maps.at(-1)?.mapName).toBe('de_cache');
      expect(projection.projection?.cards.at(-1)?.sideChoice).toEqual(
        format === 'bo5' ? null : { entrant: 'b', side: 'T' },
      );
    },
  );

  it('keeps match A/B identity fixed when Veto A changes', () => {
    const draft = { ...draftFor('bo3'), vetoA: 'b' as const };
    const result = createLocalBpManifest(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.entrants.a.name).toBe('完整左队名');
    expect(result.manifest.entrants.b.name).toBe("Team D'avenir");
    expect(result.manifest.veto[0]?.entryId).toBe(result.manifest.entrants.b.entryId);
    expect(result.manifest.veto[2]?.entryId).toBe(result.manifest.entrants.b.entryId);
    expect(result.manifest.veto[3]?.entryId).toBe(result.manifest.entrants.a.entryId);
  });

  it('rejects duplicate maps, incomplete sides, and a BO5 decider side', () => {
    const draft = draftFor('bo3');
    expect(
      createLocalBpManifest({
        ...draft,
        bans: [draft.bans[0], draft.bans[0], ...draft.bans.slice(2)],
      }),
    ).toMatchObject({ ok: false, code: 'bp_draft_maps_duplicate' });
    expect(
      createLocalBpManifest({
        ...draft,
        picks: [{ ...draft.picks[0]!, side: null }, draft.picks[1]!],
      }),
    ).toMatchObject({ ok: false, code: 'bp_draft_sides_incomplete' });
    expect(createLocalBpManifest({ ...draftFor('bo5'), deciderSide: 'CT' })).toMatchObject({
      ok: false,
      code: 'bp_draft_decider_knife',
    });
    expect(createLocalBpManifest({ ...draft, mapPool: draft.mapPool.slice(1) })).toMatchObject({
      ok: false,
      code: 'bp_draft_map_pool_invalid',
    });
  });

  it('preserves the current binding on failed save and stores a successful local save in the LKG', async () => {
    const previous = await knownManifest();
    const compiled = createLocalBpManifest(draftFor('bo3'));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const directory = await mkdtemp(join(tmpdir(), 'bp-local-test-'));
    try {
      const failedController = new MatchContextController({
        lkgStore: new MatchManifestLkgStore({
          filePath: join(directory, 'failed.json'),
          faultInjector: (point) => {
            if (point === 'before-write') throw new Error('injected local BP save failure');
          },
        }),
        initialBinding: bindingFor(previous, 'online'),
      });
      const previousBinding = failedController.getActiveBinding();
      const failed = await failedController.selectLocalMatch(
        compiled.manifest,
        failedController.getActiveRevision(),
      );
      expect(failed.ok).toBe(false);
      expect(failedController.getActiveBinding()).toBe(previousBinding);

      const store = new MatchManifestLkgStore({ filePath: join(directory, 'match.json') });
      const controller = new MatchContextController({
        lkgStore: store,
        initialBinding: bindingFor(previous, 'online'),
      });
      const saved = await controller.selectLocalMatch(
        compiled.manifest,
        controller.getActiveRevision(),
      );
      expect(saved.ok).toBe(true);
      expect(controller.getActiveBinding()?.origin).toBe('local');
      const restored = await store.readLatest();
      expect(restored).toMatchObject({
        ok: true,
        value: { origin: 'cache', cachedFrom: 'local', manifest: { match: { format: 'bo3' } } },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stages a recovered online match until the operator explicitly switches back', async () => {
    const online = await knownManifest();
    const local = createLocalBpManifest(draftFor('bo3'));
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    const directory = await mkdtemp(join(tmpdir(), 'bp-local-online-test-'));
    try {
      const controller = new MatchContextController({
        lkgStore: new MatchManifestLkgStore({ filePath: join(directory, 'match.json') }),
        initialBinding: bindingFor(local.manifest, 'local'),
      });
      const localBinding = controller.getActiveBinding();
      const staged = await controller.selectMatch(online.match.matchId, {
        kind: 'online',
        load: () => Promise.resolve(online),
      });
      expect(staged.ok).toBe(true);
      expect(controller.getActiveBinding()).toBe(localBinding);
      expect(controller.getPendingOnlineBinding()?.manifest.match.matchId).toBe(
        online.match.matchId,
      );

      const switched = await controller.activatePendingOnlineMatch(controller.getActiveRevision());
      expect(switched.ok).toBe(true);
      expect(controller.getActiveBinding()?.origin).toBe('online');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
