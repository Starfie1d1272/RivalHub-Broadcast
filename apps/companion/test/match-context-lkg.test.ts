import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFixtureManifestSource,
  MatchContextController,
  MatchManifestLkgStore,
  ScheduleWindowLkgStore,
} from '../src/match-context/index.js';
import type { BroadcastManifestV1, BroadcastScheduleWindowV1 } from '@rivalhub-broadcast/rivalhub';

const fixtureRoot = resolve(process.cwd(), 'packages/rivalhub/test/fixtures');
const temporaryRoots: string[] = [];

async function readFixture<T>(fileName: string): Promise<T> {
  return JSON.parse(await readFile(join(fixtureRoot, fileName), 'utf8')) as T;
}

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rivalhub-broadcast-m2-'));
  temporaryRoots.push(root);
  return root;
}

function source(kind: 'online' | 'fixture', value: unknown) {
  return { kind, load: () => Promise.resolve(value) } as const;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('Match Manifest last-known-good seam', () => {
  it('saves a valid candidate as raw DTO and restores it with stale metadata', async () => {
    const root = await temporaryDirectory();
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const store = new MatchManifestLkgStore({
      filePath: join(root, 'manifest.json'),
      clock: () => '2026-09-16T12:00:00.000Z',
    });

    const saved = await store.save(manifest, 'online');
    const restored = await store.read(manifest.match.matchId);

    expect(saved.ok).toBe(true);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error('saved LKG should restore');
    expect(restored.value.origin).toBe('cache');
    expect(restored.value.freshness).toBe('stale');
    expect(restored.value.cachedFrom).toBe('online');
    expect(restored.value.storedAt).toBe('2026-09-16T12:00:00.000Z');
    expect(restored.value.manifest).toEqual(manifest);
    expect(restored.value.context.matchId).toBe(manifest.match.matchId);
    expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))).toEqual(manifest);
  });

  it('uses the same-shape local fixture as a Companion source', async () => {
    const root = await temporaryDirectory();
    const manifestPath = join(fixtureRoot, 'broadcast-manifest-v1.valid.json');
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const controller = new MatchContextController({
      lkgStore: new MatchManifestLkgStore({ filePath: join(root, 'manifest.json') }),
    });

    const result = await controller.selectMatch(
      manifest.match.matchId,
      createFixtureManifestSource(manifestPath),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('same-shape fixture should bind');
    expect(result.binding.origin).toBe('fixture');
    expect(result.binding.freshness).toBe('fresh');
  });

  it('does not overwrite a valid LKG with malformed or semantically invalid input', async () => {
    const root = await temporaryDirectory();
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const store = new MatchManifestLkgStore({ filePath: join(root, 'manifest.json') });
    expect((await store.save(manifest, 'fixture')).ok).toBe(true);

    const malformed = { ...manifest, schemaVersion: 'rivalhub.broadcast-manifest.v9' };
    const invalid = await store.save(malformed, 'online');
    const restored = await store.read(manifest.match.matchId);

    expect(invalid.ok).toBe(false);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error('original LKG should remain');
    expect(restored.value.manifest.revision).toBe(manifest.revision);
  });

  it('only restores an exact requested match and never chooses a nearest match', async () => {
    const root = await temporaryDirectory();
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const store = new MatchManifestLkgStore({ filePath: join(root, 'manifest.json') });
    expect((await store.save(manifest, 'online')).ok).toBe(true);

    const different = await store.read('match-m2-not-the-current-one');
    expect(different.ok).toBe(false);
    if (different.ok) throw new Error('different match must not restore');
    expect(different.issue.code).toBe('lkg_match_mismatch');
  });

  it('clears A before selecting B, so B failure cannot leak A branding', async () => {
    const root = await temporaryDirectory();
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const store = new MatchManifestLkgStore({ filePath: join(root, 'manifest.json') });
    const controller = new MatchContextController({ lkgStore: store });
    const first = await controller.selectMatch(manifest.match.matchId, source('fixture', manifest));
    expect(first.ok).toBe(true);
    expect(controller.getActiveBinding()?.context.matchId).toBe(manifest.match.matchId);

    const failed = await controller.selectMatch('match-m2-next', {
      kind: 'online',
      load: () => Promise.reject(new Error('offline')),
    });

    expect(failed.ok).toBe(false);
    expect(controller.getActiveBinding()).toBeUndefined();
    expect(failed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['source_load_failed', 'lkg_unavailable']),
    );
  });

  it('uses same-match LKG on source failure and restores deterministically after process restart', async () => {
    const root = await temporaryDirectory();
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const filePath = join(root, 'manifest.json');
    const store = new MatchManifestLkgStore({ filePath });
    const controller = new MatchContextController({ lkgStore: store });
    expect(
      (await controller.selectMatch(manifest.match.matchId, source('online', manifest))).ok,
    ).toBe(true);

    const restarted = new MatchContextController({
      lkgStore: new MatchManifestLkgStore({ filePath }),
    });
    const result = await restarted.selectMatch(manifest.match.matchId, {
      kind: 'online',
      load: () => Promise.reject(new Error('offline')),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('same-match LKG should be used');
    expect(result.binding.origin).toBe('cache');
    expect(result.binding.freshness).toBe('stale');
    expect(result.binding.context).toEqual(controller.getActiveBinding()?.context);
  });

  it('rejects an unsupported-schema LKG during the same reload validation path', async () => {
    const root = await temporaryDirectory();
    const filePath = join(root, 'manifest.json');
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    await writeFile(
      filePath,
      `${JSON.stringify({ ...manifest, schemaVersion: 'rivalhub.broadcast-manifest.v9' })}\n`,
      'utf8',
    );
    const result = await new MatchManifestLkgStore({ filePath }).read(manifest.match.matchId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unsupported schema must not restore');
    expect(result.issue.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_schema_version' })]),
    );
  });
});

describe('independent ScheduleWindow last-known-good seam', () => {
  it('refreshes online data and retains stale schedule when the next source fails', async () => {
    const root = await temporaryDirectory();
    const schedule = await readFixture<BroadcastScheduleWindowV1>(
      'broadcast-schedule-window-v1.valid.json',
    );
    const store = new ScheduleWindowLkgStore({
      filePath: join(root, 'schedule.json'),
      clock: () => '2026-09-16T12:01:00.000Z',
    });

    const fresh = await store.refresh(source('online', schedule));
    const stale = await store.refresh({
      kind: 'online',
      load: () => Promise.reject(new Error('schedule service offline')),
    });

    expect(fresh.ok).toBe(true);
    expect(stale.ok).toBe(true);
    if (!stale.ok) throw new Error('schedule LKG should remain available');
    expect(stale.value.origin).toBe('cache');
    expect(stale.value.freshness).toBe('stale');
    expect(stale.value.window.matches[0]?.matchId).toBe('match-m2-00');
    expect(stale.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'schedule_source_failed' })]),
    );
  });

  it('does not couple schedule failure to an active MatchContext', async () => {
    const root = await temporaryDirectory();
    const manifest = await readFixture<BroadcastManifestV1>('broadcast-manifest-v1.valid.json');
    const schedule = await readFixture<BroadcastScheduleWindowV1>(
      'broadcast-schedule-window-v1.valid.json',
    );
    const matchStore = new MatchManifestLkgStore({ filePath: join(root, 'manifest.json') });
    const controller = new MatchContextController({ lkgStore: matchStore });
    expect(
      (await controller.selectMatch(manifest.match.matchId, source('fixture', manifest))).ok,
    ).toBe(true);
    const before = controller.getActiveBinding();
    const scheduleStore = new ScheduleWindowLkgStore({ filePath: join(root, 'schedule.json') });
    expect((await scheduleStore.save(schedule, 'fixture')).ok).toBe(true);

    const failure = await scheduleStore.refresh({
      kind: 'fixture',
      load: () => Promise.resolve({ ...schedule, revision: 'broken', from: 'not-a-time' }),
    });

    expect(failure.ok).toBe(true);
    expect(controller.getActiveBinding()).toEqual(before);
  });
});
