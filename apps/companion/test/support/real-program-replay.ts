import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { createIdentityResolver } from '@rivalhub-broadcast/core/identity';
import { programSnapshotSchema, type ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';
import { toMatchContext, type BroadcastManifestV1 } from '@rivalhub-broadcast/rivalhub';
import {
  redactObservationPlayerIds,
  replayCapture,
  SANITIZED_FIXTURE_STEAM64,
  verifyCapture,
  type CaptureIdentityMapping,
  type ReplayEvent,
  type ReplayFaultPlanV1,
  type VerifiedCapture,
} from '@rivalhub-broadcast/testkit';

import { createProjectionCoordinator } from '../../src/projections/projection-coordinator.js';
import { createProgramRuntime } from '../../src/runtime/program-runtime.js';
import { createCstvSourceManagers } from '../../src/telemetry/cstv-source-manager.js';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export async function readReplayManifest(): Promise<BroadcastManifestV1> {
  return JSON.parse(
    await readFile(
      resolve(REPOSITORY_ROOT, 'packages/rivalhub/test/fixtures/broadcast-manifest-v1.valid.json'),
      'utf8',
    ),
  ) as BroadcastManifestV1;
}

/** Derive a capture-local mapping; sanitizer numbering is not cross-capture identity. */
export async function buildReplayIdentityMapping(
  capture: VerifiedCapture,
  manifest: BroadcastManifestV1,
): Promise<CaptureIdentityMapping> {
  if (
    capture.manifest.provenance !== undefined &&
    'sourceCaptureId' in capture.manifest.provenance &&
    capture.manifest.provenance.sourceCaptureId === '20260914T060149Z-4cda66b7-recovered-match'
  ) {
    return SANITIZED_FIXTURE_STEAM64;
  }
  for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
    if (event.kind !== 'frame') continue;
    if (!event.result.ok)
      throw new Error(`Capture adaptation failed: ${event.sourceFrame.sequence}`);
    const observation = event.result.observation;
    const players = observation.telemetry.allPlayers;
    const sides = observation.telemetry.map?.sides;
    if (
      observation.coverage.allPlayers !== 'present' ||
      players?.length !== 10 ||
      sides === undefined
    )
      continue;
    const mapping = new Map<string, string>();
    for (const entry of [manifest.entrants.a, manifest.entrants.b]) {
      const side = sides.ct?.name === entry.name ? 'CT' : sides.t?.name === entry.name ? 'T' : null;
      if (side === null) continue;
      const sourceIds = players
        .filter((player) => player.side === side)
        .map((player) => player.sourcePlayerId)
        .sort();
      const targetIds = entry.roster.players
        .filter((player) => player.isStarter)
        .map((player) => player.steam64);
      if (sourceIds.length !== targetIds.length) continue;
      sourceIds.forEach((sourceId, index) => mapping.set(sourceId, targetIds[index]!));
    }
    if (mapping.size === 10) return mapping;
  }
  throw new Error(`Cannot derive capture-local identity mapping: ${capture.manifest.captureId}`);
}

/** Tournament labels/plan are harness data; only current observation proves the side. */
export async function normalizeReplayManifest(
  capture: VerifiedCapture,
  manifest: BroadcastManifestV1,
  mapping: CaptureIdentityMapping,
): Promise<BroadcastManifestV1> {
  for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
    if (event.kind !== 'frame') continue;
    if (!event.result.ok)
      throw new Error(`Capture adaptation failed: ${event.sourceFrame.sequence}`);
    const observation = redactObservationPlayerIds(event.result.observation, mapping);
    const players = observation.telemetry.allPlayers;
    if (observation.coverage.allPlayers !== 'present' || players?.length !== 10) continue;
    const roster = new Set(manifest.entrants.a.roster.players.map((player) => player.steam64));
    const teamA = players.filter((player) => roster.has(player.sourcePlayerId));
    const side = teamA[0]?.side;
    if (
      teamA.length !== 5 ||
      (side !== 'CT' && side !== 'T') ||
      !teamA.every((player) => player.side === side) ||
      players.filter((player) => player.side === side).length !== 5
    )
      continue;
    return {
      ...manifest,
      maps: manifest.maps.map((map) => ({
        ...map,
        scoreA: null,
        scoreB: null,
        completedAt: null,
        teamAStartSide:
          map.mapName === observation.telemetry.map?.name
            ? side === 'CT'
              ? 'ct'
              : 't'
            : map.teamAStartSide,
      })),
    };
  }
  throw new Error('Capture lacks an unambiguous complete 5v5 roster frame');
}

export interface RealReplayPipeline {
  readonly runtime: ReturnType<typeof createProgramRuntime>;
  readonly coordinator: ReturnType<typeof createProjectionCoordinator>;
}

/** Shared production composition for semantic fixtures and full-match fault replay. */
export async function replayRealProgram(options: {
  readonly capturePath: string;
  readonly targetSequence?: number;
  readonly mapping?: CaptureIdentityMapping;
  readonly faultPlan?: ReplayFaultPlanV1;
  readonly onStart?: (pipeline: RealReplayPipeline) => void;
  readonly beforeEvent?: (event: ReplayEvent, pipeline: RealReplayPipeline) => void;
  readonly afterEvent?: (event: ReplayEvent, pipeline: RealReplayPipeline) => void;
}): Promise<{
  readonly snapshot: ProgramSnapshot;
  readonly capture: VerifiedCapture;
  readonly manifest: BroadcastManifestV1;
  readonly acceptedSequences: readonly number[];
}> {
  const capture = await verifyCapture(options.capturePath);
  const sourceManifest = await readReplayManifest();
  const mapping = options.mapping ?? (await buildReplayIdentityMapping(capture, sourceManifest));
  const manifest = await normalizeReplayManifest(capture, sourceManifest, mapping);
  const context = toMatchContext(manifest);
  let nowMonotonicMs = 0;
  const runtime = createProgramRuntime('real-program-replay', {
    continuityPolicy: { staleAfterMs: 1_000_000_000 },
  });
  const coordinator = createProjectionCoordinator({
    programRuntime: runtime,
    cstvSources: createCstvSourceManagers({}),
    identityResolver: createIdentityResolver(context),
    matchContextBinding: {
      manifest,
      context,
      origin: 'fixture',
      freshness: 'fresh',
      diagnostics: [],
    },
    nowMonotonicMs: () => nowMonotonicMs,
    scheduler: { setTimeout: () => ({}), clearTimeout: () => {} },
  });
  const pipeline = { runtime, coordinator };
  const acceptedSequences: number[] = [];
  try {
    options.onStart?.(pipeline);
    for await (const event of replayCapture(capture, {
      mode: { kind: 'step' },
      ...(options.faultPlan === undefined ? {} : { faultPlan: options.faultPlan }),
    })) {
      nowMonotonicMs = event.scheduledElapsedUs / 1_000;
      options.beforeEvent?.(event, pipeline);
      if (event.kind === 'source-generation-boundary') {
        coordinator.afterRuntimeMutation(
          runtime.advanceProgramSourceGeneration({
            monotonicMs: nowMonotonicMs,
            utc: new Date(nowMonotonicMs).toISOString(),
          }),
        );
      } else {
        if (!event.result.ok)
          throw new Error(`Capture adaptation failed: ${event.sourceFrame.sequence}`);
        const reduction = runtime.acceptObservation(
          redactObservationPlayerIds(event.result.observation, mapping),
        );
        if (reduction.disposition.kind !== 'accepted') {
          throw new Error(
            `Capture sequence ${event.sourceFrame.sequence}: ${reduction.disposition.reason}`,
          );
        }
        coordinator.afterRuntimeMutation(reduction);
        acceptedSequences.push(event.sourceFrame.sequence);
      }
      options.afterEvent?.(event, pipeline);
      if (event.kind === 'frame' && event.sourceFrame.sequence === options.targetSequence) break;
    }
    if (
      options.targetSequence !== undefined &&
      !acceptedSequences.includes(options.targetSequence)
    ) {
      throw new Error(`Target sequence not found: ${options.targetSequence}`);
    }
    return {
      capture,
      manifest,
      acceptedSequences,
      snapshot: programSnapshotSchema.parse(coordinator.getPublisher('program').getCurrent()),
    };
  } finally {
    await coordinator.close();
  }
}
