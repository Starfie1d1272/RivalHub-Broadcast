import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { iterateCaptureFrames, verifyCaptureDirectory } from './capture.mjs';

export const OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS = 200;
export const OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS = 100;
export const OBJECTIVE_CLOCK_OFFSET_LIMIT_MS = 100;

export const OBJECTIVE_TIMING_REFERENCE_FILE = 'objective-events.jsonl';
export const REQUIRED_OBJECTIVE_SCENARIOS = Object.freeze([
  'plant-abort',
  'explode',
  'defuse-kit',
  'defuse-no-kit',
  'defuse-abort-restart',
  'too-late-defuse',
  'fast-defuse-missing-planted-sample',
  'reconnect-restart',
]);

const ACTIVE_BOMB_STATES = new Set(['planting', 'planted', 'defusing']);
const REFERENCE_KINDS = new Set(['plant', 'defuse', 'explosion']);
const REFERENCE_SOURCES = new Set(['cstv', 'demo']);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIR, '../../..');

let canonicalConfigPromise;
let objectivePolicyPromise;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value) {
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

function rawBomb(payload) {
  const root = record(payload);
  const bomb = record(root?.bomb);
  if (bomb === undefined)
    return { state: undefined, countdownSeconds: undefined, playerId: undefined };
  return {
    state: stringValue(bomb.state),
    countdownSeconds: finiteNumber(bomb.countdown ?? bomb.countdownSeconds),
    playerId:
      typeof bomb.player === 'string'
        ? bomb.player
        : typeof bomb.player?.steamid === 'string'
          ? bomb.player.steamid
          : undefined,
  };
}

function rawPhaseCountdown(payload) {
  const root = record(payload);
  const phaseCountdowns = record(root?.phase_countdowns ?? root?.phaseCountdowns);
  if (phaseCountdowns === undefined) return { phase: undefined, endsInSeconds: undefined };
  return {
    phase: stringValue(phaseCountdowns.phase),
    endsInSeconds: finiteNumber(phaseCountdowns.phase_ends_in ?? phaseCountdowns.endsInSeconds),
  };
}

function rawRound(payload) {
  const round = record(record(payload)?.round);
  return {
    phase: stringValue(round?.phase),
    bombState: stringValue(round?.bomb),
  };
}

function rawProviderTimestamp(payload) {
  return finiteNumber(record(record(payload)?.provider)?.timestamp);
}

function isActiveState(state) {
  return state !== undefined && ACTIVE_BOMB_STATES.has(state);
}

function matchingPhase(state) {
  if (state === 'planted') return 'bomb';
  if (state === 'defusing') return 'defuse';
  return undefined;
}

function terminalKind(from, to) {
  if (from === 'planting' && to === 'planted') return 'plant';
  if (to === 'defused') return 'defuse';
  if (to === 'exploded') return 'explosion';
  return undefined;
}

function closeMissingSpan(spans, span, endMs) {
  if (span === undefined) return undefined;
  spans.push({
    state: span.state,
    startMs: span.startMs,
    endMs,
    durationMs: Math.max(0, endMs - span.startMs),
    frameCount: span.frameCount,
  });
  return undefined;
}

function stats(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
    };
  }
  const quantile = (probability) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
  };
}

function allowlistedGsiConfig(config) {
  const recordConfig = record(config) ?? {};
  const source = record(recordConfig.parameters) ?? recordConfig;
  return Object.fromEntries(
    ['timeout', 'precision_time', 'buffer', 'throttle', 'heartbeat']
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

function comparableConfigValue(value) {
  const number = finiteNumber(value);
  return number === undefined ? String(value) : String(number);
}

async function readFirstJson(candidates, label) {
  let lastError;
  for (const path of candidates) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法读取 canonical ${label}：${String(lastError)}`);
}

function canonicalProductionGsiConfig() {
  canonicalConfigPromise ??= readFirstJson(
    [
      join(MODULE_DIR, 'production-gsi-config.json'),
      join(REPOSITORY_ROOT, 'packages/telemetry-gsi/src/production-config.json'),
    ],
    'GSI config',
  );
  return canonicalConfigPromise;
}

function canonicalObjectivePolicy() {
  objectivePolicyPromise ??= readFirstJson(
    [
      join(MODULE_DIR, 'objective-timing-policy.json'),
      join(REPOSITORY_ROOT, 'packages/core/src/runtime/objective-timing-policy.json'),
    ],
    'objective timing policy',
  );
  return objectivePolicyPromise;
}

function compareProductionGsiConfig(observed, expected) {
  const observedAllowlist = allowlistedGsiConfig(observed);
  const expectedAllowlist = allowlistedGsiConfig(expected);
  const keys = ['timeout', 'precision_time', 'buffer', 'throttle', 'heartbeat'];
  const mismatches = keys.filter(
    (key) =>
      comparableConfigValue(observedAllowlist[key]) !==
      comparableConfigValue(expectedAllowlist[key]),
  );
  return {
    matches: mismatches.length === 0,
    observed: observedAllowlist,
    expected: expectedAllowlist,
    mismatches,
  };
}

function realObserverProvenance(manifest) {
  const provenance = record(manifest.provenance);
  return (
    manifest.platform.startsWith('win32') &&
    typeof manifest.windowsVersion === 'string' &&
    manifest.windowsVersion.length > 0 &&
    /^[a-f0-9]{40}$/i.test(manifest.broadcastCommit) &&
    provenance?.fixtureKind === 'sanitized-real-capture' &&
    provenance.sanitizerVersion === 1 &&
    typeof provenance.sourceCaptureId === 'string' &&
    /^[a-f0-9]{64}$/.test(provenance.sourceFramesSha256)
  );
}

async function readObjectiveReferences(captureDir) {
  const path = join(captureDir, OBJECTIVE_TIMING_REFERENCE_FILE);
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, references: [] };
    throw error;
  }
  const references = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path} 第 ${index + 1} 行不是有效 JSON：${String(error)}`, {
        cause: error,
      });
    }
    if (
      !record(value) ||
      value.version !== 1 ||
      typeof value.referenceId !== 'string' ||
      !REFERENCE_KINDS.has(value.kind) ||
      !REFERENCE_SOURCES.has(value.source) ||
      !Number.isFinite(value.occurredAtMs) ||
      value.occurredAtMs < 0
    ) {
      throw new Error(`${path} 第 ${index + 1} 行的 observer objective reference 无效`);
    }
    references.push({
      version: 1,
      referenceId: value.referenceId,
      kind: value.kind,
      source: value.source,
      occurredAtMs: value.occurredAtMs,
    });
  }
  return { path, references };
}

function rawDefuseKitEvidence(payload, sourcePlayerId) {
  if (sourcePlayerId === undefined) return null;
  const root = record(payload);
  const allPlayers = record(root?.allplayers);
  const candidates = [];
  const allPlayer = allPlayers?.[sourcePlayerId];
  if (record(allPlayer)?.state?.defusekit !== undefined) candidates.push(allPlayer.state.defusekit);
  const player = record(root?.player);
  if (player?.steamid === sourcePlayerId && player.state?.defusekit !== undefined) {
    candidates.push(player.state.defusekit);
  }
  const values = candidates
    .filter((value) => typeof value === 'boolean')
    .filter((value, index, all) => all.indexOf(value) === index);
  return values.length === 1 ? values[0] : values.length === 0 ? null : 'conflict';
}

function phaseSemanticsFor(bombState, phase, roundPhase) {
  if (bombState === 'planted') return phase === 'bomb' && roundPhase === 'live';
  if (bombState === 'defusing') return phase === 'defuse' && roundPhase === 'live';
  if (roundPhase === 'over') return !isActiveState(bombState);
  return null;
}

function expectedRoundBombState(bombState) {
  if (bombState === 'planted' || bombState === 'defusing') return 'planted';
  if (bombState === 'defused' || bombState === 'exploded') return bombState;
  return undefined;
}

function transitionMatchesReference(reference, transition) {
  if (reference.kind === 'plant') {
    return transition.from === 'planting' && transition.to === 'planted';
  }
  if (reference.kind === 'defuse') {
    return transition.from === 'planted' && transition.to === 'defusing';
  }
  return transition.to === 'exploded';
}

function matchObserverReferences(references, transitions) {
  const residuals = [];
  const matches = [];
  const consumedTransitions = new Set();
  for (const reference of references) {
    const transition = transitions.find(
      (candidate) =>
        !consumedTransitions.has(candidate) &&
        transitionMatchesReference(reference, candidate) &&
        candidate.atMs >= reference.occurredAtMs,
    );
    if (transition === undefined) {
      matches.push({ ...reference, matched: false, observedAtMs: null, residualMs: null });
      continue;
    }
    consumedTransitions.add(transition);
    const residualMs = transition.atMs - reference.occurredAtMs;
    residuals.push(residualMs);
    matches.push({
      ...reference,
      matched: true,
      observedAtMs: transition.atMs,
      residualMs,
    });
  }
  return { residuals, matches };
}

function scenarioCoverage({
  transitions,
  firstObjectiveState,
  defuseKitValues,
  reconnectGaps,
  sequenceGaps,
  defuseRestartObserved,
}) {
  const observed = new Set();
  if (
    transitions.some(
      ({ from, to }) => from === 'planting' && ['carried', 'dropped', 'unknown'].includes(to),
    )
  )
    observed.add('plant-abort');
  if (transitions.some(({ to }) => to === 'exploded')) observed.add('explode');
  if (defuseKitValues.has(true)) observed.add('defuse-kit');
  if (defuseKitValues.has(false)) observed.add('defuse-no-kit');
  if (defuseRestartObserved) observed.add('defuse-abort-restart');
  if (transitions.some(({ from, to }) => from === 'defusing' && to === 'exploded')) {
    observed.add('too-late-defuse');
  }
  if (
    firstObjectiveState === 'defusing' &&
    transitions.some(({ from, to }) => from === 'defusing' && ['defused', 'exploded'].includes(to))
  ) {
    observed.add('fast-defuse-missing-planted-sample');
  }
  if (reconnectGaps.length > 0 || sequenceGaps.length > 0) observed.add('reconnect-restart');

  return {
    required: REQUIRED_OBJECTIVE_SCENARIOS,
    observed: REQUIRED_OBJECTIVE_SCENARIOS.filter((scenario) => observed.has(scenario)),
    missing: REQUIRED_OBJECTIVE_SCENARIOS.filter((scenario) => !observed.has(scenario)),
    complete: REQUIRED_OBJECTIVE_SCENARIOS.every((scenario) => observed.has(scenario)),
    scenarios: Object.fromEntries(
      REQUIRED_OBJECTIVE_SCENARIOS.map((scenario) => [scenario, observed.has(scenario)]),
    ),
  };
}

function gateStatus(values) {
  const statuses = Object.values(values);
  return statuses.some((value) => value === false)
    ? 'FAIL'
    : statuses.every((value) => value === true)
      ? 'PASS'
      : 'INCONCLUSIVE';
}

export async function analyzeObjectiveTimingCapture(captureDir) {
  const [verified, expectedConfig, objectivePolicy, referencesEvidence] = await Promise.all([
    verifyCaptureDirectory(captureDir),
    canonicalProductionGsiConfig(),
    canonicalObjectivePolicy(),
    readObjectiveReferences(captureDir),
  ]);
  const reconnectThresholdMs = objectivePolicy.defaultLeaseMs;
  const activePacketIntervalsMs = [];
  const countdownDeltaResidualMs = [];
  const stateTransitionToFirstCountMs = [];
  const phaseComparisonResidualMs = [];
  const receiveWallClockDeltaResidualMs = [];
  const providerTimestampResidualMs = [];
  const terminalEvents = [];
  const terminalResidualValues = { plant: [], defuse: [], explosion: [] };
  const missingCountdownSpans = [];
  const reconnectGaps = [];
  const sequenceGaps = [];
  const transitions = [];
  const defuseKitValues = new Set();
  const defuseKitEvidence = { true: 0, false: 0, unknown: 0, conflict: 0 };
  const phaseSemantics = { checked: 0, mismatched: 0, unavailable: 0 };
  const roundBombSemantics = { checked: 0, mismatched: 0, unavailable: 0 };
  let frameCount = 0;
  let activeFrameCount = 0;
  let previousFrame;
  let lastActiveFrameMs;
  let previousCountedSample;
  let pendingCountTransition;
  let missingSpan;
  let plantedExplosionAnchor;
  let firstObjectiveState;
  let defuseRestartObserved = false;

  for await (const frame of iterateCaptureFrames(captureDir)) {
    frameCount += 1;
    const elapsedMs = frame.elapsedUs / 1_000;
    const bomb = rawBomb(frame.payload);
    const phaseCountdown = rawPhaseCountdown(frame.payload);
    const round = rawRound(frame.payload);
    const active = isActiveState(bomb.state);
    if (firstObjectiveState === undefined && bomb.state !== undefined)
      firstObjectiveState = bomb.state;

    if (previousFrame !== undefined) {
      const packetIntervalMs = elapsedMs - previousFrame.elapsedMs;
      if (packetIntervalMs > reconnectThresholdMs) reconnectGaps.push(packetIntervalMs);
      if (frame.sequence > previousFrame.sequence + 1) {
        sequenceGaps.push({ from: previousFrame.sequence + 1, to: frame.sequence - 1 });
      }
      if (previousFrame.receivedAtMs !== undefined) {
        receiveWallClockDeltaResidualMs.push(
          Math.abs(Date.parse(frame.receivedAt) - previousFrame.receivedAtMs - packetIntervalMs),
        );
      }
    }
    const providerTimestampSeconds = rawProviderTimestamp(frame.payload);
    if (providerTimestampSeconds !== undefined) {
      providerTimestampResidualMs.push(
        Math.abs(providerTimestampSeconds * 1_000 - Date.parse(frame.receivedAt)),
      );
    }

    if (previousFrame?.state !== bomb.state) {
      missingSpan = closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
      previousCountedSample = undefined;
      if (previousFrame !== undefined) {
        const transition = { from: previousFrame.state, to: bomb.state, atMs: elapsedMs };
        transitions.push(transition);
        if (
          previousFrame.state === 'defusing' &&
          ['planted', 'carried', 'dropped', 'unknown'].includes(bomb.state)
        ) {
          defuseRestartObserved = true;
        }

        const kind = terminalKind(previousFrame.state, bomb.state);
        if (kind !== undefined) {
          const elapsedSincePreviousMs = Math.max(0, elapsedMs - previousFrame.elapsedMs);
          let remainingAtTerminalMs = null;
          let sourceClock = 'unavailable';
          if (kind === 'plant' && previousFrame.countdownSeconds !== undefined) {
            remainingAtTerminalMs = Math.max(
              0,
              previousFrame.countdownSeconds * 1_000 - elapsedSincePreviousMs,
            );
            sourceClock = 'plant-action';
          } else if (kind === 'defuse' && previousFrame.countdownSeconds !== undefined) {
            remainingAtTerminalMs = Math.max(
              0,
              previousFrame.countdownSeconds * 1_000 - elapsedSincePreviousMs,
            );
            sourceClock = 'defuse-action';
          } else if (kind === 'explosion' && plantedExplosionAnchor !== undefined) {
            remainingAtTerminalMs = Math.max(
              0,
              plantedExplosionAnchor.remainingMs - (elapsedMs - plantedExplosionAnchor.sampledAtMs),
            );
            sourceClock = 'planted-explosion-anchor';
          }
          terminalEvents.push({
            kind,
            from: previousFrame.state,
            to: bomb.state,
            atMs: elapsedMs,
            remainingAtTerminalMs,
            sourceClock,
          });
          if (remainingAtTerminalMs !== null)
            terminalResidualValues[kind].push(remainingAtTerminalMs);
        }
      }
      pendingCountTransition = active
        ? { from: previousFrame?.state ?? null, to: bomb.state, atMs: elapsedMs }
        : undefined;
      if (!active && bomb.state !== 'defusing') {
        plantedExplosionAnchor = undefined;
      }
    }

    if (bomb.state === 'planted' && bomb.countdownSeconds !== undefined) {
      plantedExplosionAnchor = {
        remainingMs: bomb.countdownSeconds * 1_000,
        sampledAtMs: elapsedMs,
      };
    }

    if (active) {
      activeFrameCount += 1;
      if (lastActiveFrameMs !== undefined) {
        activePacketIntervalsMs.push(Math.max(0, elapsedMs - lastActiveFrameMs));
      }
      lastActiveFrameMs = elapsedMs;

      if (
        pendingCountTransition !== undefined &&
        pendingCountTransition.to === bomb.state &&
        bomb.countdownSeconds !== undefined
      ) {
        stateTransitionToFirstCountMs.push(Math.max(0, elapsedMs - pendingCountTransition.atMs));
        pendingCountTransition = undefined;
      }

      if (bomb.countdownSeconds === undefined) {
        if (missingSpan === undefined || missingSpan.state !== bomb.state) {
          closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
          missingSpan = { state: bomb.state, startMs: elapsedMs, frameCount: 0 };
        }
        missingSpan.frameCount += 1;
        previousCountedSample = undefined;
      } else {
        missingSpan = closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
        if (previousCountedSample !== undefined && previousCountedSample.state === bomb.state) {
          const elapsedSeconds = (elapsedMs - previousCountedSample.elapsedMs) / 1_000;
          const countdownDeltaSeconds =
            previousCountedSample.countdownSeconds - bomb.countdownSeconds;
          countdownDeltaResidualMs.push(Math.abs(countdownDeltaSeconds - elapsedSeconds) * 1_000);
        }
        previousCountedSample = {
          state: bomb.state,
          elapsedMs,
          countdownSeconds: bomb.countdownSeconds,
        };
      }

      const expectedPhase = matchingPhase(bomb.state);
      if (
        expectedPhase !== undefined &&
        phaseCountdown.phase === expectedPhase &&
        bomb.countdownSeconds !== undefined &&
        phaseCountdown.endsInSeconds !== undefined
      ) {
        phaseComparisonResidualMs.push(
          Math.abs(bomb.countdownSeconds - phaseCountdown.endsInSeconds) * 1_000,
        );
      }

      const phaseSemantic = phaseSemanticsFor(bomb.state, phaseCountdown.phase, round.phase);
      if (phaseSemantic === null) phaseSemantics.unavailable += 1;
      else {
        phaseSemantics.checked += 1;
        if (!phaseSemantic) phaseSemantics.mismatched += 1;
      }

      const expectedRoundBomb = expectedRoundBombState(bomb.state);
      if (expectedRoundBomb === undefined || round.bombState === undefined) {
        roundBombSemantics.unavailable += 1;
      } else {
        roundBombSemantics.checked += 1;
        if (expectedRoundBomb !== round.bombState) roundBombSemantics.mismatched += 1;
      }

      if (bomb.state === 'defusing') {
        const kit = rawDefuseKitEvidence(frame.payload, bomb.playerId);
        if (kit === true || kit === false) {
          defuseKitValues.add(kit);
          defuseKitEvidence[String(kit)] += 1;
        } else if (kit === 'conflict') defuseKitEvidence.conflict += 1;
        else defuseKitEvidence.unknown += 1;
      }
    } else {
      lastActiveFrameMs = undefined;
      previousCountedSample = undefined;
      missingSpan = closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
    }

    previousFrame = {
      elapsedMs,
      state: bomb.state,
      countdownSeconds: bomb.countdownSeconds,
      receivedAtMs: Date.parse(frame.receivedAt),
    };
  }

  const lastElapsedMs = previousFrame?.elapsedMs ?? 0;
  closeMissingSpan(missingCountdownSpans, missingSpan, lastElapsedMs);
  const intervalStats = stats(activePacketIntervalsMs);
  const transitionStats = stats(stateTransitionToFirstCountMs);
  const phaseStats = stats(phaseComparisonResidualMs);
  const observerReference = matchObserverReferences(referencesEvidence.references, transitions);
  const observerReferenceStats = stats(observerReference.residuals);
  const providerStats = stats(providerTimestampResidualMs);
  const receiveWallClockStats = stats(receiveWallClockDeltaResidualMs);
  const complete = verified.manifest.complete && verified.manifest.droppedFrames === 0;
  const configComparison = compareProductionGsiConfig(verified.manifest.gsiConfig, expectedConfig);
  const coverage = scenarioCoverage({
    transitions,
    firstObjectiveState,
    defuseKitValues,
    reconnectGaps,
    sequenceGaps,
    defuseRestartObserved,
  });
  const configuredLeaseMs = objectivePolicy.defaultLeaseMs;
  const requiredMinimumLeaseMs = intervalStats.p99 === null ? null : intervalStats.p99 * 3;
  const leaseSufficient =
    requiredMinimumLeaseMs === null
      ? null
      : configuredLeaseMs >= requiredMinimumLeaseMs &&
        configuredLeaseMs <= objectivePolicy.maxLeaseMs;
  const provenance = realObserverProvenance(verified.manifest);
  const terminalResidualStats = {
    plant: stats(terminalResidualValues.plant),
    defuse: stats(terminalResidualValues.defuse),
    explosion: stats(terminalResidualValues.explosion),
  };
  const terminalReferenceCounts = Object.fromEntries(
    [...REFERENCE_KINDS].map((kind) => [
      kind,
      referencesEvidence.references.filter((reference) => reference.kind === kind).length,
    ]),
  );
  const terminalResidualCoverage = Object.values(terminalResidualStats).every(
    (value) => value.count > 0,
  )
    ? true
    : null;
  const measurementGates = {
    captureComplete: complete,
    activePacketP99Within200Ms:
      intervalStats.p99 === null ? null : intervalStats.p99 <= OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
    sourceInternalPhaseConsistencyWithin100Ms:
      phaseStats.max === null ? null : phaseStats.max <= OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
  };
  const qualificationGates = {
    ...measurementGates,
    productionGsiConfig: configComparison.matches,
    realObserverProvenance: provenance ? true : null,
    scenarioCoverage: coverage.complete ? true : null,
    independentTransitionReference:
      referencesEvidence.references.length === 0
        ? null
        : observerReference.matches.every((reference) => reference.matched),
    transitionP95Within100Ms:
      observerReferenceStats.p95 === null
        ? null
        : observerReferenceStats.p95 <= OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
    independentObserverOffsetWithin100Ms:
      observerReferenceStats.max === null
        ? null
        : observerReferenceStats.max <= OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
    terminalResidualCoverage,
    leaseSufficient,
  };

  return {
    capture: {
      directory: verified.directory,
      captureId: verified.manifest.captureId,
      scenario: verified.manifest.scenario,
      platform: verified.manifest.platform,
      windowsVersion: verified.manifest.windowsVersion ?? null,
      broadcastCommit: verified.manifest.broadcastCommit,
      frameCount: verified.frameCount,
      complete: verified.manifest.complete,
      droppedFrames: verified.manifest.droppedFrames,
      framesSha256: verified.computedFramesSha256,
      gsiConfig: allowlistedGsiConfig(verified.manifest.gsiConfig),
      productionConfig: configComparison,
      provenance: {
        realObserverCapture: provenance,
        manifestProvenance: verified.manifest.provenance ?? null,
      },
    },
    evidence: {
      measurement: 'raw-capture',
      objectiveReferenceFile: referencesEvidence.path,
      independentObjectiveReferences: observerReference.matches,
      scenarioCoverage: coverage,
      environment: {
        platform: verified.manifest.platform,
        windowsVersion: verified.manifest.windowsVersion ?? null,
        broadcastCommit: verified.manifest.broadcastCommit,
      },
    },
    metrics: {
      frameCount,
      activeFrameCount,
      activePacketIntervalMs: intervalStats,
      countdownDeltaResidualMs: stats(countdownDeltaResidualMs),
      stateTransitionToFirstCountMs: transitionStats,
      phaseComparisonResidualMs: phaseStats,
      observerReferenceResidualMs: observerReferenceStats,
      receiveWallClockDeltaResidualMs: receiveWallClockStats,
      providerTimestampResidualMs: providerStats,
      terminalEvents,
      terminalResidualMs: terminalResidualStats,
      terminalReferenceCounts,
      missingCountdownSpans,
      reconnectGaps: {
        thresholdMs: reconnectThresholdMs,
        count: reconnectGaps.length,
        maxMs: reconnectGaps.length === 0 ? null : Math.max(...reconnectGaps),
        gapsMs: reconnectGaps,
      },
      sequenceGaps,
      phaseSemantics,
      roundBombSemantics,
      defuseKitEvidence,
      lease: {
        configuredLeaseMs,
        maximumLeaseMs: objectivePolicy.maxLeaseMs,
        requiredMinimumLeaseMs,
        sufficient: leaseSufficient,
      },
    },
    qualification: {
      numeric01s: {
        result: gateStatus(qualificationGates),
        gates: qualificationGates,
        measurementGates,
        thresholds: {
          activePacketP99Ms: OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
          transitionP95Ms: OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
          unexplainedOffsetMs: OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
        },
      },
      numeric001s: {
        result: 'NOT_PROMISED',
        reason: 'GSI precision_time=3 不等于 1 ms 精度，当前不承诺 0.01 s 数值精度。',
      },
    },
  };
}

function formatMetric(value) {
  return value === null ? 'n/a' : `${value.toFixed(1)} ms`;
}

function resultLabel(result) {
  if (result === 'PASS') return '通过（PASS）';
  if (result === 'FAIL') return '失败（FAIL）';
  if (result === 'NOT_PROMISED') return '不承诺（NOT_PROMISED）';
  return '证据不足（INCONCLUSIVE）';
}

export function renderObjectiveTimingReport(result) {
  const { capture, evidence, metrics, qualification } = result;
  const config = capture.gsiConfig;
  const lines = [
    '# Objective Clock Capture Qualification Report',
    '',
    `- Capture：\`${capture.captureId}\``,
    `- Git SHA：\`${capture.broadcastCommit}\``,
    `- Platform：\`${capture.platform}\``,
    `- Windows：\`${capture.windowsVersion ?? 'unknown'}\``,
    `- Frames：${capture.frameCount}（active ${metrics.activeFrameCount}）`,
    `- Complete：${capture.complete ? 'yes' : 'no'}；dropped：${capture.droppedFrames}`,
    `- Real observer provenance：${capture.provenance.realObserverCapture ? 'yes' : 'no'}`,
    `- frames SHA-256：\`${capture.framesSha256}\``,
    '',
    '## GSI configuration',
    '',
    `- precision_time：\`${String(config.precision_time ?? 'unknown')}\``,
    `- timeout：\`${String(config.timeout ?? 'unknown')}\``,
    `- buffer / throttle / heartbeat：\`${String(config.buffer ?? 'unknown')} / ${String(config.throttle ?? 'unknown')} / ${String(config.heartbeat ?? 'unknown')}\``,
    `- production config match：${capture.productionConfig.matches ? 'yes' : 'no'}${capture.productionConfig.mismatches.length === 0 ? '' : `（${capture.productionConfig.mismatches.join(', ')}）`}`,
    '- `precision_time=3` 是 source 配置精度声明，不是 1 ms 数值准确度保证。',
    '',
    '## Metrics',
    '',
    `- Active packet interval：p50 ${formatMetric(metrics.activePacketIntervalMs.p50)}；p95 ${formatMetric(metrics.activePacketIntervalMs.p95)}；p99 ${formatMetric(metrics.activePacketIntervalMs.p99)}；max ${formatMetric(metrics.activePacketIntervalMs.max)}`,
    `- Countdown delta vs monotonic residual：p95 ${formatMetric(metrics.countdownDeltaResidualMs.p95)}；max ${formatMetric(metrics.countdownDeltaResidualMs.max)}`,
    `- State transition → first matching countdown（source-local）：p95 ${formatMetric(metrics.stateTransitionToFirstCountMs.p95)}；max ${formatMetric(metrics.stateTransitionToFirstCountMs.max)}`,
    `- Independent observer transition residual：p50 ${formatMetric(metrics.observerReferenceResidualMs.p50)}；p95 ${formatMetric(metrics.observerReferenceResidualMs.p95)}；max ${formatMetric(metrics.observerReferenceResidualMs.max)}`,
    `- Same-semantic bomb vs phase residual（source-local）：p95 ${formatMetric(metrics.phaseComparisonResidualMs.p95)}；max ${formatMetric(metrics.phaseComparisonResidualMs.max)}`,
    `- Terminal residual：plant p95 ${formatMetric(metrics.terminalResidualMs.plant.p95)}；defuse p95 ${formatMetric(metrics.terminalResidualMs.defuse.p95)}；explosion p95 ${formatMetric(metrics.terminalResidualMs.explosion.p95)}`,
    `- Terminal independent references：plant ${metrics.terminalReferenceCounts.plant}；defuse ${metrics.terminalReferenceCounts.defuse}；explosion ${metrics.terminalReferenceCounts.explosion}`,
    `- Reconnect gaps > ${metrics.reconnectGaps.thresholdMs.toFixed(1)} ms：${metrics.reconnectGaps.count}；max ${formatMetric(metrics.reconnectGaps.maxMs)}`,
    `- Missing countdown spans：${metrics.missingCountdownSpans.length}`,
    `- Defuse kit evidence：true ${metrics.defuseKitEvidence.true}；false ${metrics.defuseKitEvidence.false}；unknown ${metrics.defuseKitEvidence.unknown}；conflict ${metrics.defuseKitEvidence.conflict}`,
    `- Lease：configured ${metrics.lease.configuredLeaseMs.toFixed(1)} ms；required minimum ${metrics.lease.requiredMinimumLeaseMs === null ? 'n/a' : `${metrics.lease.requiredMinimumLeaseMs.toFixed(1)} ms`}；sufficient ${metrics.lease.sufficient === null ? 'inconclusive' : metrics.lease.sufficient ? 'yes' : 'no'}`,
    '',
    '## Scenario coverage',
    '',
    `- Required scenarios：${evidence.scenarioCoverage.required.join(', ')}`,
    `- Observed scenarios：${evidence.scenarioCoverage.observed.length === 0 ? 'none' : evidence.scenarioCoverage.observed.join(', ')}`,
    `- Missing scenarios：${evidence.scenarioCoverage.missing.length === 0 ? 'none' : evidence.scenarioCoverage.missing.join(', ')}`,
    `- Independent objective references：${evidence.independentObjectiveReferences.length}`,
    '',
    '## Qualification gates',
    '',
    `- Numeric 0.1 s：**${resultLabel(qualification.numeric01s.result)}**`,
  ];
  for (const [name, value] of Object.entries(qualification.numeric01s.gates)) {
    lines.push(
      `  - ${name}：${value === true ? 'PASS' : value === false ? 'FAIL' : 'INCONCLUSIVE'}`,
    );
  }
  lines.push(
    `- Numeric 0.01 s：**${resultLabel(qualification.numeric001s.result)}** — ${qualification.numeric001s.reason}`,
    '',
    '同一个 GSI payload 内的 phase/bomb 对齐只作为 source-local consistency evidence；没有独立 CSTV/demo objective reference 时，transition/absolute offset gate 保持 INCONCLUSIVE。',
    '原始 Capture V1 仍是证据源；本报告不包含 GSI Token，也不把 synthetic fixture 当作 production qualification。',
  );
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const json = argv[0] === '--json';
  const captureDir = json ? argv[1] : argv[0];
  if (captureDir === undefined || (json && argv.length !== 2) || (!json && argv.length !== 1)) {
    throw new Error(
      '用法：node scripts/qualification/evidence/objective-timing.mjs [--json] <capture-dir>',
    );
  }
  const result = await analyzeObjectiveTimingCapture(resolve(captureDir));
  process.stdout.write(
    json ? `${JSON.stringify(result, null, 2)}\n` : renderObjectiveTimingReport(result),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `OBJECTIVE_TIMING_ANALYZER_ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
