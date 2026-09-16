import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createIdentityResolver } from '@rivalhub-broadcast/core/identity';
import type { MatchContext } from '@rivalhub-broadcast/core/match-context';
import { assistSnapshotSchema } from '@rivalhub-broadcast/protocol/assist';
import { operatorSnapshotSchema } from '@rivalhub-broadcast/protocol/operator';
import { programSnapshotSchema } from '@rivalhub-broadcast/protocol/program';
import { radarSnapshotSchema } from '@rivalhub-broadcast/protocol/radar';
import { toMatchContext, type BroadcastManifestV1 } from '@rivalhub-broadcast/rivalhub';
import {
  buildCaptureRedactionMap,
  canonicalJsonLine,
  redactObservationPlayerIds,
  replayCapture,
  verifyCapture,
  type CaptureIdentityMapping,
  type VerifiedCapture,
} from '@rivalhub-broadcast/testkit';
import { describe, expect, it } from 'vitest';

import {
  createProjectionCoordinator,
  type ProjectionScheduler,
} from '../src/projections/projection-coordinator.js';
import { createProgramRuntime } from '../src/runtime/program-runtime.js';
import type { MatchContextBinding } from '../src/match-context/index.js';
import { createCstvSourceManagers } from '../src/telemetry/cstv-source-manager.js';

const fullMatchCaptureDir = process.env.RIVALHUB_FULL_MATCH_CAPTURE_DIR;
const FULL_MATCH_CAPTURE_ID = '20260914T060149Z-4cda66b7-recovered-match';
const FULL_MATCH_FRAME_COUNT = 16_382;
const FULL_MATCH_FRAMES_SHA256 = '7a2dfed10f28903de6a94e782ca3f0955593fe2f653e7e831e05305d8e99347a';
const FULL_MATCH_PRODUCER_INSTANCE_ID = 'full-match-projection-replay';

const noOpProjectionScheduler: ProjectionScheduler = {
  setTimeout: () => ({}),
  clearTimeout: () => {},
};

interface ReplayPipelineResult {
  readonly frames: number;
  readonly accepted: number;
  readonly digest: string;
  readonly finalRuntimeSeq: number;
  readonly finalMapName: string | null;
  readonly finalMapEpoch: number;
  readonly finalIdentityState: string;
  readonly finalIdentitySourceGeneration: number;
  readonly finalIdentityMapEpoch: number;
  readonly identityStates: readonly string[];
  readonly sideMappings: readonly string[];
}

function normalizeChannelSeq<T extends { readonly channelSeq: number }>(
  snapshot: T,
): Omit<T, 'channelSeq'> {
  const { channelSeq, ...rest } = snapshot;
  void channelSeq;
  return rest;
}

async function readManifest(): Promise<BroadcastManifestV1> {
  return JSON.parse(
    await readFile(
      resolve(process.cwd(), 'packages/rivalhub/test/fixtures/broadcast-manifest-v1.valid.json'),
      'utf8',
    ),
  ) as BroadcastManifestV1;
}

function contextBinding(manifest: BroadcastManifestV1, context: MatchContext): MatchContextBinding {
  return {
    manifest,
    context,
    origin: 'fixture',
    freshness: 'fresh',
    diagnostics: [],
  };
}

async function findCaptureRedactionMap(
  capture: VerifiedCapture,
): Promise<ReadonlyMap<string, string>> {
  for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
    if (event.kind !== 'frame') continue;
    if (!event.result.ok) {
      throw new Error(`完整 capture 在 seq=${event.sourceFrame.sequence} 适配失败`);
    }
    const observation = event.result.observation;
    if (observation.coverage.allPlayers !== 'present') continue;
    if (observation.telemetry.allPlayers?.length !== 10) continue;
    return buildCaptureRedactionMap(observation);
  }
  throw new Error('完整 capture 缺少可建立脱敏映射的首个五打五 allplayers frame');
}

function digestSnapshots(
  digest: ReturnType<typeof createHash>,
  coordinator: ReturnType<typeof createProjectionCoordinator>,
): void {
  const bundle = coordinator.getCurrent();
  const program = programSnapshotSchema.parse(coordinator.getPublisher('program').getCurrent());
  const radar = radarSnapshotSchema.parse(coordinator.getPublisher('radar').getCurrent());
  const operator = operatorSnapshotSchema.parse(coordinator.getPublisher('operator').getCurrent());
  const assist = assistSnapshotSchema.parse(coordinator.getPublisher('assist').getCurrent());

  expect(program.cursor).toEqual(bundle.program.cursor);
  expect(radar.cursor).toEqual(bundle.radar.cursor);
  expect(operator.cursor).toEqual(bundle.operator.cursor);
  expect(assist.cursor).toEqual(bundle.assist.cursor);
  digest.update(
    canonicalJsonLine({
      projection: {
        program: bundle.program,
        radar: bundle.radar,
        operator: bundle.operator,
        assist: bundle.assist,
        identity: bundle.identity,
      },
      wire: {
        program: normalizeChannelSeq(program),
        radar: normalizeChannelSeq(radar),
        operator: normalizeChannelSeq(operator),
        assist: normalizeChannelSeq(assist),
      },
    }),
  );
}

async function runPipeline(
  capture: VerifiedCapture,
  manifest: BroadcastManifestV1,
  context: MatchContext,
  redactionMap: CaptureIdentityMapping,
): Promise<ReplayPipelineResult> {
  let nowMonotonicMs = 0;
  const runtime = createProgramRuntime(FULL_MATCH_PRODUCER_INSTANCE_ID, {
    continuityPolicy: { staleAfterMs: 1_000_000_000 },
  });
  const coordinator = createProjectionCoordinator({
    programRuntime: runtime,
    cstvSources: createCstvSourceManagers({}),
    identityResolver: createIdentityResolver(context),
    matchContextBinding: contextBinding(manifest, context),
    nowMonotonicMs: () => nowMonotonicMs,
    scheduler: noOpProjectionScheduler,
  });
  const digest = createHash('sha256');
  let frames = 0;
  let accepted = 0;
  const identityStates = new Set<string>();
  const sideMappings = new Set<string>();

  try {
    digestSnapshots(digest, coordinator);
    for await (const event of replayCapture(capture, { mode: { kind: 'step' } })) {
      if (event.kind !== 'frame') continue;
      if (!event.result.ok) {
        throw new Error(`完整 capture 在 seq=${event.sourceFrame.sequence} 适配失败`);
      }
      nowMonotonicMs = event.receiveContext.receivedMonotonicMs;
      const observation = redactObservationPlayerIds(event.result.observation, redactionMap);
      const reduction = runtime.acceptObservation(observation);
      if (reduction.disposition.kind !== 'accepted') {
        throw new Error(
          `完整 capture 在 seq=${event.sourceFrame.sequence} 未被 Runtime 接受: ${reduction.disposition.reason}`,
        );
      }
      accepted += 1;
      frames += 1;
      coordinator.afterRuntimeMutation(reduction);
      const identity = coordinator.getCurrent().identity;
      identityStates.add(identity.state);
      sideMappings.add(`${identity.sideMapping.a}/${identity.sideMapping.b}`);
      digestSnapshots(digest, coordinator);
    }

    const final = coordinator.getCurrent();
    return {
      frames,
      accepted,
      digest: digest.digest('hex'),
      finalRuntimeSeq: final.program.cursor.runtimeSeq,
      finalMapName: final.program.map.name,
      finalMapEpoch: final.program.cursor.mapEpoch,
      finalIdentityState: final.identity.state,
      finalIdentitySourceGeneration: final.identity.sourceGeneration,
      finalIdentityMapEpoch: final.identity.mapEpoch,
      identityStates: [...identityStates].sort(),
      sideMappings: [...sideMappings].sort(),
    };
  } finally {
    await coordinator.close();
  }
}

describe('完整真实 GSI replay → Companion projection pipeline', () => {
  it.skipIf(fullMatchCaptureDir === undefined)(
    '以确定性时钟两次跑完 16,382 帧并得到相同全链路 digest',
    async () => {
      if (fullMatchCaptureDir === undefined) throw new Error('缺少完整 capture 路径');
      const manifest = await readManifest();
      const context = toMatchContext(manifest);
      const capture = await verifyCapture(fullMatchCaptureDir);

      expect(capture.manifest.captureId).toBe(FULL_MATCH_CAPTURE_ID);
      expect(capture.manifest.frameCount).toBe(FULL_MATCH_FRAME_COUNT);
      expect(capture.manifest.droppedFrames).toBe(0);
      expect(capture.computedFramesSha256).toBe(FULL_MATCH_FRAMES_SHA256);

      const redactionMap = await findCaptureRedactionMap(capture);
      const first = await runPipeline(capture, manifest, context, redactionMap);
      const second = await runPipeline(capture, manifest, context, redactionMap);

      expect(first.frames).toBe(FULL_MATCH_FRAME_COUNT);
      expect(first.accepted).toBe(FULL_MATCH_FRAME_COUNT);
      expect(second).toEqual(first);
      expect(first.finalRuntimeSeq).toBeGreaterThan(0);
      expect(first.finalMapName).toBe('de_ancient');
      expect(first.finalMapEpoch).toBeGreaterThan(0);
      expect(first.finalIdentityMapEpoch).toBe(first.finalMapEpoch);
      expect(first.finalIdentitySourceGeneration).toBe(0);
      expect(first.identityStates).toContain('matched');
      expect(first.identityStates).not.toContain('mismatch');
      expect(first.sideMappings).toEqual(expect.arrayContaining(['CT/T', 'T/CT']));
    },
    120_000,
  );
});
