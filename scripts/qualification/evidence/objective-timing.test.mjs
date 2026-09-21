import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aggregateObjectiveScenarioCoverage,
  analyzeObjectiveTimingCapture,
  evaluateObjectiveTimingRun,
  renderObjectiveTimingReport,
} from './objective-timing.mjs';

const CREATED_AT = '2026-09-21T00:00:00.000Z';
const BROADCAST_COMMIT = 'a'.repeat(40);

function frame(sequence, elapsedMs, payload) {
  return {
    version: 1,
    sequence,
    elapsedUs: elapsedMs * 1_000,
    receivedAt: new Date(Date.parse(CREATED_AT) + elapsedMs).toISOString(),
    payload,
  };
}

async function createCapture(frames, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rivalhub-objective-timing-'));
  const captureDir = join(root, 'capture-1');
  await mkdir(captureDir, { recursive: true });
  const content = `${frames.map((value) => JSON.stringify(value)).join('\n')}\n`;
  await writeFile(join(captureDir, 'frames.jsonl'), content, 'utf8');
  const framesSha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  const manifestOverrides = { ...(options.manifest ?? {}) };
  if (options.provenance !== undefined) {
    manifestOverrides.provenance = {
      ...options.provenance,
      framesSha256,
    };
  }
  await writeFile(
    join(captureDir, 'manifest.json'),
    `${JSON.stringify({
      formatVersion: 1,
      captureId: 'capture-1',
      createdAt: CREATED_AT,
      platform: 'win32-x64',
      broadcastCommit: BROADCAST_COMMIT,
      scenario: 'objective-timing-test',
      gsiConfig: {
        parameters: {
          precision_time: '3',
          timeout: '1.1',
          buffer: '0',
          throttle: '0',
          heartbeat: '10',
          ...(options.config ?? {}),
        },
      },
      clock: {
        kind: 'node-performance',
        origin: 'capture-start',
        elapsedUnit: 'microseconds',
        originMonotonicMs: 0,
      },
      complete: options.complete ?? true,
      frameCount: frames.length,
      droppedFrames: options.droppedFrames ?? 0,
      framesSha256,
      ...manifestOverrides,
    })}\n`,
    'utf8',
  );
  if (options.objectiveEvents !== undefined) {
    await writeFile(
      join(captureDir, 'objective-events.jsonl'),
      `${options.objectiveEvents
        .map((value) =>
          JSON.stringify({
            version: 2,
            referenceId: value.referenceId,
            kind: value.kind,
            source: value.source,
            captureId: 'capture-1',
            timebase: 'capture-elapsed-us',
            occurredAtUs: value.occurredAtMs * 1_000,
            sourceCursor: {
              kind: 'cs2-cstv',
              role: 'program',
              generation: 0,
              sequence: 0,
              tick: 100,
              observedAt: CREATED_AT,
              observedMonotonicMs: value.occurredAtMs,
              mapName: 'de_ancient',
              ticksPerSecond: 64,
            },
            sourceArtifact: { id: 'test-cstv', sha256: 'b'.repeat(64) },
            ...(value.hasKit === undefined ? {} : { hasKit: value.hasKit }),
          }),
        )
        .join('\n')}\n`,
      'utf8',
    );
  }
  return { root, captureDir };
}

function objectiveMarker(scenario, phase, captureElapsedUs, captureId = 'capture-1') {
  return {
    kind: `objective-${scenario}`,
    phase,
    captureId,
    captureElapsedUs,
    monotonicMs: captureElapsedUs / 1_000,
  };
}

function analyzedRunCapture(captureId, observedScenarios = []) {
  const scenarioEntries = Object.fromEntries(
    [
      'freezetime-live',
      'plant-abort',
      'planted-explode',
      'defuse-kit-abort-restart',
      'defuse-no-kit-abort-restart',
      'too-late-defuse',
      'fast-defuse-missing-planted-sample',
      'reconnect-restart',
    ].map((scenario) => [scenario, { observed: observedScenarios.includes(scenario) }]),
  );
  const stats = { count: 4, min: 50, max: 100, mean: 75, p50: 75, p95: 100, p99: 100 };
  return {
    manifest: { captureId, complete: true, droppedFrames: 0 },
    objectiveTiming: {
      evidence: {
        scenarioCoverage: { scenarios: scenarioEntries },
        independentObjectiveReferences: [{ matched: true, residualMs: 10 }],
      },
      metrics: {
        activePacketIntervalMs: stats,
        terminalEvents: [
          { kind: 'plant', remainingAtTerminalMs: 0 },
          { kind: 'defuse', remainingAtTerminalMs: 0 },
          { kind: 'explosion', remainingAtTerminalMs: 0 },
        ],
        lease: { configuredLeaseMs: 1_000, requiredMinimumLeaseMs: 300 },
      },
      qualification: {
        sourceSemantics: {
          gates: {
            phaseSemanticsConsistent: true,
            roundBombSemanticsConsistent: true,
            defuseKitEvidenceConsistent: true,
            independentKitEvidenceConsistent: true,
          },
        },
        numeric01s: {
          measurementGates: {
            activePacketP99Within200Ms: true,
            sourceInternalPhaseConsistencyWithin100Ms: true,
          },
          gates: {
            countdownSamplesComplete: true,
            productionGsiConfig: true,
            realObserverProvenance: true,
            leaseSufficient: true,
          },
        },
      },
    },
  };
}

describe('objective timing capture analyzer', () => {
  it('measures active cadence, semantic clock residuals, transitions, and terminals', async () => {
    const run = await createCapture([
      frame(0, 0, {
        bomb: { state: 'planting', countdown: '3.0' },
        phase_countdowns: { phase: 'live', phase_ends_in: '10.0' },
      }),
      frame(1, 100, {
        bomb: { state: 'planted', countdown: '30.0' },
        phase_countdowns: { phase: 'bomb', phase_ends_in: '30.0' },
      }),
      frame(2, 200, {
        bomb: { state: 'planted', countdown: '29.9' },
        phase_countdowns: { phase: 'bomb', phase_ends_in: '29.9' },
      }),
      frame(3, 300, {
        bomb: { state: 'defusing', countdown: '5.0' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '5.0' },
      }),
      frame(4, 400, {
        bomb: { state: 'defusing', countdown: '4.9' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '4.9' },
      }),
      frame(5, 500, { bomb: { state: 'defused' } }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.activeFrameCount).toBe(5);
      expect(result.capture.gsiConfig).toMatchObject({ precision_time: '3', timeout: '1.1' });
      expect(result.metrics.activePacketIntervalMs.p99).toBe(100);
      expect(result.metrics.countdownDeltaResidualMs.max).toBeCloseTo(0, 8);
      expect(result.metrics.stateTransitionToFirstCountMs.p95).toBe(0);
      expect(result.metrics.phaseComparisonResidualMs.max).toBeCloseTo(0, 8);
      expect(result.metrics.terminalResidualMs.defuse.p95).toBe(4_800);
      expect(result.metrics.terminalEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'plant', to: 'planted' }),
          expect.objectContaining({ kind: 'defuse', remainingAtTerminalMs: 4_800 }),
        ]),
      );
      expect(result.qualification.numeric01s.result).toBe('INCONCLUSIVE');
      expect(result.qualification.numeric01s.measurementGates).toEqual({
        captureComplete: true,
        activePacketP99Within200Ms: true,
        sourceInternalPhaseConsistencyWithin100Ms: true,
      });
      expect(result.qualification.numeric01s.gates.realObserverProvenance).toBeNull();
      expect(result.qualification.numeric01s.gates.independentTransitionReference).toBeNull();
      expect(result.qualification.numeric01s.gates.terminalResidualCoverage).toBeNull();
      expect(result.qualification.numeric001s.result).toBe('NOT_PROMISED');
      const report = renderObjectiveTimingReport(result);
      expect(report).toContain('precision_time');
      expect(report).not.toMatch(/Objective Clock|source-local|Capture V1|INCONCLUSIVE/);
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('reports reconnect gaps and refuses complete qualification for incomplete capture evidence', async () => {
    const run = await createCapture(
      [
        frame(0, 0, { bomb: { state: 'planted', countdown: '30' } }),
        frame(1, 100, { bomb: { state: 'planted', countdown: '29.9' } }),
        frame(2, 1_500, { bomb: { state: 'planted', countdown: '28.5' } }),
      ],
      { complete: false, droppedFrames: 1 },
    );

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.reconnectGaps).toMatchObject({ count: 1, maxMs: 1_400 });
      expect(result.evidence.scenarioCoverage.scenarios['reconnect-restart'].observed).toBe(false);
      expect(result.qualification.numeric01s.result).toBe('FAIL');
      expect(result.qualification.numeric01s.gates.captureComplete).toBe(false);
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('uses independent objective references for transition residual instead of state visibility time', async () => {
    const run = await createCapture(
      [
        frame(0, 0, { bomb: { state: 'planted', countdown: '30' } }),
        frame(1, 110, { bomb: { state: 'defusing', countdown: '5', player: 'defuser' } }),
        frame(2, 220, { bomb: { state: 'defused' } }),
      ],
      {
        objectiveEvents: [
          {
            version: 1,
            referenceId: 'cstv-defuse-start',
            kind: 'bomb-begin-defuse',
            source: 'cstv',
            occurredAtMs: 100,
          },
        ],
      },
    );

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.stateTransitionToFirstCountMs.p95).toBe(0);
      expect(result.metrics.observerReferenceResidualMs.p95).toBe(10);
      expect(result.qualification.numeric01s.gates.transitionP95Within100Ms).toBe(true);
      expect(result.qualification.numeric01s.gates.independentObserverOffsetWithin100Ms).toBe(true);
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('uses the planted anchor for a defusing-to-exploded terminal residual', async () => {
    const run = await createCapture([
      frame(0, 0, { bomb: { state: 'planted', countdown: '2' } }),
      frame(1, 500, { bomb: { state: 'defusing', countdown: '5' } }),
      frame(2, 1_000, { bomb: { state: 'exploded' } }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.terminalEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'explosion',
            sourceClock: 'planted-explosion-anchor',
            remainingAtTerminalMs: 1_000,
          }),
        ]),
      );
      expect(result.metrics.terminalResidualMs.explosion.p95).toBe(1_000);
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('reports a production config mismatch as a failed evidence gate', async () => {
    const run = await createCapture(
      [frame(0, 0, { bomb: { state: 'planted', countdown: '30' } })],
      { config: { buffer: '0.1' } },
    );

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.capture.productionConfig.matches).toBe(false);
      expect(result.qualification.numeric01s.gates.productionGsiConfig).toBe(false);
      expect(result.qualification.numeric01s.result).toBe('FAIL');
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('does not count a defuse abort as a restart until defusing actually resumes', async () => {
    const run = await createCapture([
      frame(0, 0, { bomb: { state: 'planted', countdown: '30' } }),
      frame(1, 100, { bomb: { state: 'defusing', countdown: '5' } }),
      frame(2, 200, { bomb: { state: 'planted', countdown: '29.8' } }),
      frame(3, 300, { bomb: { state: 'exploded' } }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.evidence.scenarioCoverage.scenarios['defuse-kit-abort-restart'].observed).toBe(
        false,
      );
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('clears the qualification-only explosion anchor when a new plant action begins', async () => {
    const run = await createCapture([
      frame(0, 0, { bomb: { state: 'planted', countdown: '2' } }),
      frame(1, 100, { bomb: { state: 'planting', countdown: '3' } }),
      frame(2, 200, { bomb: { state: 'exploded' } }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.metrics.terminalEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'explosion',
            sourceClock: 'unavailable',
            remainingAtTerminalMs: null,
          }),
        ]),
      );
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('requires explicit scenario windows and verifies freezetime-to-live from raw frames', async () => {
    const run = await createCapture([
      frame(0, 0, { round: { phase: 'freezetime' }, bomb: { state: 'carried' } }),
      frame(1, 100, { round: { phase: 'live' }, bomb: { state: 'carried' } }),
      frame(2, 200, { round: { phase: 'live' }, bomb: { state: 'planting', countdown: '3' } }),
    ]);
    const markers = [
      objectiveMarker('freezetime-live', 'before', 0),
      objectiveMarker('freezetime-live', 'after', 200_000),
    ];

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir, {
        scenarioMarkers: markers,
      });
      expect(result.evidence.scenarioCoverage).toMatchObject({
        declared: ['freezetime-live'],
        observed: ['freezetime-live'],
        failed: false,
      });
      const withoutMarkers = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(withoutMarkers.evidence.scenarioCoverage.observed).not.toContain('freezetime-live');
      expect(withoutMarkers.qualification.numeric01s.gates.scenarioCoverage).toBeNull();
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('aggregates reconnect evidence only from explicit markers bound to different captures', () => {
    const markers = [
      objectiveMarker('reconnect-restart', 'before', 1_000, 'capture-a'),
      objectiveMarker('reconnect-restart', 'after', 1_000, 'capture-b'),
    ];
    const result = aggregateObjectiveScenarioCoverage(
      [{ manifest: { captureId: 'capture-a' } }, { manifest: { captureId: 'capture-b' } }],
      markers,
    );
    expect(result.scenarios['reconnect-restart']).toMatchObject({
      declared: true,
      observed: true,
      captureIds: ['capture-a', 'capture-b'],
    });
  });

  it('makes one run-level decision from complete multi-capture evidence', () => {
    const captureA = analyzedRunCapture('capture-a', [
      'freezetime-live',
      'plant-abort',
      'planted-explode',
      'defuse-kit-abort-restart',
      'defuse-no-kit-abort-restart',
      'too-late-defuse',
      'fast-defuse-missing-planted-sample',
    ]);
    const captureB = analyzedRunCapture('capture-b');
    const markers = [
      ...[
        'freezetime-live',
        'plant-abort',
        'planted-explode',
        'defuse-kit-abort-restart',
        'defuse-no-kit-abort-restart',
        'too-late-defuse',
        'fast-defuse-missing-planted-sample',
      ].flatMap((scenario, index) => [
        objectiveMarker(scenario, 'before', index * 100, 'capture-a'),
        objectiveMarker(scenario, 'after', index * 100 + 50, 'capture-a'),
      ]),
      objectiveMarker('reconnect-restart', 'before', 800, 'capture-a'),
      objectiveMarker('reconnect-restart', 'after', 900, 'capture-b'),
    ];

    const complete = evaluateObjectiveTimingRun([captureA, captureB], markers);
    expect(complete.captureIds).toEqual(['capture-a', 'capture-b']);
    expect(complete.evidence.scenarioCoverage.complete).toBe(true);
    expect(complete.qualification.numeric01s.result).toBe('PASS');
    expect(complete.qualification.sourceSemantics.result).toBe('PASS');
    expect(complete.qualification.production.result).toBe('PASS');

    const missingReconnect = evaluateObjectiveTimingRun(
      [captureA, captureB],
      markers.filter(
        (marker) => marker.kind !== 'objective-reconnect-restart' || marker.phase !== 'after',
      ),
    );
    expect(missingReconnect.qualification.production.result).not.toBe('PASS');

    const rejectedCapture = evaluateObjectiveTimingRun([captureA, captureB], markers, {
      captureErrors: [new Error('rejected capture')],
    });
    expect(rejectedCapture.qualification.production.result).not.toBe('PASS');
  });

  it('fails numeric precision when terminal residuals exceed the 100 ms bound', async () => {
    const run = await createCapture([
      frame(0, 0, { bomb: { state: 'planting', countdown: '3' } }),
      frame(1, 100, {
        bomb: { state: 'planted', countdown: '30' },
        phase_countdowns: { phase: 'bomb', phase_ends_in: '30' },
        round: { phase: 'live', bomb: 'planted' },
      }),
      frame(2, 200, {
        bomb: { state: 'defusing', countdown: '5' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '5' },
        round: { phase: 'live', bomb: 'planted' },
      }),
      frame(3, 300, { bomb: { state: 'defused' }, round: { phase: 'live', bomb: 'defused' } }),
      frame(4, 400, { bomb: { state: 'planting', countdown: '3' } }),
      frame(5, 500, {
        bomb: { state: 'planted', countdown: '30' },
        phase_countdowns: { phase: 'bomb', phase_ends_in: '30' },
        round: { phase: 'live', bomb: 'planted' },
      }),
      frame(6, 600, {
        bomb: { state: 'defusing', countdown: '5' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '5' },
        round: { phase: 'live', bomb: 'planted' },
      }),
      frame(7, 700, { bomb: { state: 'exploded' }, round: { phase: 'live', bomb: 'exploded' } }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.qualification.numeric01s.gates.terminalResidualCoverage).toBe(true);
      expect(result.qualification.numeric01s.gates.terminalResidualWithin100Ms).toBe(false);
      expect(
        result.qualification.sourceSemantics.gates.terminalResidualWithin100Ms,
      ).toBeUndefined();
      expect(result.qualification.sourceSemantics.result).toBe('INCONCLUSIVE');
      expect(result.qualification.production.result).toBe('FAIL');
      expect(result.qualification.numeric01s.result).toBe('FAIL');
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });

  it('keeps raw production provenance distinct from sanitized fixture provenance', async () => {
    const productionRun = await createCapture(
      [frame(0, 0, { bomb: { state: 'planted', countdown: '30' } })],
      {
        manifest: { windowsVersion: 'Windows 11 test', cs2Build: 'CS2 test' },
        provenance: {
          kind: 'production-recorder',
          recorderVersion: 1,
          captureId: 'capture-1',
          artifactGitSha: BROADCAST_COMMIT,
          artifactSha256: 'd'.repeat(64),
          qualificationRunId: 'qualification-run',
        },
      },
    );
    const sanitizedRun = await createCapture(
      [frame(0, 0, { bomb: { state: 'planted', countdown: '30' } })],
      {
        manifest: { windowsVersion: 'Windows 11 test' },
        provenance: {
          fixtureKind: 'sanitized-real-capture',
          sourceCaptureId: 'raw-capture',
          sourceFramesSha256: 'c'.repeat(64),
          sourceFrameSelection: { kind: 'all' },
          sanitizerVersion: 1,
          lifecycleCoverage: 'full-match',
        },
      },
    );

    try {
      const context = {
        runId: 'qualification-run',
        artifactGitSha: BROADCAST_COMMIT,
        artifactSha256: 'd'.repeat(64),
        windowsVersion: 'Windows 11 test',
        cs2Version: 'CS2 test',
      };
      const production = await analyzeObjectiveTimingCapture(productionRun.captureDir, {
        qualificationContext: context,
      });
      const sanitized = await analyzeObjectiveTimingCapture(sanitizedRun.captureDir, {
        qualificationContext: context,
      });
      expect(production.qualification.numeric01s.gates.realObserverProvenance).toBe(true);
      expect(sanitized.qualification.numeric01s.gates.realObserverProvenance).toBe(false);
      expect(production.qualification.production.result).toBe('INCONCLUSIVE');
      expect(sanitized.qualification.production.result).not.toBe('PASS');
    } finally {
      await rm(productionRun.root, { recursive: true, force: true });
      await rm(sanitizedRun.root, { recursive: true, force: true });
    }
  });

  it('fails source semantics on an explicit phase mismatch', async () => {
    const run = await createCapture([
      frame(0, 0, {
        bomb: { state: 'planted', countdown: '30' },
        phase_countdowns: { phase: 'defuse', phase_ends_in: '30' },
        round: { phase: 'live', bomb: 'planted' },
      }),
    ]);

    try {
      const result = await analyzeObjectiveTimingCapture(run.captureDir);
      expect(result.qualification.sourceSemantics.gates.phaseSemanticsConsistent).toBe(false);
      expect(result.qualification.sourceSemantics.result).toBe('FAIL');
      expect(result.qualification.production.result).toBe('FAIL');
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  });
});
