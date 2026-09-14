import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { iterateCaptureFrames, verifyCapture } from '../src/capture/reader.js';
import type { VerifiedCapture } from '../src/capture/types.js';
import { replayCapture } from '../src/replay/runner.js';
import type { ReplayedGsiFrame } from '../src/replay/types.js';

const GOLD_FIXTURES = [
  {
    name: 'observer-demo-warmup',
    frameCount: 157,
    firstSequence: 0,
    lastSequence: 156,
    sourceFramesSha256: '519cec4f94f93b2cbc3b34d5e32d60e428039a94b3999d058a56910afcd7c5f9',
    framesSha256: '03d3941307f8c7e5c7ab9a575e7b594ea33efe748554c967f033c57a1875c003',
    selection: { kind: 'all' },
  },
  {
    name: 'local-bot-spectator-live',
    frameCount: 261,
    firstSequence: 540,
    lastSequence: 800,
    sourceFramesSha256: 'e34505e2626dfa6f0941b8b4ed675dbea38e2ff53e29e3240c36ad7a2673d218',
    framesSha256: 'ccf207ecd8b86c5a14f6f8901fff1688ee7e4892542013540fc2a8add2fb81b2',
    selection: { kind: 'sequence-range', firstSequence: 540, lastSequence: 800 },
  },
] as const;

function goldCapturePath(name: string): string {
  return resolve(process.cwd(), 'fixtures/gsi/gold', name);
}

async function replayResultsAt(
  capture: VerifiedCapture,
  sequences: readonly number[],
): Promise<ReadonlyMap<number, ReplayedGsiFrame['result']>> {
  const wanted = new Set(sequences);
  const results = new Map<number, ReplayedGsiFrame['result']>();
  for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
    if (event.kind === 'frame' && wanted.has(event.sourceFrame.sequence)) {
      results.set(event.sourceFrame.sequence, event.result);
    }
  }
  return results;
}

function resultAt(
  results: ReadonlyMap<number, ReplayedGsiFrame['result']>,
  sequence: number,
): ReplayedGsiFrame['result'] {
  const result = results.get(sequence);
  if (result === undefined) throw new Error(`missing replay result for seq=${sequence}`);
  return result;
}

function successfulObservation(
  result: ReplayedGsiFrame['result'],
  sequence: number,
): Extract<ReplayedGsiFrame['result'], { readonly ok: true }>['observation'] {
  expect(result.ok, `production replay failed at seq=${sequence}`).toBe(true);
  if (!result.ok) throw new Error(`production replay failed at seq=${sequence}`);
  return result.observation;
}

describe('real sanitized gold capture replay', () => {
  it.each(GOLD_FIXTURES)(
    '$name verifies capture integrity and frame boundaries',
    async (fixture) => {
      const capture = await verifyCapture(goldCapturePath(fixture.name));
      expect(capture.manifest.frameCount).toBe(fixture.frameCount);
      expect(capture.manifest.framesSha256).toBe(fixture.framesSha256);
      expect(capture.manifest.provenance).toMatchObject({
        fixtureKind: 'sanitized-real-capture',
        sourceFramesSha256: fixture.sourceFramesSha256,
        sourceFrameSelection: fixture.selection,
        sanitizerVersion: 1,
      });

      const firstAndLast: number[] = [];
      for await (const frame of iterateCaptureFrames(capture)) {
        if (firstAndLast.length === 0) firstAndLast.push(frame.sequence);
        firstAndLast[1] = frame.sequence;
      }
      expect(firstAndLast).toEqual([fixture.firstSequence, fixture.lastSequence]);
    },
  );

  it('replays Gold B seq=45 through production telemetry semantics', async () => {
    const capture = await verifyCapture(goldCapturePath('observer-demo-warmup'));
    const results = await replayResultsAt(capture, [45]);
    const observation = successfulObservation(resultAt(results, 45), 45);
    const telemetry = observation.telemetry;

    expect(telemetry.allPlayers).toHaveLength(10);
    expect(telemetry.player?.position).toEqual({ x: -520, y: -2224, z: -163.3 });
    expect(telemetry.player?.forward).toEqual({ x: -0.625, y: 0.778, z: -0.066 });
    expect(telemetry.player?.weapons).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'weapon_ak47', type: 'Rifle' })]),
    );
    expect(telemetry.phaseCountdowns).toEqual({ phase: 'warmup', endsInSeconds: 7.4 });

    const grenades = telemetry.grenades;
    if (grenades === undefined) throw new Error('seq=45 grenades were not normalized');
    expect(grenades.length).toBeGreaterThan(0);
    expect(grenades.map((grenade) => grenade.kind)).toEqual(
      expect.arrayContaining(['frag', 'inferno']),
    );
    const inferno = grenades.find((grenade) => grenade.kind === 'inferno');
    if (inferno === undefined) throw new Error('seq=45 inferno was not normalized');
    expect(inferno.flames?.[0]?.position).toEqual({ x: 598, y: -793, z: 92 });
  });

  it('replays Gold C lifecycle checkpoints through production telemetry semantics', async () => {
    const capture = await verifyCapture(goldCapturePath('local-bot-spectator-live'));
    const results = await replayResultsAt(capture, [567, 580, 661, 746, 761, 775]);

    const planting = successfulObservation(resultAt(results, 567), 567);
    expect(planting.telemetry.bomb?.state).toBe('planting');

    const planted = successfulObservation(resultAt(results, 580), 580);
    expect(planted.telemetry.bomb?.state).toBe('planted');
    expect(planted.telemetry.round?.bomb).toEqual({ state: 'planted' });

    const defusing = successfulObservation(resultAt(results, 661), 661);
    expect(defusing.telemetry.bomb?.state).toBe('defusing');

    const exploded = successfulObservation(resultAt(results, 746), 746);
    expect(exploded.telemetry.bomb?.state).toBe('exploded');
    expect(exploded.telemetry.round).toEqual({
      phase: 'over',
      bomb: { state: 'exploded' },
      winnerSide: 'T',
    });

    const degraded = successfulObservation(resultAt(results, 761), 761);
    expect(degraded.coverage.player).toBe('degraded');
    expect(degraded.telemetry.player).toBeUndefined();

    const freezetime = successfulObservation(resultAt(results, 775), 775);
    expect(freezetime.telemetry.round).toEqual({ phase: 'freezetime' });
    expect(freezetime.telemetry.round).not.toHaveProperty('bomb');
    expect(freezetime.telemetry.round).not.toHaveProperty('winnerSide');
    expect(freezetime.telemetry.bomb).toMatchObject({
      state: 'carried',
      sourcePlayerId: 'fixture-player-007',
    });
  });

  it('contains no raw identity or auth material in committed gold bytes', async () => {
    for (const fixture of GOLD_FIXTURES) {
      const dir = resolve(process.cwd(), 'fixtures/gsi/gold', fixture.name);
      const [manifest, frames] = await Promise.all([
        readFile(resolve(dir, 'manifest.json'), 'utf8'),
        readFile(resolve(dir, 'frames.jsonl'), 'utf8'),
      ]);
      const bytes = `${manifest}\n${frames}`;
      expect(bytes).not.toMatch(/\b\d{17}\b/);
      expect(bytes).not.toMatch(/auth|token|password|secret|endpoint|uri/i);
    }
  });
});
