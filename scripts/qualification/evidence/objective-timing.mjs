import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { iterateCaptureFrames, observationKey, verifyCaptureDirectory } from './capture.mjs';

export const OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS = 200;
export const OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS = 100;
export const OBJECTIVE_CLOCK_OFFSET_LIMIT_MS = 100;
export const OBJECTIVE_CLOCK_TERMINAL_RESIDUAL_LIMIT_MS = 100;

export const OBJECTIVE_TIMING_REFERENCE_FILE = 'objective-events.jsonl';
export const REQUIRED_OBJECTIVE_SCENARIOS = Object.freeze([
  'freezetime-live',
  'plant-abort',
  'planted-explode',
  'defuse-kit-abort-restart',
  'defuse-no-kit-abort-restart',
  'too-late-defuse',
  'fast-defuse-missing-planted-sample',
  'reconnect-restart',
]);

export const OBJECTIVE_SCENARIO_LABELS = Object.freeze({
  'freezetime-live': '冻结时间进入比赛',
  'plant-abort': '开始下包后取消',
  'planted-explode': '已下包后爆炸',
  'defuse-kit-abort-restart': '有拆弹器中断后重试',
  'defuse-no-kit-abort-restart': '无拆弹器中断后重试',
  'too-late-defuse': '拆弹过晚导致爆炸',
  'fast-defuse-missing-planted-sample': '快速拆弹且缺少已下包样本',
  'reconnect-restart': '重连或接收端重启',
});

export function objectiveScenarioLabel(value) {
  return OBJECTIVE_SCENARIO_LABELS[value] ?? value;
}

const ACTIVE_BOMB_STATES = new Set(['planting', 'planted', 'defusing']);
const POST_PLANT_BOMB_STATES = new Set(['planted', 'defusing']);
const RECOVERED_POST_PLANT_BOMB_STATES = new Set(['planted', 'defusing', 'defused', 'exploded']);
const REFERENCE_KINDS = new Set([
  'bomb-begin-plant',
  'bomb-abort-plant',
  'bomb-planted',
  'bomb-begin-defuse',
  'bomb-abort-defuse',
  'bomb-defused',
  'bomb-exploded',
]);
const REFERENCE_SOURCES = new Set(['cstv', 'demo']);
const REFERENCE_CURSOR_ROLES = new Set(['program', 'lookahead']);
const REFERENCE_TIMEBASE = 'capture-elapsed-us';
const PRODUCTION_RECORDER_PROVENANCE = 'production-recorder';
const SANITIZED_PROVENANCE = 'sanitized-real-capture';
const CS2_MAP_ALIASES = Object.freeze({
  ancient: 'de_ancient',
  anubis: 'de_anubis',
  cache: 'de_cache',
  dust2: 'de_dust2',
  'dust 2': 'de_dust2',
  'dust ii': 'de_dust2',
  inferno: 'de_inferno',
  mirage: 'de_mirage',
  nuke: 'de_nuke',
  overpass: 'de_overpass',
  train: 'de_train',
  vertigo: 'de_vertigo',
});
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

function isUtcTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return false;
  const normalized = value.replace(/\.(\d{3})\d+Z$/, '.$1Z');
  return Number.isFinite(Date.parse(normalized));
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

function canonicalizeMapName(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized.length === 0) return undefined;
  return CS2_MAP_ALIASES[normalized] ?? normalized;
}

function rawMapName(payload) {
  return canonicalizeMapName(record(record(payload)?.map)?.name);
}

function mapNamesEqual(left, right) {
  const canonicalLeft = canonicalizeMapName(left);
  const canonicalRight = canonicalizeMapName(right);
  return canonicalLeft !== undefined && canonicalLeft === canonicalRight;
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
  throw new Error(`无法读取规范${label}：${String(lastError)}`);
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

function realObserverProvenance(manifest, qualificationContext) {
  const provenance = record(manifest.provenance);
  if (provenance === undefined) return null;
  if (provenance.kind === SANITIZED_PROVENANCE) return false;
  if (provenance.kind !== PRODUCTION_RECORDER_PROVENANCE) return false;
  if (qualificationContext === undefined) return false;
  return (
    manifest.platform.startsWith('win32') &&
    typeof manifest.windowsVersion === 'string' &&
    manifest.windowsVersion.length > 0 &&
    manifest.windowsVersion === qualificationContext.windowsVersion &&
    typeof manifest.cs2Build === 'string' &&
    manifest.cs2Build.length > 0 &&
    typeof qualificationContext.cs2Version === 'string' &&
    qualificationContext.cs2Version.length > 0 &&
    manifest.cs2Build === qualificationContext.cs2Version &&
    /^[a-f0-9]{40}$/i.test(manifest.broadcastCommit) &&
    manifest.broadcastCommit === qualificationContext.artifactGitSha &&
    /^[a-f0-9]{64}$/.test(qualificationContext.artifactSha256) &&
    provenance.recorderVersion === 1 &&
    provenance.captureId === manifest.captureId &&
    provenance.qualificationRunId === qualificationContext.runId &&
    provenance.artifactGitSha === qualificationContext.artifactGitSha &&
    provenance.artifactSha256 === qualificationContext.artifactSha256 &&
    typeof manifest.framesSha256 === 'string' &&
    provenance.framesSha256 === manifest.framesSha256
  );
}

async function readObjectiveReferences(captureDir, manifest) {
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
    const cursor = record(value?.sourceCursor);
    const sourceArtifact = record(value?.sourceArtifact);
    if (
      !record(value) ||
      value.version !== 2 ||
      typeof value.referenceId !== 'string' ||
      value.referenceId.length === 0 ||
      !REFERENCE_KINDS.has(value.kind) ||
      !REFERENCE_SOURCES.has(value.source) ||
      value.captureId !== manifest.captureId ||
      value.timebase !== REFERENCE_TIMEBASE ||
      !Number.isSafeInteger(value.occurredAtUs) ||
      value.occurredAtUs < 0 ||
      !cursor ||
      cursor.kind !== 'cs2-cstv' ||
      !REFERENCE_CURSOR_ROLES.has(cursor.role) ||
      !Number.isSafeInteger(cursor.generation) ||
      cursor.generation < 0 ||
      !Number.isSafeInteger(cursor.sequence) ||
      cursor.sequence < 0 ||
      !Number.isSafeInteger(cursor.tick) ||
      cursor.tick < 0 ||
      !Number.isFinite(cursor.observedMonotonicMs) ||
      !isUtcTimestamp(cursor.observedAt) ||
      typeof cursor.mapName !== 'string' ||
      cursor.mapName.trim().length === 0 ||
      typeof cursor.ticksPerSecond !== 'number' ||
      !Number.isFinite(cursor.ticksPerSecond) ||
      cursor.ticksPerSecond <= 0 ||
      !sourceArtifact ||
      typeof sourceArtifact.id !== 'string' ||
      sourceArtifact.id.length === 0 ||
      typeof sourceArtifact.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sourceArtifact.sha256) ||
      (value.hasKit !== undefined && typeof value.hasKit !== 'boolean')
    ) {
      throw new Error(`${path} 第 ${index + 1} 行的独立目标事件记录无效`);
    }
    if (
      !manifest.clock ||
      manifest.clock.kind !== 'node-performance' ||
      manifest.clock.origin !== 'capture-start' ||
      manifest.clock.elapsedUnit !== 'microseconds' ||
      !Number.isFinite(manifest.clock.originMonotonicMs)
    ) {
      throw new Error(`${path} 缺少可验证的采集记录单调时钟起点`);
    }
    const alignedOccurredAtUs =
      (cursor.observedMonotonicMs - manifest.clock.originMonotonicMs) * 1_000;
    if (Math.abs(alignedOccurredAtUs - value.occurredAtUs) > 2_000) {
      throw new Error(`${path} 第 ${index + 1} 行无法与采集记录单调时钟对齐`);
    }
    references.push({
      version: 2,
      referenceId: value.referenceId,
      kind: value.kind,
      source: value.source,
      captureId: value.captureId,
      timebase: REFERENCE_TIMEBASE,
      occurredAtUs: value.occurredAtUs,
      occurredAtMs: value.occurredAtUs / 1_000,
      sourceCursor: cursor,
      sourceArtifact,
      ...(value.hasKit === undefined ? {} : { hasKit: value.hasKit }),
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
  if (bombState === 'planted') {
    return phase === undefined || roundPhase === undefined
      ? null
      : phase === 'bomb' && roundPhase === 'live';
  }
  if (bombState === 'defusing') {
    return phase === undefined || roundPhase === undefined
      ? null
      : phase === 'defuse' && roundPhase === 'live';
  }
  if (roundPhase === 'over') return !isActiveState(bombState);
  return null;
}

function expectedRoundBombState(bombState) {
  if (bombState === 'planted' || bombState === 'defusing') return 'planted';
  if (bombState === 'defused' || bombState === 'exploded') return bombState;
  return undefined;
}

function transitionMatchesReference(reference, transition) {
  if (reference.kind === 'bomb-begin-plant') return transition.to === 'planting';
  if (reference.kind === 'bomb-abort-plant') {
    return (
      transition.from === 'planting' && ['carried', 'dropped', 'unknown'].includes(transition.to)
    );
  }
  if (reference.kind === 'bomb-planted') {
    return transition.from === 'planting' && transition.to === 'planted';
  }
  if (reference.kind === 'bomb-begin-defuse') {
    return transition.from === 'planted' && transition.to === 'defusing';
  }
  if (reference.kind === 'bomb-abort-defuse') {
    return (
      transition.from === 'defusing' &&
      ['planted', 'carried', 'dropped', 'unknown'].includes(transition.to)
    );
  }
  if (reference.kind === 'bomb-defused') return transition.to === 'defused';
  if (reference.kind === 'bomb-exploded') return transition.to === 'exploded';
  return false;
}

function matchObserverReferences(references, transitions) {
  const residuals = [];
  const matches = [];
  const consumedTransitions = new Set();
  for (const reference of references) {
    const transition = transitions
      .filter(
        (candidate) =>
          !consumedTransitions.has(candidate) &&
          transitionMatchesReference(reference, candidate) &&
          mapNamesEqual(reference.sourceCursor.mapName, candidate.mapName) &&
          Number.isFinite(candidate.atMs),
      )
      .sort(
        (left, right) =>
          Math.abs(left.atMs - reference.occurredAtMs) -
          Math.abs(right.atMs - reference.occurredAtMs),
      )[0];
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

function matchIndependentKitEvidence(references, attempts) {
  const consumedAttempts = new Set();
  let matched = 0;
  let unknown = 0;
  let mismatched = 0;
  let unmatched = 0;
  for (const reference of references) {
    const attempt = attempts.find(
      (candidate) =>
        !consumedAttempts.has(candidate) &&
        mapNamesEqual(reference.sourceCursor.mapName, candidate.mapName) &&
        candidate.startMs >= reference.occurredAtMs &&
        candidate.startMs - reference.occurredAtMs <= OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
    );
    if (attempt === undefined) {
      unmatched += 1;
      continue;
    }
    consumedAttempts.add(attempt);
    matched += 1;
    if (
      attempt.kit === 'conflict' ||
      (typeof attempt.kit === 'boolean' && attempt.kit !== reference.hasKit)
    ) {
      mismatched += 1;
    } else if (attempt.kit === null) {
      unknown += 1;
    }
  }
  return { count: references.length, matched, unknown, mismatched, unmatched };
}

function scenarioWindow(markers, scenario) {
  const before = markers.find(
    (marker) => marker.kind === `objective-${scenario}` && marker.phase === 'before',
  );
  const after = markers.find(
    (marker) => marker.kind === `objective-${scenario}` && marker.phase === 'after',
  );
  if (
    before === undefined ||
    after === undefined ||
    before.captureId === undefined ||
    after.captureId === undefined ||
    before.captureId !== after.captureId ||
    before.captureElapsedUs === undefined ||
    after.captureElapsedUs === undefined ||
    after.captureElapsedUs < before.captureElapsedUs
  ) {
    return { declared: false, beforeMs: null, afterMs: null, captureId: null };
  }
  return {
    declared: true,
    beforeMs: before.captureElapsedUs / 1_000,
    afterMs: after.captureElapsedUs / 1_000,
    captureId: before.captureId,
  };
}

function inScenarioWindow(atMs, window) {
  return window.declared && atMs >= window.beforeMs && atMs <= window.afterMs;
}

function scenarioCoverage({
  captureId,
  transitions,
  roundPhaseTransitions,
  objectiveStates,
  defuseAttempts,
  scenarioMarkers,
}) {
  const captureMarkers = scenarioMarkers.filter((marker) => marker.captureId === captureId);
  const declared = new Set(
    REQUIRED_OBJECTIVE_SCENARIOS.filter(
      (scenario) => scenarioWindow(captureMarkers, scenario).declared,
    ),
  );
  const observed = new Set();
  const details = {};
  for (const scenario of REQUIRED_OBJECTIVE_SCENARIOS) {
    const window = scenarioWindow(captureMarkers, scenario);
    let verified = false;
    if (window.declared) {
      switch (scenario) {
        case 'freezetime-live':
          verified = roundPhaseTransitions.some(
            ({ from, to, atMs }) =>
              from === 'freezetime' && to === 'live' && inScenarioWindow(atMs, window),
          );
          break;
        case 'plant-abort':
          verified = transitions.some(
            ({ from, to, atMs }) =>
              from === 'planting' &&
              ['carried', 'dropped', 'unknown'].includes(to) &&
              inScenarioWindow(atMs, window),
          );
          break;
        case 'planted-explode':
          verified = transitions.some(
            ({ from, to, atMs }) =>
              from === 'planted' && to === 'exploded' && inScenarioWindow(atMs, window),
          );
          break;
        case 'defuse-kit-abort-restart':
        case 'defuse-no-kit-abort-restart': {
          const expectedKit = scenario === 'defuse-kit-abort-restart';
          const attempts = defuseAttempts.filter(
            (attempt) => attempt.kit === expectedKit && inScenarioWindow(attempt.startMs, window),
          );
          verified = attempts.some(
            (attempt, index) =>
              attempt.aborted === true &&
              attempts
                .slice(index + 1)
                .some(
                  (restart) =>
                    restart.startMs > attempt.startMs &&
                    restart.terminal !== null &&
                    (scenario === 'defuse-kit-abort-restart'
                      ? restart.terminal.state === 'defused'
                      : ['defused', 'exploded'].includes(restart.terminal.state)) &&
                    inScenarioWindow(restart.terminal.atMs, window),
                ),
          );
          break;
        }
        case 'too-late-defuse':
          verified = transitions.some(
            ({ from, to, atMs }) =>
              from === 'defusing' && to === 'exploded' && inScenarioWindow(atMs, window),
          );
          break;
        case 'fast-defuse-missing-planted-sample': {
          const states = objectiveStates.filter(({ atMs }) => inScenarioWindow(atMs, window));
          const firstState = states[0]?.state;
          verified =
            firstState === 'defusing' &&
            !states.some(({ state }) => state === 'planted') &&
            transitions.some(
              ({ from, to, atMs }) =>
                from === 'defusing' &&
                ['defused', 'exploded'].includes(to) &&
                inScenarioWindow(atMs, window),
            );
          break;
        }
        case 'reconnect-restart':
          // A generic packet/sequence gap is deliberately not sufficient. This scenario is
          // verified at run level only when the explicit markers span recorder identities.
          verified = false;
          break;
      }
    }
    if (verified) observed.add(scenario);
    details[scenario] = {
      declared: declared.has(scenario),
      observed: verified,
      ...(window.declared
        ? { captureId: window.captureId, beforeMs: window.beforeMs, afterMs: window.afterMs }
        : {}),
    };
  }
  const declaredScenarios = REQUIRED_OBJECTIVE_SCENARIOS.filter((scenario) =>
    declared.has(scenario),
  );
  const observedScenarios = REQUIRED_OBJECTIVE_SCENARIOS.filter((scenario) =>
    observed.has(scenario),
  );
  const declaredMissing = declaredScenarios.filter((scenario) => !observed.has(scenario));
  return {
    required: REQUIRED_OBJECTIVE_SCENARIOS,
    declared: declaredScenarios,
    observed: observedScenarios,
    missing: REQUIRED_OBJECTIVE_SCENARIOS.filter((scenario) => !observed.has(scenario)),
    declaredMissing,
    complete: observedScenarios.length === REQUIRED_OBJECTIVE_SCENARIOS.length,
    failed: declaredMissing.length > 0,
    scenarios: details,
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

export function aggregateObjectiveScenarioCoverage(captureResults, scenarioMarkers) {
  const required = REQUIRED_OBJECTIVE_SCENARIOS;
  const details = {};

  const captureById = new Map(
    captureResults
      .map((capture) => [capture.manifest?.captureId, capture])
      .filter(([captureId]) => typeof captureId === 'string'),
  );
  const markerEvidence = (marker) => {
    const capture = captureById.get(marker.captureId);
    const evidence = capture?.objectiveTiming?.evidence?.scenarioMarkerEvidence;
    if (!Array.isArray(evidence)) return undefined;
    const markerKey =
      marker.observation === null || marker.observation === undefined
        ? undefined
        : observationKey(marker.observation);
    return evidence.find(
      (candidate) =>
        candidate.kind === marker.kind &&
        candidate.phase === marker.phase &&
        (markerKey === undefined || candidate.observationKey === markerKey),
    );
  };
  for (const scenario of required) {
    const markers = scenarioMarkers.filter((marker) => marker.kind === `objective-${scenario}`);
    const before = markers.find((marker) => marker.phase === 'before');
    const after = markers.find((marker) => marker.phase === 'after');
    const captureIds = new Set(
      markers
        .map((marker) => marker.captureId)
        .filter((captureId) => typeof captureId === 'string'),
    );
    const beforeEvidence = before === undefined ? undefined : markerEvidence(before);
    const afterEvidence = after === undefined ? undefined : markerEvidence(after);
    const observed =
      scenario === 'reconnect-restart'
        ? before !== undefined &&
          after !== undefined &&
          before.captureId !== after.captureId &&
          captureIds.size >= 2 &&
          beforeEvidence?.captured === true &&
          afterEvidence?.captured === true &&
          POST_PLANT_BOMB_STATES.has(beforeEvidence.bombState) &&
          RECOVERED_POST_PLANT_BOMB_STATES.has(afterEvidence.bombState) &&
          Number.isSafeInteger(beforeEvidence.sourceGeneration) &&
          Number.isSafeInteger(afterEvidence.sourceGeneration) &&
          afterEvidence.sourceGeneration > beforeEvidence.sourceGeneration
        : captureResults.some(
            (capture) =>
              capture.objectiveTiming?.evidence?.scenarioCoverage?.scenarios?.[scenario]?.observed,
          );
    const declared =
      before !== undefined &&
      after !== undefined &&
      typeof before.captureId === 'string' &&
      typeof after.captureId === 'string' &&
      after.monotonicMs >= before.monotonicMs &&
      (before.captureId === after.captureId || captureIds.size >= 2);
    details[scenario] = {
      declared,
      observed,
      captureIds: [...captureIds].sort(),
      ...(scenario === 'reconnect-restart'
        ? {
            recoveryEvidence: {
              beforeCaptured: beforeEvidence?.captured === true,
              afterCaptured: afterEvidence?.captured === true,
              beforeBombState: beforeEvidence?.bombState ?? null,
              afterBombState: afterEvidence?.bombState ?? null,
              sourceGenerationChanged:
                Number.isSafeInteger(beforeEvidence?.sourceGeneration) &&
                Number.isSafeInteger(afterEvidence?.sourceGeneration)
                  ? afterEvidence.sourceGeneration > beforeEvidence.sourceGeneration
                  : null,
            },
          }
        : {}),
      ...(declared && !observed ? { failed: true } : {}),
    };
  }
  const observed = required.filter((scenario) => details[scenario].observed);
  const declared = required.filter((scenario) => details[scenario].declared);
  const declaredMissing = declared.filter((scenario) => !details[scenario].observed);
  return {
    required,
    declared,
    observed,
    missing: required.filter((scenario) => !details[scenario].observed),
    declaredMissing,
    complete: observed.length === required.length,
    failed: declaredMissing.length > 0,
    scenarios: details,
  };
}

function combineQualificationGates(values) {
  if (values.length === 0) return null;
  if (values.some((value) => value === false)) return false;
  if (values.some((value) => value === null || value === undefined)) return null;
  return true;
}

function combineObservedGates(values) {
  const observed = values.filter((value) => value === true || value === false);
  if (observed.length === 0) return null;
  if (observed.some((value) => value === false)) return false;
  return true;
}

function uniqueFiniteMetric(values) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function finiteMetricValues(captureResults, selector) {
  return captureResults
    .map(selector)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
}

function pooledMetricStats(values) {
  return stats(values);
}

function worstCaseMetricStats(captureResults, key) {
  const values = captureResults
    .map((capture) => capture.objectiveTiming?.metrics?.[key])
    .filter((value) => record(value) !== undefined);
  if (values.length === 0) return stats([]);
  const numeric = (name, reducer, fallback = null) => {
    const candidates = values
      .map((value) => finiteNumber(value[name]))
      .filter((value) => value !== undefined);
    return candidates.length === 0 ? fallback : reducer(candidates);
  };
  const counts = values
    .map((value) => finiteNumber(value.count))
    .filter((value) => value !== undefined);
  return {
    count: counts.length === 0 ? 0 : counts.reduce((total, value) => total + value, 0),
    min: numeric('min', Math.min),
    max: numeric('max', Math.max),
    mean: null,
    p50: numeric('p50', Math.max),
    p95: numeric('p95', Math.max),
    p99: numeric('p99', Math.max),
  };
}

function aggregateTerminalResidualStats(captureResults) {
  const values = { plant: [], defuse: [], explosion: [] };
  for (const capture of captureResults) {
    const terminalEvents = capture.objectiveTiming?.metrics?.terminalEvents;
    if (!Array.isArray(terminalEvents)) continue;
    for (const event of terminalEvents) {
      if (
        record(event) !== undefined &&
        (event.kind === 'plant' || event.kind === 'defuse' || event.kind === 'explosion') &&
        (typeof event.absoluteResidualMs === 'number' ||
          typeof event.remainingAtTerminalMs === 'number') &&
        Number.isFinite(event.absoluteResidualMs ?? event.remainingAtTerminalMs)
      ) {
        values[event.kind].push(Math.abs(event.absoluteResidualMs ?? event.remainingAtTerminalMs));
      }
    }
  }
  return Object.fromEntries(
    Object.entries(values).map(([kind, residuals]) => [kind, pooledMetricStats(residuals)]),
  );
}

function flattenIndependentReferences(captureResults) {
  return captureResults.flatMap((capture) => {
    const references = capture.objectiveTiming?.evidence?.independentObjectiveReferences;
    return Array.isArray(references) ? references : [];
  });
}

function runObjectiveCaptureIds(captureResults) {
  return captureResults
    .map((capture) => capture.manifest?.captureId ?? capture.objectiveTiming?.capture?.captureId)
    .filter((captureId) => typeof captureId === 'string')
    .sort();
}

export function evaluateObjectiveTimingRun(
  captureResults,
  scenarioMarkers,
  { captureErrors = [] } = {},
) {
  const analyzed = captureResults.filter((capture) => capture.objectiveTiming !== undefined);
  const scenarioCoverage = aggregateObjectiveScenarioCoverage(captureResults, scenarioMarkers);
  const captureComplete =
    captureErrors.length === 0 &&
    captureResults.length > 0 &&
    captureResults.every(
      (capture) => capture.manifest?.complete === true && capture.manifest?.droppedFrames === 0,
    );
  const independentReferences = flattenIndependentReferences(captureResults);
  const matchedReferences = independentReferences.filter(
    (reference) => reference.matched && typeof reference.residualMs === 'number',
  );
  const signedReferenceResiduals = matchedReferences.map((reference) => reference.residualMs);
  const referenceResidualStats = pooledMetricStats(
    signedReferenceResiduals.map((value) => Math.abs(value)),
  );
  const signedReferenceResidualStats = pooledMetricStats(signedReferenceResiduals);
  const terminalResidualMs = aggregateTerminalResidualStats(captureResults);
  const terminalResidualCoverage = Object.values(terminalResidualMs).every(
    (value) => value.count > 0,
  )
    ? true
    : null;
  const terminalResidualWithin100Ms =
    terminalResidualCoverage === true
      ? Object.values(terminalResidualMs).every(
          (value) => value.max !== null && value.max <= OBJECTIVE_CLOCK_TERMINAL_RESIDUAL_LIMIT_MS,
        )
      : null;
  const leaseRequirements = finiteMetricValues(
    captureResults,
    (capture) => capture.objectiveTiming?.metrics?.lease?.requiredMinimumLeaseMs,
  );
  const configuredLeaseValues = finiteMetricValues(
    captureResults,
    (capture) => capture.objectiveTiming?.metrics?.lease?.configuredLeaseMs,
  );
  const maximumLeaseValues = finiteMetricValues(
    captureResults,
    (capture) => capture.objectiveTiming?.metrics?.lease?.maximumLeaseMs,
  );
  const requiredMinimumLeaseMs =
    leaseRequirements.length === 0 ? null : Math.max(...leaseRequirements);
  const configuredLeaseMs = uniqueFiniteMetric(configuredLeaseValues);
  const maximumLeaseMs = uniqueFiniteMetric(maximumLeaseValues);
  const leasePolicyConsistent =
    configuredLeaseValues.length === analyzed.length &&
    maximumLeaseValues.length === analyzed.length &&
    configuredLeaseMs !== null &&
    maximumLeaseMs !== null;
  const runLeaseSufficient =
    requiredMinimumLeaseMs === null
      ? null
      : !leasePolicyConsistent
        ? false
        : configuredLeaseMs >= requiredMinimumLeaseMs && configuredLeaseMs <= maximumLeaseMs;
  const semanticAggregation = {
    phaseSemanticsConsistent: combineObservedGates,
    roundBombSemanticsConsistent: combineObservedGates,
    defuseKitEvidenceConsistent: combineObservedGates,
    independentKitEvidenceConsistent: combineQualificationGates,
  };
  const semanticGates = Object.fromEntries(
    Object.entries(semanticAggregation).map(([name, aggregate]) => [
      name,
      aggregate(
        analyzed.map(
          (capture) => capture.objectiveTiming.qualification.sourceSemantics.gates[name],
        ),
      ),
    ]),
  );
  semanticGates.scenarioLifecycle = scenarioCoverage.failed
    ? false
    : scenarioCoverage.complete
      ? true
      : null;

  const worstCaseActivePacketIntervalMs = worstCaseMetricStats(
    captureResults,
    'activePacketIntervalMs',
  );
  const measurementGates = {
    captureComplete,
    activePacketP99Within200Ms:
      worstCaseActivePacketIntervalMs.p99 === null
        ? null
        : worstCaseActivePacketIntervalMs.p99 <= OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
    sourceInternalPhaseConsistencyWithin100Ms: combineObservedGates(
      analyzed.map(
        (capture) =>
          capture.objectiveTiming.qualification.numeric01s.measurementGates
            .sourceInternalPhaseConsistencyWithin100Ms,
      ),
    ),
  };
  const numericGates = {
    ...measurementGates,
    countdownSamplesComplete: combineObservedGates(
      analyzed.map(
        (capture) =>
          capture.objectiveTiming.qualification.numeric01s.gates.countdownSamplesComplete,
      ),
    ),
    productionGsiConfig: combineQualificationGates(
      analyzed.map(
        (capture) => capture.objectiveTiming.qualification.numeric01s.gates.productionGsiConfig,
      ),
    ),
    realObserverProvenance: combineQualificationGates(
      analyzed.map(
        (capture) => capture.objectiveTiming.qualification.numeric01s.gates.realObserverProvenance,
      ),
    ),
    scenarioCoverage: scenarioCoverage.failed ? false : scenarioCoverage.complete ? true : null,
    independentTransitionReference:
      independentReferences.length === 0
        ? null
        : independentReferences.length === matchedReferences.length &&
          independentReferences.every((reference) => reference.matched),
    transitionP95Within100Ms:
      referenceResidualStats.p95 === null
        ? null
        : referenceResidualStats.p95 <= OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
    independentObserverOffsetWithin100Ms:
      referenceResidualStats.max === null
        ? null
        : referenceResidualStats.max <= OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
    terminalResidualCoverage,
    terminalResidualWithin100Ms,
    leaseSufficient: runLeaseSufficient,
  };
  const numericResult = gateStatus(numericGates);
  const semanticResult = gateStatus(semanticGates);
  const foundationGates = {
    captureComplete,
    productionGsiConfig: numericGates.productionGsiConfig,
    realObserverProvenance: numericGates.realObserverProvenance,
    scenarioCoverage: numericGates.scenarioCoverage,
    leaseSufficient: numericGates.leaseSufficient,
    sourceSemantics: semanticResult === 'PASS' ? true : semanticResult === 'FAIL' ? false : null,
  };
  const foundationResult = gateStatus(foundationGates);
  return {
    scope: 'qualification-run',
    captureIds: runObjectiveCaptureIds(captureResults),
    evidence: {
      scenarioCoverage,
      independentObjectiveReferences: independentReferences,
      aggregation: {
        activePacketInterval: '按采集记录取最差 p50/p95/p99/最大值',
        observerReferenceResidual: '汇总所有已匹配独立事件记录的误差',
        terminalResidual: '汇总所有采集记录的终止时刻样本',
      },
    },
    metrics: {
      activePacketIntervalMs: worstCaseActivePacketIntervalMs,
      observerReferenceResidualMs: referenceResidualStats,
      observerReferenceSignedResidualMs: signedReferenceResidualStats,
      terminalResidualMs,
      terminalResidualCoverage,
      terminalResidualWithin100Ms,
      captureCount: captureResults.length,
      analyzedCaptureCount: analyzed.length,
      captureErrors: captureErrors.length,
      lease: {
        configuredLeaseMs,
        maximumLeaseMs,
        requiredMinimumLeaseMs,
        sufficient: numericGates.leaseSufficient,
      },
    },
    qualification: {
      production: {
        result: foundationResult,
        gates: {
          foundation: foundationResult,
          sourceSemantics: semanticResult,
          numeric01s: numericResult,
          numericPrecision: numericResult,
        },
      },
      foundation: {
        result: foundationResult,
        gates: foundationGates,
      },
      numeric01s: {
        result: numericResult,
        gates: numericGates,
        measurementGates,
        thresholds: {
          activePacketP99Ms: OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
          transitionP95Ms: OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
          unexplainedOffsetMs: OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
        },
      },
      sourceSemantics: { result: semanticResult, gates: semanticGates },
      numeric001s: {
        result: 'NOT_PROMISED',
        reason: 'GSI precision_time=3 不等于 1 毫秒精度，当前不承诺 0.01 秒数值精度。',
      },
    },
  };
}

export async function analyzeObjectiveTimingCapture(captureDir, options = {}) {
  const [verified, expectedConfig, objectivePolicy] = await Promise.all([
    verifyCaptureDirectory(captureDir),
    canonicalProductionGsiConfig(),
    canonicalObjectivePolicy(),
  ]);
  const referencesEvidence = await readObjectiveReferences(captureDir, verified.manifest);
  const qualificationContext = record(options.qualificationContext);
  const scenarioMarkers = Array.isArray(options.scenarioMarkers) ? options.scenarioMarkers : [];
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
  const roundPhaseTransitions = [];
  const objectiveStates = [];
  const frameEvidenceByObservation = new Map();
  const defuseAttempts = [];
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
  let currentDefuseAttempt;

  for await (const frame of iterateCaptureFrames(captureDir)) {
    frameCount += 1;
    const elapsedMs = frame.elapsedUs / 1_000;
    const bomb = rawBomb(frame.payload);
    const phaseCountdown = rawPhaseCountdown(frame.payload);
    const round = rawRound(frame.payload);
    const mapName = rawMapName(frame.payload);
    const active = isActiveState(bomb.state);
    frameEvidenceByObservation.set(observationKey(frame), {
      elapsedMs,
      bombState: bomb.state ?? null,
      roundPhase: round.phase ?? null,
      mapName: mapName ?? null,
    });
    if (firstObjectiveState === undefined && bomb.state !== undefined)
      firstObjectiveState = bomb.state;
    if (bomb.state !== undefined) objectiveStates.push({ state: bomb.state, atMs: elapsedMs });

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
        const transition = {
          from: previousFrame.state,
          to: bomb.state,
          atMs: elapsedMs,
          mapName: mapName ?? previousFrame.mapName,
        };
        transitions.push(transition);
        if (
          previousFrame.state === 'defusing' &&
          ['planted', 'carried', 'dropped', 'unknown'].includes(bomb.state)
        ) {
          if (currentDefuseAttempt !== undefined) {
            currentDefuseAttempt.aborted = true;
            currentDefuseAttempt = undefined;
          }
        } else if (
          previousFrame.state === 'defusing' &&
          ['defused', 'exploded'].includes(bomb.state)
        ) {
          if (currentDefuseAttempt !== undefined) {
            currentDefuseAttempt.terminal = { state: bomb.state, atMs: elapsedMs };
            currentDefuseAttempt = undefined;
          }
        }

        const kind = terminalKind(previousFrame.state, bomb.state);
        if (kind !== undefined) {
          const elapsedSincePreviousMs = Math.max(0, elapsedMs - previousFrame.elapsedMs);
          let remainingAtTerminalMs = null;
          let sourceClock = 'unavailable';
          if (kind === 'plant' && previousFrame.countdownSeconds !== undefined) {
            remainingAtTerminalMs = previousFrame.countdownSeconds * 1_000 - elapsedSincePreviousMs;
            sourceClock = 'plant-action';
          } else if (kind === 'defuse' && previousFrame.countdownSeconds !== undefined) {
            remainingAtTerminalMs = previousFrame.countdownSeconds * 1_000 - elapsedSincePreviousMs;
            sourceClock = 'defuse-action';
          } else if (kind === 'explosion' && plantedExplosionAnchor !== undefined) {
            remainingAtTerminalMs =
              plantedExplosionAnchor.remainingMs - (elapsedMs - plantedExplosionAnchor.sampledAtMs);
            sourceClock = 'planted-explosion-anchor';
          }
          terminalEvents.push({
            kind,
            from: previousFrame.state,
            to: bomb.state,
            atMs: elapsedMs,
            remainingAtTerminalMs,
            absoluteResidualMs:
              remainingAtTerminalMs === null ? null : Math.abs(remainingAtTerminalMs),
            sourceClock,
          });
          if (remainingAtTerminalMs !== null)
            terminalResidualValues[kind].push(Math.abs(remainingAtTerminalMs));
        }
      }
      if (bomb.state === 'defusing') {
        currentDefuseAttempt = {
          startMs: elapsedMs,
          mapName,
          kit: rawDefuseKitEvidence(frame.payload, bomb.playerId),
          aborted: false,
          terminal: null,
        };
        defuseAttempts.push(currentDefuseAttempt);
      }
      pendingCountTransition = active
        ? { from: previousFrame?.state ?? null, to: bomb.state, atMs: elapsedMs }
        : undefined;
    }

    if (bomb.state !== 'planted' && bomb.state !== 'defusing') {
      plantedExplosionAnchor = undefined;
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
        if (currentDefuseAttempt !== undefined) {
          if (kit === 'conflict' || currentDefuseAttempt.kit === 'conflict') {
            currentDefuseAttempt.kit = 'conflict';
          } else if (kit === true || kit === false) {
            if (currentDefuseAttempt.kit === null) currentDefuseAttempt.kit = kit;
            else if (currentDefuseAttempt.kit !== kit) currentDefuseAttempt.kit = 'conflict';
          }
        }
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

    if (previousFrame?.roundPhase !== round.phase) {
      if (previousFrame?.roundPhase !== undefined && round.phase !== undefined) {
        roundPhaseTransitions.push({
          from: previousFrame.roundPhase,
          to: round.phase,
          atMs: elapsedMs,
        });
      }
    }

    previousFrame = {
      elapsedMs,
      state: bomb.state,
      countdownSeconds: bomb.countdownSeconds,
      roundPhase: round.phase,
      mapName,
      receivedAtMs: Date.parse(frame.receivedAt),
    };
  }

  const lastElapsedMs = previousFrame?.elapsedMs ?? 0;
  closeMissingSpan(missingCountdownSpans, missingSpan, lastElapsedMs);
  const intervalStats = stats(activePacketIntervalsMs);
  const transitionStats = stats(stateTransitionToFirstCountMs);
  const phaseStats = stats(phaseComparisonResidualMs);
  const transitionReferences = referencesEvidence.references.filter((reference) =>
    REFERENCE_KINDS.has(reference.kind),
  );
  const observerReference = matchObserverReferences(transitionReferences, transitions);
  const observerReferenceStats = stats(observerReference.residuals.map((value) => Math.abs(value)));
  const observerReferenceSignedStats = stats(observerReference.residuals);
  const providerStats = stats(providerTimestampResidualMs);
  const receiveWallClockStats = stats(receiveWallClockDeltaResidualMs);
  const complete = verified.manifest.complete && verified.manifest.droppedFrames === 0;
  const configComparison = compareProductionGsiConfig(verified.manifest.gsiConfig, expectedConfig);
  const coverage = scenarioCoverage({
    captureId: verified.manifest.captureId,
    transitions,
    roundPhaseTransitions,
    objectiveStates,
    defuseAttempts,
    scenarioMarkers,
  });
  const scenarioMarkerEvidence = scenarioMarkers
    .filter(
      (marker) =>
        marker.captureId === verified.manifest.captureId &&
        marker.observation !== null &&
        marker.observation !== undefined,
    )
    .map((marker) => {
      const key = observationKey(marker.observation);
      const frameEvidence = frameEvidenceByObservation.get(key);
      return {
        kind: marker.kind,
        phase: marker.phase,
        captureId: marker.captureId,
        observationKey: key,
        captured: frameEvidence !== undefined,
        bombState: frameEvidence?.bombState ?? null,
        roundPhase: frameEvidence?.roundPhase ?? null,
        mapName: frameEvidence?.mapName ?? null,
        sourceGeneration: marker.observation.sourceGeneration,
        frameElapsedMs: frameEvidence?.elapsedMs ?? null,
      };
    });
  const configuredLeaseMs = objectivePolicy.defaultLeaseMs;
  const requiredMinimumLeaseMs = intervalStats.p99 === null ? null : intervalStats.p99 * 3;
  const leaseSufficient =
    requiredMinimumLeaseMs === null
      ? null
      : configuredLeaseMs >= requiredMinimumLeaseMs &&
        configuredLeaseMs <= objectivePolicy.maxLeaseMs;
  const provenance = realObserverProvenance(verified.manifest, qualificationContext);
  const terminalResidualStats = {
    plant: stats(terminalResidualValues.plant),
    defuse: stats(terminalResidualValues.defuse),
    explosion: stats(terminalResidualValues.explosion),
  };
  const independentDefuseReferences = referencesEvidence.references.filter(
    (reference) => reference.kind === 'bomb-begin-defuse' && reference.hasKit !== undefined,
  );
  const independentKitEvidence = matchIndependentKitEvidence(
    independentDefuseReferences,
    defuseAttempts,
  );
  const terminalReferenceCounts = {
    plant: referencesEvidence.references.filter((reference) => reference.kind === 'bomb-planted')
      .length,
    defuse: referencesEvidence.references.filter((reference) => reference.kind === 'bomb-defused')
      .length,
    explosion: referencesEvidence.references.filter(
      (reference) => reference.kind === 'bomb-exploded',
    ).length,
  };
  const terminalResidualCoverage = Object.values(terminalResidualStats).every(
    (value) => value.count > 0,
  )
    ? true
    : null;
  const terminalResidualWithin100Ms = Object.values(terminalResidualStats).every(
    (value) => value.count > 0,
  )
    ? Object.values(terminalResidualStats).every(
        (value) => value.max !== null && value.max <= OBJECTIVE_CLOCK_TERMINAL_RESIDUAL_LIMIT_MS,
      )
    : null;
  const semanticGates = {
    phaseSemanticsConsistent: phaseSemantics.checked === 0 ? null : phaseSemantics.mismatched === 0,
    roundBombSemanticsConsistent:
      roundBombSemantics.checked === 0 ? null : roundBombSemantics.mismatched === 0,
    defuseKitEvidenceConsistent:
      defuseKitEvidence.conflict > 0
        ? false
        : defuseKitEvidence.true + defuseKitEvidence.false === 0
          ? null
          : true,
    independentKitEvidenceConsistent:
      independentKitEvidence.count === 0
        ? true
        : independentKitEvidence.mismatched > 0
          ? false
          : independentKitEvidence.unmatched > 0 || independentKitEvidence.unknown > 0
            ? null
            : true,
    scenarioLifecycle: coverage.failed ? false : coverage.complete ? true : null,
  };
  const measurementGates = {
    captureComplete: complete,
    activePacketP99Within200Ms:
      intervalStats.p99 === null ? null : intervalStats.p99 <= OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
    sourceInternalPhaseConsistencyWithin100Ms:
      phaseStats.max === null ? null : phaseStats.max <= OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
  };
  const numericGates = {
    ...measurementGates,
    countdownSamplesComplete: activeFrameCount === 0 ? null : missingCountdownSpans.length === 0,
    productionGsiConfig: configComparison.matches,
    realObserverProvenance: provenance === null ? null : provenance,
    scenarioCoverage: coverage.failed ? false : coverage.complete ? true : null,
    independentTransitionReference:
      transitionReferences.length === 0
        ? null
        : observerReference.matches.length === transitionReferences.length &&
          observerReference.matches.every((reference) => reference.matched),
    transitionP95Within100Ms:
      observerReferenceStats.p95 === null
        ? null
        : observerReferenceStats.p95 <= OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
    independentObserverOffsetWithin100Ms:
      observerReferenceStats.max === null
        ? null
        : observerReferenceStats.max <= OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
    terminalResidualCoverage,
    terminalResidualWithin100Ms,
    leaseSufficient,
  };
  const semanticResult = gateStatus(semanticGates);
  const numericGateResult = gateStatus(numericGates);
  const numericResult = numericGateResult;
  const foundationGates = {
    captureComplete: complete,
    productionGsiConfig: numericGates.productionGsiConfig,
    realObserverProvenance: numericGates.realObserverProvenance,
    scenarioCoverage: numericGates.scenarioCoverage,
    leaseSufficient: numericGates.leaseSufficient,
    sourceSemantics: semanticResult === 'PASS' ? true : semanticResult === 'FAIL' ? false : null,
  };
  const foundationResult = gateStatus(foundationGates);

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
      allObjectiveReferences: referencesEvidence.references,
      scenarioCoverage: coverage,
      scenarioMarkerEvidence,
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
      observerReferenceSignedResidualMs: observerReferenceSignedStats,
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
      independentKitEvidence,
      firstObjectiveState: firstObjectiveState ?? null,
      roundPhaseTransitions,
      defuseAttempts,
      lease: {
        configuredLeaseMs,
        maximumLeaseMs: objectivePolicy.maxLeaseMs,
        requiredMinimumLeaseMs,
        sufficient: leaseSufficient,
      },
    },
    qualification: {
      production: {
        result: foundationResult,
        gates: {
          foundation: foundationResult,
          sourceSemantics: semanticResult,
          numeric01s: numericResult,
          numericPrecision: numericResult,
        },
      },
      foundation: {
        result: foundationResult,
        gates: foundationGates,
      },
      numeric01s: {
        result: numericResult,
        gates: numericGates,
        measurementGates,
        thresholds: {
          activePacketP99Ms: OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
          transitionP95Ms: OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
          unexplainedOffsetMs: OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
        },
      },
      sourceSemantics: {
        result: semanticResult,
        gates: semanticGates,
      },
      numeric001s: {
        result: 'NOT_PROMISED',
        reason: 'GSI precision_time=3 不等于 1 毫秒精度，当前不承诺 0.01 秒数值精度。',
      },
    },
  };
}

function formatMetric(value) {
  return value === null ? '未知' : `${value.toFixed(1)} 毫秒`;
}

function resultLabel(result) {
  if (result === 'PASS') return '通过';
  if (result === 'FAIL') return '失败';
  if (result === 'NOT_PROMISED') return '不承诺';
  return '证据不足';
}

function truthLabel(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return '证据不足';
}

const OBJECTIVE_GATE_LABELS = Object.freeze({
  captureComplete: '采集记录完整',
  activePacketP99Within200Ms: '活动数据间隔 p99 不超过 200 毫秒',
  sourceInternalPhaseConsistencyWithin100Ms: '来源内部阶段一致性不超过 100 毫秒',
  countdownSamplesComplete: '活动倒计时样本完整',
  productionGsiConfig: '正式 GSI 配置一致',
  realObserverProvenance: '真实观测来源可追溯',
  scenarioCoverage: '场景覆盖完整',
  independentTransitionReference: '具备独立状态变化记录',
  transitionP95Within100Ms: '状态变化误差 p95 不超过 100 毫秒',
  independentObserverOffsetWithin100Ms: '独立来源绝对偏差不超过 100 毫秒',
  terminalResidualCoverage: '三类终止时刻均有误差样本',
  terminalResidualWithin100Ms: '终止时刻误差不超过 100 毫秒',
  leaseSufficient: '短时有效窗口足够',
  phaseSemanticsConsistent: '阶段语义一致',
  roundBombSemanticsConsistent: '回合炸弹语义一致',
  defuseKitEvidenceConsistent: '拆弹器证据一致',
  independentKitEvidenceConsistent: '独立拆弹器记录一致',
  scenarioLifecycle: '场景开始与结束状态完整',
});

function gateLabel(name) {
  return OBJECTIVE_GATE_LABELS[name] ?? name;
}

function scenarioList(values) {
  return values.length === 0 ? '无' : values.map(objectiveScenarioLabel).join('、');
}

export function renderObjectiveTimingReport(result) {
  const { capture, evidence, metrics, qualification } = result;
  const config = capture.gsiConfig;
  const lines = [
    '# 目标时钟采集记录现场验收报告',
    '',
    `- 采集记录编号：\`${capture.captureId}\``,
    `- 提交 SHA：\`${capture.broadcastCommit}\``,
    `- 运行平台：\`${capture.platform}\``,
    `- Windows 版本：\`${capture.windowsVersion ?? '未知'}\``,
    `- 数据帧：${capture.frameCount}（有效状态 ${metrics.activeFrameCount}）`,
    `- 记录完整：${truthLabel(capture.complete)}；丢失数据帧：${capture.droppedFrames}`,
    `- 真实观测来源可追溯：${truthLabel(capture.provenance.realObserverCapture)}`,
    `- 数据帧 SHA-256：\`${capture.framesSha256}\``,
    '',
    '## GSI 配置',
    '',
    `- precision_time：\`${String(config.precision_time ?? '未知')}\``,
    `- timeout：\`${String(config.timeout ?? '未知')}\``,
    `- buffer / throttle / heartbeat：\`${String(config.buffer ?? '未知')} / ${String(config.throttle ?? '未知')} / ${String(config.heartbeat ?? '未知')}\``,
    `- 正式配置一致：${truthLabel(capture.productionConfig.matches)}${capture.productionConfig.mismatches.length === 0 ? '' : `（差异：${capture.productionConfig.mismatches.join('、')}）`}`,
    '- `precision_time=3` 表示来源配置精度，不保证数值精度为 1 毫秒。',
    '',
    '## 测量结果',
    '',
    `- 活动数据间隔：p50 ${formatMetric(metrics.activePacketIntervalMs.p50)}；p95 ${formatMetric(metrics.activePacketIntervalMs.p95)}；p99 ${formatMetric(metrics.activePacketIntervalMs.p99)}；最大值 ${formatMetric(metrics.activePacketIntervalMs.max)}`,
    `- 倒计时变化与单调时间的误差：p95 ${formatMetric(metrics.countdownDeltaResidualMs.p95)}；最大值 ${formatMetric(metrics.countdownDeltaResidualMs.max)}`,
    `- 状态变化到首次匹配倒计时的延迟（同一来源内部）：p95 ${formatMetric(metrics.stateTransitionToFirstCountMs.p95)}；最大值 ${formatMetric(metrics.stateTransitionToFirstCountMs.max)}`,
    `- 独立事件记录的状态变化误差：p50 ${formatMetric(metrics.observerReferenceResidualMs.p50)}；p95 ${formatMetric(metrics.observerReferenceResidualMs.p95)}；最大值 ${formatMetric(metrics.observerReferenceResidualMs.max)}`,
    `- 炸弹倒计时与阶段倒计时的一致性误差（同一来源内部）：p95 ${formatMetric(metrics.phaseComparisonResidualMs.p95)}；最大值 ${formatMetric(metrics.phaseComparisonResidualMs.max)}`,
    `- 终止时刻剩余时间误差：开始下包 p95 ${formatMetric(metrics.terminalResidualMs.plant.p95)}；拆弹 p95 ${formatMetric(metrics.terminalResidualMs.defuse.p95)}；爆炸 p95 ${formatMetric(metrics.terminalResidualMs.explosion.p95)}`,
    `- 终止时刻独立事件记录：开始下包 ${metrics.terminalReferenceCounts.plant}；拆弹 ${metrics.terminalReferenceCounts.defuse}；爆炸 ${metrics.terminalReferenceCounts.explosion}`,
    `- 重连数据间隔 > ${metrics.reconnectGaps.thresholdMs.toFixed(1)} 毫秒：${metrics.reconnectGaps.count}；最大值 ${formatMetric(metrics.reconnectGaps.maxMs)}`,
    `- 倒计时缺失区段：${metrics.missingCountdownSpans.length}`,
    `- 拆弹器证据：有 ${metrics.defuseKitEvidence.true}；无 ${metrics.defuseKitEvidence.false}；未知 ${metrics.defuseKitEvidence.unknown}；冲突 ${metrics.defuseKitEvidence.conflict}`,
    `- 短时有效窗口：配置 ${metrics.lease.configuredLeaseMs.toFixed(1)} 毫秒；最低要求 ${metrics.lease.requiredMinimumLeaseMs === null ? '未知' : `${metrics.lease.requiredMinimumLeaseMs.toFixed(1)} 毫秒`}；是否足够 ${truthLabel(metrics.lease.sufficient)}`,
    '',
    '## 场景覆盖',
    '',
    `- 要求场景：${scenarioList(evidence.scenarioCoverage.required)}`,
    `- 已声明场景：${scenarioList(evidence.scenarioCoverage.declared)}`,
    `- 已验证场景：${scenarioList(evidence.scenarioCoverage.observed)}`,
    `- 缺少场景：${scenarioList(evidence.scenarioCoverage.missing)}`,
    `- 独立目标事件记录：${evidence.independentObjectiveReferences.length}`,
    '',
    '## 验收判定',
    '',
    `- 正式环境判定：**${resultLabel(qualification.production.result)}**`,
    `  - 数值精度：${resultLabel(qualification.production.gates.numericPrecision)}`,
    `  - 来源语义一致性：${resultLabel(qualification.production.gates.sourceSemantics)}`,
    `- 数值精度 0.1 秒：**${resultLabel(qualification.numeric01s.result)}**`,
  ];
  for (const [name, value] of Object.entries(qualification.numeric01s.gates)) {
    lines.push(`  - ${gateLabel(name)}：${truthLabel(value)}`);
  }
  lines.push(
    `- 来源语义与生命周期：**${resultLabel(qualification.sourceSemantics.result)}**`,
    ...Object.entries(qualification.sourceSemantics.gates).map(
      ([name, value]) => `  - ${gateLabel(name)}：${truthLabel(value)}`,
    ),
    `- 数值精度 0.01 秒：**${resultLabel(qualification.numeric001s.result)}** — ${qualification.numeric001s.reason}`,
    '',
    '同一份 GSI 数据中的阶段倒计时与炸弹状态对齐，只能作为同一来源内部一致性证据；没有独立比赛事件记录时，状态变化误差和绝对偏差判定保持“证据不足”。',
    '原始采集记录仍是证据源；正式环境通过还需要真实记录来源、明确场景覆盖和可对齐的独立事件记录；脱敏或合成样本只能用于回归验证。来源语义与数值/可用性是独立结论。',
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
