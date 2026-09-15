import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readQualificationEvidence,
  scanJsonForSecrets,
  writeQualificationEvidence,
} from './evidence.mjs';

const ARTIFACT_DIGEST = 'a'.repeat(64);
const BASE_TIME = '2026-09-15T00:00:00.000Z';

function artifact() {
  return {
    schemaVersion: 1,
    repository: 'Starfie1d1272/RivalHub-Broadcast',
    gitSha: '293f97a000000000000000000000000000000000',
    buildTimestamp: BASE_TIME,
    platform: 'win32-x64',
    nodeVersion: 'v24.21.0',
    qualificationSchemaVersion: 1,
    artifactSha256: ARTIFACT_DIGEST,
  };
}

function marker(runId, kind, monotonicMs, options = {}) {
  const mapEpoch = options.mapEpoch ?? 1;
  const runtimeSeq = options.runtimeSeq ?? 1;
  const freshness = options.freshness ?? 'fresh';
  const receivedMonotonicMs = options.receivedMonotonicMs ?? monotonicMs;
  return {
    schemaVersion: 1,
    runId,
    kind,
    monotonicMs,
    wallClockAt: new Date(Date.parse(BASE_TIME) + monotonicMs).toISOString(),
    producerInstanceId: 'qualification-producer',
    mapEpoch,
    runtimeSeq,
    sourceGeneration: 0,
    freshness,
    observation:
      options.observation === null
        ? null
        : {
            sequence: options.sequence ?? 0,
            receivedAt:
              options.receivedAt ??
              new Date(Date.parse(BASE_TIME) + receivedMonotonicMs).toISOString(),
            receivedMonotonicMs,
            producerInstanceId: 'qualification-producer',
            sourceGeneration: 0,
            mapEpoch,
            runtimeSeq,
            freshness,
          },
    ...(options.phase === undefined ? {} : { phase: options.phase }),
    ...(options.reset === undefined ? {} : { reset: options.reset }),
  };
}

async function createEvidenceRun({
  complete = true,
  withCapture = true,
  captureFirstObservation = true,
  captureSecondObservation = true,
} = {}) {
  const runDir = await mkdtemp(join(tmpdir(), 'rivalhub-qualification-evidence-'));
  const runId = 'qualification-test-run';
  await mkdir(join(runDir, 'debug'), { recursive: true });
  await mkdir(join(runDir, 'recorder'), { recursive: true });
  await writeFile(join(runDir, 'scenario.jsonl'), '', 'utf8');
  await writeFile(join(runDir, 'artifact.json'), `${JSON.stringify(artifact())}\n`, 'utf8');
  await writeFile(
    join(runDir, 'environment.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      windowsVersion: 'Windows 11 test',
      cs2Version: 'CS2 test',
    })}\n`,
    'utf8',
  );
  await writeFile(join(runDir, 'debug', 'final-runtime.json'), '{"freshness":"fresh"}\n', 'utf8');

  const markers = [
    marker(runId, 'demo-a-live', 100, {
      sequence: captureFirstObservation ? 0 : 99,
      receivedAt: BASE_TIME,
      receivedMonotonicMs: 100,
    }),
    marker(runId, 'demo-a-stopped', 200),
    marker(runId, 'cs2-closed', 300),
    marker(runId, 'runtime-stale', 20_300, { freshness: 'stale' }),
    marker(runId, 'next-execution', 20_400, { freshness: 'stale', phase: 'before' }),
    marker(runId, 'next-execution', 20_401, {
      freshness: 'stale',
      phase: 'after',
      mapEpoch: 2,
      runtimeSeq: 2,
      reset: {
        disposition: 'accepted',
        reason: 'map-execution-reset',
        resetReason: 'operator-correction',
        previousMapEpoch: 1,
        mapEpoch: 2,
      },
    }),
    marker(runId, 'cs2-reopened', 20_500, { freshness: 'stale', mapEpoch: 2, runtimeSeq: 2 }),
    marker(runId, 'demo-b-live', 20_600, {
      sequence: captureSecondObservation ? 1 : 0,
      receivedAt: captureSecondObservation
        ? new Date(Date.parse(BASE_TIME) + 20_600).toISOString()
        : BASE_TIME,
      receivedMonotonicMs: captureSecondObservation ? 20_600 : 100,
      mapEpoch: 2,
      runtimeSeq: 3,
    }),
  ];
  await writeFile(
    join(runDir, 'scenario.jsonl'),
    `${markers.map((value) => JSON.stringify(value)).join('\n')}\n`,
    'utf8',
  );

  if (withCapture) {
    const frames =
      [
        ...(captureFirstObservation
          ? [
              {
                version: 1,
                sequence: 0,
                elapsedUs: 0,
                receivedAt: BASE_TIME,
                payload: { map: { name: 'de_ancient', phase: 'live' } },
              },
            ]
          : []),
        {
          version: 1,
          sequence: 1,
          elapsedUs: 20_600_000,
          receivedAt: new Date(Date.parse(BASE_TIME) + 20_600).toISOString(),
          payload: { map: { name: 'de_ancient', phase: 'live' } },
        },
      ]
        .map((frame) => JSON.stringify(frame))
        .join('\n') + '\n';
    const captureDir = join(runDir, 'recorder', 'capture-1');
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, 'frames.jsonl'), frames, 'utf8');
    await writeFile(
      join(captureDir, 'manifest.json'),
      `${JSON.stringify({
        formatVersion: 1,
        captureId: 'capture-1',
        createdAt: BASE_TIME,
        platform: 'win32-x64',
        broadcastCommit: artifact().gitSha,
        scenario: 'qualification-test',
        gsiConfig: { uri: 'http://127.0.0.1:3000/gsi' },
        complete,
        frameCount: captureFirstObservation ? 2 : 1,
        droppedFrames: 0,
        framesSha256: createHash('sha256').update(frames, 'utf8').digest('hex'),
      })}\n`,
      'utf8',
    );
  }
  return { runDir, runId };
}

describe('qualification evidence verifier', () => {
  it('writes and deterministically verifies a complete run', async () => {
    const { runDir } = await createEvidenceRun();
    try {
      const written = await writeQualificationEvidence({
        runDir,
        artifact: artifact(),
        environment: {
          runId: 'qualification-test-run',
          windowsVersion: 'Windows 11 test',
          cs2Version: 'CS2 test',
        },
      });
      expect(written.qualification.result).toBe('PASS');

      const first = await readQualificationEvidence(runDir);
      const hashesBefore = await readFile(join(runDir, 'hashes.txt'), 'utf8');
      const second = await readQualificationEvidence(runDir);
      expect(second.qualification).toEqual(first.qualification);
      expect(second.checks).toEqual(first.checks);
      expect(await readFile(join(runDir, 'hashes.txt'), 'utf8')).toBe(hashesBefore);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it('does not infer Demo A production evidence from a later Demo B frame', async () => {
    const run = await createEvidenceRun({ captureFirstObservation: false });
    try {
      const written = await writeQualificationEvidence({
        runDir: run.runDir,
        artifact: artifact(),
        environment: {
          runId: run.runId,
          windowsVersion: 'Windows 11 test',
          cs2Version: 'CS2 test',
        },
      });
      expect(written.checks.productionChain.status).toBe('INCONCLUSIVE');
      expect(written.qualification.result).toBe('INCONCLUSIVE');
      await expect(readQualificationEvidence(run.runDir)).resolves.toMatchObject({
        checks: { productionChain: { status: 'INCONCLUSIVE' } },
      });
    } finally {
      await rm(run.runDir, { recursive: true, force: true });
    }
  });

  it('does not infer Demo B recovery from a pre-reset observation', async () => {
    const run = await createEvidenceRun({ captureSecondObservation: false });
    try {
      const written = await writeQualificationEvidence({
        runDir: run.runDir,
        artifact: artifact(),
        environment: {
          runId: run.runId,
          windowsVersion: 'Windows 11 test',
          cs2Version: 'CS2 test',
        },
      });
      expect(written.checks.productionChain.status).toBe('PASS');
      expect(written.checks.demoBRecovery.status).toBe('INCONCLUSIVE');
      expect(written.qualification.result).toBe('INCONCLUSIVE');
    } finally {
      await rm(run.runDir, { recursive: true, force: true });
    }
  });

  it('detects tampered report bytes and does not treat inconclusive as a verifier error', async () => {
    const completeRun = await createEvidenceRun();
    try {
      await writeQualificationEvidence({
        runDir: completeRun.runDir,
        artifact: artifact(),
        environment: {
          runId: completeRun.runId,
          windowsVersion: 'Windows 11 test',
          cs2Version: 'CS2 test',
        },
      });
      await writeFile(join(completeRun.runDir, 'REPORT.md'), 'tampered\n', 'utf8');
      await expect(readQualificationEvidence(completeRun.runDir)).rejects.toMatchObject({
        code: 'HASH_MISMATCH',
      });
    } finally {
      await rm(completeRun.runDir, { recursive: true, force: true });
    }

    const incompleteRun = await createEvidenceRun({ withCapture: false });
    try {
      await writeFile(join(incompleteRun.runDir, 'scenario.jsonl'), '', 'utf8');
      await rm(join(incompleteRun.runDir, 'debug', 'final-runtime.json'), { force: true });
      const written = await writeQualificationEvidence({
        runDir: incompleteRun.runDir,
        artifact: artifact(),
        environment: {
          runId: incompleteRun.runId,
          windowsVersion: 'unknown',
          cs2Version: 'unknown',
        },
      });
      expect(written.qualification.result).toBe('INCONCLUSIVE');
      await expect(readQualificationEvidence(incompleteRun.runDir)).resolves.toMatchObject({
        qualification: { result: 'INCONCLUSIVE' },
      });
    } finally {
      await rm(incompleteRun.runDir, { recursive: true, force: true });
    }
  });

  it('rejects secret-bearing evidence fields', () => {
    expect(() => scanJsonForSecrets({ token: 'must-not-ship' })).toThrow('secret-bearing');
    expect(() => scanJsonForSecrets({ player: '76561198000000001' })).toThrow('Steam-like');
  });
});
