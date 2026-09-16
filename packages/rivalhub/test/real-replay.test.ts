import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  createIdentityResolver,
  identityEvidenceFromObservation,
  type IdentityResolver,
} from '@rivalhub-broadcast/core/identity';
import type { MatchContext } from '@rivalhub-broadcast/core/match-context';
import type { TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';
import { verifyCapture, replayCapture } from '@rivalhub-broadcast/testkit';
import { describe, expect, it } from 'vitest';

import { toMatchContext, type BroadcastManifestV1 } from '../src/index.js';

const semanticRoot = resolve(process.cwd(), 'fixtures/gsi/semantic');

const REDACTED_REAL_PLAYER_ALIASES: Readonly<Record<string, string>> = {
  'fixture-player-001': '76561198000000001',
  'fixture-player-002': '76561198000000011',
  'fixture-player-003': '76561198000000012',
  'fixture-player-004': '76561198000000002',
  'fixture-player-005': '76561198000000013',
  'fixture-player-006': '76561198000000003',
  'fixture-player-007': '76561198000000004',
  'fixture-player-008': '76561198000000005',
  'fixture-player-009': '76561198000000014',
  'fixture-player-011': '76561198000000015',
};

async function manifestContext(): Promise<MatchContext> {
  const fixture = JSON.parse(
    await readFile(
      resolve(process.cwd(), 'packages/rivalhub/test/fixtures/broadcast-manifest-v1.valid.json'),
      'utf8',
    ),
  ) as BroadcastManifestV1;
  return toMatchContext(fixture);
}

async function observationAt(path: string, sequence: number): Promise<TelemetryObservation> {
  const capture = await verifyCapture(path);
  for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
    if (event.kind !== 'frame' || event.sourceFrame.sequence !== sequence) continue;
    if (!event.result.ok) throw new Error(`真实 GSI replay 在 seq=${sequence} 适配失败`);
    return event.result.observation;
  }
  throw new Error(`真实 GSI replay 缺少 seq=${sequence}`);
}

function resolveObservation(
  resolver: IdentityResolver,
  observation: TelemetryObservation,
  sourceGeneration: number,
  mapEpoch: number,
) {
  return resolver.resolve(identityEvidenceFromObservation(observation, sourceGeneration, mapEpoch));
}

describe('现有真实 GSI evidence 的 Manifest identity replay acceptance', () => {
  it('maps all ten redacted real-capture players through an explicit Steam64 fixture alias', async () => {
    const context = await manifestContext();
    const resolver = createIdentityResolver(context, {
      sourceIdAliases: REDACTED_REAL_PLAYER_ALIASES,
    });
    const observation = await observationAt(resolve(semanticRoot, 'observer/rich-live-state'), 727);
    const resolution = resolveObservation(resolver, observation, 1, 1);

    expect(resolution.state).toBe('matched');
    expect(resolution.players).toHaveLength(10);
    expect(resolution.unresolved).toHaveLength(0);
    expect(resolution.issues.map((issue) => issue.code)).not.toContain('unexpected_human_steam64');
  });

  it('keeps entry identity stable and follows map-side evidence across halftime and overtime swaps', async () => {
    const context = await manifestContext();
    const resolver = createIdentityResolver(context, {
      sourceIdAliases: REDACTED_REAL_PLAYER_ALIASES,
    });
    const halftimeBefore = await observationAt(
      resolve(semanticRoot, 'match/halftime-side-switch'),
      6145,
    );
    const halftimeAfter = await observationAt(
      resolve(semanticRoot, 'match/halftime-side-switch'),
      6147,
    );
    const first = resolveObservation(resolver, halftimeBefore, 1, 1);
    const second = resolveObservation(resolver, halftimeAfter, 1, 1);
    const overtimeBefore = await observationAt(
      resolve(semanticRoot, 'match/overtime-side-switch'),
      14461,
    );
    const overtimeAfter = await observationAt(
      resolve(semanticRoot, 'match/overtime-side-switch'),
      14463,
    );
    const third = resolveObservation(resolver, overtimeBefore, 1, 1);
    const fourth = resolveObservation(resolver, overtimeAfter, 1, 1);

    expect(first.state).toBe('matched');
    expect(second.state).toBe('matched');
    expect(first.sideMapping).toEqual({ a: 'CT', b: 'T' });
    expect(second.sideMapping).toEqual({ a: 'T', b: 'CT' });
    expect(third.state).toBe('matched');
    expect(fourth.state).toBe('matched');
    expect(third.sideMapping).toEqual({ a: 'T', b: 'CT' });
    expect(fourth.sideMapping).toEqual({ a: 'CT', b: 'T' });
    expect(fourth.players.map((player) => player.canonicalPlayerId)).toEqual(
      first.players.map((player) => player.canonicalPlayerId),
    );
  });

  it('replays an actual multi-round capture without a false identity mismatch', async () => {
    const context = await manifestContext();
    const resolver = createIdentityResolver(context, {
      sourceIdAliases: REDACTED_REAL_PLAYER_ALIASES,
    });
    const capture = await verifyCapture(resolve(semanticRoot, 'match/regulation-to-overtime'));
    const states: string[] = [];
    let lastResolution = resolver.getResolution();
    for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
      if (event.kind !== 'frame' || !event.result.ok) continue;
      lastResolution = resolveObservation(resolver, event.result.observation, 1, 1);
      states.push(lastResolution.state);
    }

    expect(states.length).toBeGreaterThan(1);
    expect(states).not.toContain('mismatch');
    expect(lastResolution.players).toHaveLength(10);
  });

  it('forces a new proof after a replay source-generation or map-epoch boundary', async () => {
    const context = await manifestContext();
    const resolver = createIdentityResolver(context, {
      sourceIdAliases: REDACTED_REAL_PLAYER_ALIASES,
    });
    const observation = await observationAt(resolve(semanticRoot, 'observer/rich-live-state'), 727);
    const matched = resolveObservation(resolver, observation, 1, 1);
    const sourceReset = resolver.resolve({
      sourceGeneration: 2,
      mapEpoch: 1,
      allPlayersCoverage: 'absent',
      mapName: 'de_ancient',
      mapPhase: 'live',
    });
    const rebuilt = resolveObservation(resolver, observation, 2, 1);
    const mapReset = resolver.resolve({
      sourceGeneration: 2,
      mapEpoch: 2,
      allPlayersCoverage: 'absent',
      mapName: 'de_ancient',
      mapPhase: 'live',
    });

    expect(matched.state).toBe('matched');
    expect(sourceReset.state).toBe('resolving');
    expect(sourceReset.players).toHaveLength(0);
    expect(rebuilt.state).toBe('matched');
    expect(mapReset.state).toBe('resolving');
    expect(mapReset.players).toHaveLength(0);
  });
});
