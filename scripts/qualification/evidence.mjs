import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function loadQualificationContract() {
  const candidates = [
    join(MODULE_DIR, 'qualification-contract.json'),
    resolve(MODULE_DIR, '../../apps/companion/src/qualification/contract.json'),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // Try the next repository or bundle location.
    }
  }
  throw new Error('qualification contract is missing');
}

const QUALIFICATION_CONTRACT = loadQualificationContract();

export const QUALIFICATION_SCHEMA_VERSION = QUALIFICATION_CONTRACT.schemaVersion;
export const QUALIFICATION_REPOSITORY = 'Starfie1d1272/RivalHub-Broadcast';

export const QUALIFICATION_MARKER_KINDS = new Set(QUALIFICATION_CONTRACT.markerKinds);
const QUALIFICATION_LIVE_MARKER_KINDS = new Set(QUALIFICATION_CONTRACT.liveMarkerKinds);
const QUALIFICATION_FRESHNESS_VALUES = new Set(QUALIFICATION_CONTRACT.freshnessValues);
const QUALIFICATION_RESULT_VALUES = new Set(QUALIFICATION_CONTRACT.resultValues);
const QUALIFICATION_MARKER_PHASES = new Set(QUALIFICATION_CONTRACT.markerPhases);
const QUALIFICATION_RESET_DISPOSITIONS = new Set(QUALIFICATION_CONTRACT.resetDispositionValues);
const CHECK_KEYS = QUALIFICATION_CONTRACT.checkKeys;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STEAM_LIKE_ID_PATTERN = /\b\d{17}\b/;
const SECRET_PATTERN = /(?:token|password|secret|authorization|bearer)/i;

export class QualificationEvidenceError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'QualificationEvidenceError';
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', `${name} must be a non-empty string`);
  }
  return value;
}

async function readJson(path, code = 'INVALID_EVIDENCE') {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new QualificationEvidenceError(code, `cannot read ${path}: ${String(error)}`, error);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new QualificationEvidenceError(
      code,
      `${path} is not valid JSON: ${String(error)}`,
      error,
    );
  }
}

async function readOptionalJson(path) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      `cannot access ${path}: ${String(error)}`,
      error,
    );
  }
  return readJson(path);
}

function assertUtc(value, name) {
  requireString(value, name);
  if (!Number.isFinite(Date.parse(value))) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', `${name} must be a valid timestamp`);
  }
}

function validateCaptureManifest(manifest, captureDir) {
  if (!isRecord(manifest) || manifest.formatVersion !== 1) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      `${captureDir}/manifest.json must declare formatVersion 1`,
    );
  }
  requireString(manifest.captureId, 'manifest.captureId');
  assertUtc(manifest.createdAt, 'manifest.createdAt');
  requireString(manifest.platform, 'manifest.platform');
  requireString(manifest.broadcastCommit, 'manifest.broadcastCommit');
  requireString(manifest.scenario, 'manifest.scenario');
  if (!isRecord(manifest.gsiConfig)) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      'manifest.gsiConfig must be an object',
    );
  }
  if (
    !isSafeNonNegativeInteger(manifest.frameCount) ||
    !isSafeNonNegativeInteger(manifest.droppedFrames)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      'manifest frame counts are invalid',
    );
  }
  if (typeof manifest.complete !== 'boolean') {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      'manifest.complete must be boolean',
    );
  }
  if (manifest.framesSha256 !== undefined && !SHA256_PATTERN.test(manifest.framesSha256)) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      'manifest.framesSha256 is invalid',
    );
  }
  return manifest;
}

function parseCaptureFrame(line, lineNumber, captureDir) {
  if (line.length === 0) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_FRAME',
      `${captureDir}/frames.jsonl line ${lineNumber} is blank`,
    );
  }
  let frame;
  try {
    frame = JSON.parse(line);
  } catch (error) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_FRAME',
      `${captureDir}/frames.jsonl line ${lineNumber} is invalid JSON`,
      error,
    );
  }
  if (
    !isRecord(frame) ||
    frame.version !== 1 ||
    !isSafeNonNegativeInteger(frame.sequence) ||
    !isSafeNonNegativeInteger(frame.elapsedUs) ||
    typeof frame.payload !== 'object' ||
    frame.payload === null ||
    Array.isArray(frame.payload)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_FRAME',
      `${captureDir}/frames.jsonl line ${lineNumber} has an invalid Capture V1 shape`,
    );
  }
  assertUtc(frame.receivedAt, `frame ${lineNumber}.receivedAt`);
  return frame;
}

async function* streamLines(path, hash) {
  let stream;
  try {
    stream = createReadStream(path);
  } catch (error) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE',
      `cannot open ${path}: ${String(error)}`,
      error,
    );
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let lineNumber = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        let line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lineNumber += 1;
        yield { line, lineNumber };
        newline = pending.indexOf('\n');
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) {
      lineNumber += 1;
      yield { line: pending, lineNumber };
    }
  } catch (error) {
    if (error instanceof QualificationEvidenceError) throw error;
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE',
      `cannot read ${path}: ${String(error)}`,
      error,
    );
  }
}

function observationKey(observation) {
  return `${observation.sequence}\0${observation.receivedAt}`;
}

function liveObservationReferences(markers) {
  return markers
    .filter((marker) => QUALIFICATION_LIVE_MARKER_KINDS.has(marker.kind))
    .map((marker) => marker.observation)
    .filter((observation) => observation !== null);
}

export async function verifyCaptureDirectory(captureDir, observationReferences = []) {
  if (basename(captureDir).endsWith('.partial')) {
    throw new QualificationEvidenceError('UNFINALIZED_CAPTURE', `${captureDir} is unpublished`);
  }
  const manifest = validateCaptureManifest(
    await readJson(join(captureDir, 'manifest.json'), 'INVALID_CAPTURE_SCHEMA'),
    captureDir,
  );
  const framesPath = join(captureDir, 'frames.jsonl');
  try {
    await access(framesPath);
  } catch (error) {
    throw new QualificationEvidenceError('INVALID_CAPTURE', `cannot access ${framesPath}`, error);
  }
  const hash = createHash('sha256');
  let count = 0;
  let previousSequence;
  let previousElapsedUs;
  const referenceKeys = new Set(
    observationReferences.map((observation) => observationKey(observation)),
  );
  const matchedObservationKeys = new Set();
  for await (const record of streamLines(framesPath, hash)) {
    const frame = parseCaptureFrame(record.line, record.lineNumber, captureDir);
    if (previousSequence !== undefined && frame.sequence <= previousSequence) {
      throw new QualificationEvidenceError(
        'INVALID_CAPTURE_FRAME',
        `${framesPath} sequence is not increasing`,
      );
    }
    if (previousElapsedUs !== undefined && frame.elapsedUs < previousElapsedUs) {
      throw new QualificationEvidenceError(
        'INVALID_CAPTURE_FRAME',
        `${framesPath} elapsedUs is not monotonic`,
      );
    }
    previousSequence = frame.sequence;
    previousElapsedUs = frame.elapsedUs;
    const key = `${frame.sequence}\0${frame.receivedAt}`;
    if (referenceKeys.has(key)) matchedObservationKeys.add(key);
    count += 1;
  }
  if (count !== manifest.frameCount) {
    throw new QualificationEvidenceError(
      'FRAME_COUNT_MISMATCH',
      `${framesPath} contains ${count} frames but manifest declares ${manifest.frameCount}`,
    );
  }
  const computedFramesSha256 = hash.digest('hex');
  if (manifest.framesSha256 !== undefined && manifest.framesSha256 !== computedFramesSha256) {
    throw new QualificationEvidenceError(
      'FRAMES_HASH_MISMATCH',
      `${framesPath} hash ${computedFramesSha256} does not match manifest ${manifest.framesSha256}`,
    );
  }
  return {
    directory: captureDir,
    manifest,
    computedFramesSha256,
    frameCount: count,
    matchedObservationKeys: [...matchedObservationKeys].sort(),
  };
}

async function immediateDirectories(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

function validateArtifact(artifact) {
  if (!isRecord(artifact))
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'artifact.json must be an object');
  if (artifact.schemaVersion !== 1)
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'artifact schema is unsupported');
  if (artifact.repository !== QUALIFICATION_REPOSITORY)
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'artifact repository is not RivalHub Broadcast',
    );
  requireString(artifact.gitSha, 'artifact.gitSha');
  assertUtc(artifact.buildTimestamp, 'artifact.buildTimestamp');
  if (artifact.platform !== 'win32-x64') {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'artifact.platform must be win32-x64');
  }
  if (artifact.nodeVersion !== QUALIFICATION_CONTRACT.nodeRuntimeVersion) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      `artifact.nodeVersion must be the pinned ${QUALIFICATION_CONTRACT.nodeRuntimeVersion}`,
    );
  }
  if (artifact.qualificationSchemaVersion !== QUALIFICATION_SCHEMA_VERSION) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'artifact qualification schema is unsupported',
    );
  }
  if (artifact.artifactSha256 !== undefined && !SHA256_PATTERN.test(artifact.artifactSha256)) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'artifact.artifactSha256 is invalid');
  }
  return artifact;
}

function validateObservation(observation, marker, lineNumber) {
  if (!isRecord(observation)) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has an invalid accepted observation`,
    );
  }
  if (
    !isSafeNonNegativeInteger(observation.sequence) ||
    !Number.isFinite(observation.receivedMonotonicMs)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has invalid observation timing`,
    );
  }
  assertUtc(observation.receivedAt, `scenario line ${lineNumber}.observation.receivedAt`);
  requireString(
    observation.producerInstanceId,
    `scenario line ${lineNumber}.observation.producerInstanceId`,
  );
  if (
    !isSafeNonNegativeInteger(observation.mapEpoch) ||
    !isSafeNonNegativeInteger(observation.runtimeSeq) ||
    !isSafeNonNegativeInteger(observation.sourceGeneration) ||
    !QUALIFICATION_FRESHNESS_VALUES.has(observation.freshness)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has invalid observation counters`,
    );
  }
  if (
    observation.receivedMonotonicMs > marker.monotonicMs ||
    observation.producerInstanceId !== marker.producerInstanceId ||
    observation.sourceGeneration !== marker.sourceGeneration ||
    observation.mapEpoch !== marker.mapEpoch ||
    observation.runtimeSeq !== marker.runtimeSeq ||
    observation.freshness !== marker.freshness
  ) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} observation does not match its marker`,
    );
  }
}

function validateMarker(marker, runId, lineNumber) {
  if (!isRecord(marker) || marker.schemaVersion !== QUALIFICATION_SCHEMA_VERSION) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has an unsupported schema`,
    );
  }
  if (marker.runId !== runId || !QUALIFICATION_MARKER_KINDS.has(marker.kind)) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has an invalid run or marker`,
    );
  }
  if (!Number.isFinite(marker.monotonicMs)) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has invalid runtime evidence`,
    );
  }
  requireString(marker.producerInstanceId, `scenario line ${lineNumber}.producerInstanceId`);
  assertUtc(marker.wallClockAt, `scenario line ${lineNumber}.wallClockAt`);
  if (
    !isSafeNonNegativeInteger(marker.mapEpoch) ||
    !isSafeNonNegativeInteger(marker.runtimeSeq) ||
    !isSafeNonNegativeInteger(marker.sourceGeneration)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has invalid counters`,
    );
  }
  if (!QUALIFICATION_FRESHNESS_VALUES.has(marker.freshness)) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has invalid freshness`,
    );
  }
  if (marker.phase !== undefined && !QUALIFICATION_MARKER_PHASES.has(marker.phase)) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} has invalid phase`,
    );
  }
  if (marker.reset !== undefined) {
    if (
      !isRecord(marker.reset) ||
      !QUALIFICATION_RESET_DISPOSITIONS.has(marker.reset.disposition) ||
      marker.reset.reason !== QUALIFICATION_CONTRACT.resetKind ||
      marker.reset.resetReason !== QUALIFICATION_CONTRACT.resetReason ||
      !isSafeNonNegativeInteger(marker.reset.previousMapEpoch) ||
      !isSafeNonNegativeInteger(marker.reset.mapEpoch)
    ) {
      throw new QualificationEvidenceError(
        'INVALID_SCENARIO',
        `scenario line ${lineNumber} has invalid reset evidence`,
      );
    }
  }
  if (!Object.prototype.hasOwnProperty.call(marker, 'observation')) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `scenario line ${lineNumber} is missing accepted observation evidence`,
    );
  }
  if (marker.observation === null) {
    if (QUALIFICATION_LIVE_MARKER_KINDS.has(marker.kind)) {
      throw new QualificationEvidenceError(
        'INVALID_SCENARIO',
        `scenario line ${lineNumber} live marker has no accepted observation`,
      );
    }
  } else {
    validateObservation(marker.observation, marker, lineNumber);
  }
  return marker;
}

async function readScenario(runDir) {
  const path = join(runDir, 'scenario.jsonl');
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new QualificationEvidenceError(
      'INVALID_SCENARIO',
      `cannot read ${path}: ${String(error)}`,
      error,
    );
  }
  const lines = text.length === 0 ? [] : text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const first = lines[0];
  if (first === undefined) return { path, runId: undefined, markers: [] };
  let firstValue;
  try {
    firstValue = JSON.parse(first);
  } catch (error) {
    throw new QualificationEvidenceError('INVALID_SCENARIO', `${path} is not valid JSON`, error);
  }
  const runId = requireString(firstValue?.runId, 'scenario.runId');
  const markers = [];
  let previousMonotonicMs;
  for (let index = 0; index < lines.length; index += 1) {
    let raw;
    try {
      raw = JSON.parse(lines[index]);
    } catch (error) {
      throw new QualificationEvidenceError(
        'INVALID_SCENARIO',
        `${path} line ${index + 1} is not valid JSON`,
        error,
      );
    }
    const marker = validateMarker(raw, runId, index + 1);
    if (previousMonotonicMs !== undefined && marker.monotonicMs < previousMonotonicMs) {
      throw new QualificationEvidenceError(
        'INVALID_SCENARIO',
        `${path} monotonic timestamps are not ordered`,
      );
    }
    previousMonotonicMs = marker.monotonicMs;
    markers.push(marker);
  }
  return { path, runId, markers };
}

function markerIndex(markers, kind, start = 0) {
  for (let index = start; index < markers.length; index += 1) {
    if (markers[index]?.kind === kind) return index;
  }
  return -1;
}

function hasOrderedMarkers(markers, kinds) {
  let start = 0;
  for (const kind of kinds) {
    const index = markerIndex(markers, kind, start);
    if (index === -1) return false;
    start = index + 1;
  }
  return true;
}

function markerResetPassed(markers) {
  const beforeIndex = markerIndex(markers, 'next-execution');
  if (beforeIndex === -1) return false;
  const before = markers
    .slice(beforeIndex)
    .find((marker) => marker.kind === 'next-execution' && marker.phase === 'before');
  const after = markers
    .slice(beforeIndex)
    .find((marker) => marker.kind === 'next-execution' && marker.phase === 'after');
  return (
    before !== undefined &&
    after !== undefined &&
    after.mapEpoch > before.mapEpoch &&
    after.sourceGeneration === before.sourceGeneration &&
    after.producerInstanceId === before.producerInstanceId &&
    after.reset?.disposition === 'accepted' &&
    after.reset.mapEpoch === after.mapEpoch &&
    after.reset.previousMapEpoch === before.mapEpoch
  );
}

function finalFresh(finalRuntime) {
  return isRecord(finalRuntime) && finalRuntime.freshness === 'fresh';
}

function markerObservationWasCaptured(marker, captureResults) {
  if (marker === undefined || marker.observation === null) return false;
  const key = observationKey(marker.observation);
  return captureResults.some((capture) => capture.matchedObservationKeys?.includes(key));
}

function liveMarkerCausalityPassed(markers, kind, captureResults, execution) {
  const markerIndexValue = markerIndex(markers, kind);
  if (markerIndexValue === -1) return false;
  const marker = markers[markerIndexValue];
  if (!markerObservationWasCaptured(marker, captureResults)) return false;
  const observation = marker.observation;
  if (observation === null) return false;

  const resetBeforeIndex = markers.findIndex(
    (candidate) => candidate.kind === 'next-execution' && candidate.phase === 'before',
  );
  const resetAfterIndex = markers.findIndex(
    (candidate) => candidate.kind === 'next-execution' && candidate.phase === 'after',
  );
  if (execution === 'first') {
    const resetBefore = resetBeforeIndex === -1 ? undefined : markers[resetBeforeIndex];
    return (
      resetBefore === undefined ||
      (markerIndexValue < resetBeforeIndex &&
        observation.receivedMonotonicMs < resetBefore.monotonicMs)
    );
  }
  const resetAfter = resetAfterIndex === -1 ? undefined : markers[resetAfterIndex];
  return (
    resetAfter !== undefined &&
    markerIndexValue > resetAfterIndex &&
    observation.receivedMonotonicMs > resetAfter.monotonicMs &&
    marker.mapEpoch === resetAfter.mapEpoch
  );
}

function checksFrom({ markers, finalRuntime, captureResults, captureErrors, artifact }) {
  const resetPassed = markerResetPassed(markers);
  const stopPassed = hasOrderedMarkers(markers, ['demo-a-stopped', 'cs2-closed', 'runtime-stale']);
  const reopenedBeforeB = hasOrderedMarkers(markers, [
    'next-execution',
    'cs2-reopened',
    'demo-b-live',
  ]);
  const captureFailed =
    captureErrors.length > 0 ||
    captureResults.some(
      (capture) => !capture.manifest.complete || capture.manifest.droppedFrames > 0,
    );
  const checks = {
    productionChain: {
      label: '第一场数据进入生产链路',
      status: liveMarkerCausalityPassed(markers, 'demo-a-live', captureResults, 'first')
        ? 'PASS'
        : 'INCONCLUSIVE',
      reason: liveMarkerCausalityPassed(markers, 'demo-a-live', captureResults, 'first')
        ? 'Demo A marker 已绑定 reset 前同一 execution 的 accepted Capture V1 frame。'
        : '缺少与 Demo A marker 同一 execution、同一 sequence/timestamp 的 Capture V1 frame。',
    },
    realSilenceToStale: {
      label: '停止输入后进入 stale',
      status: stopPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: stopPassed
        ? 'stopdemo、CS2 关闭与 stale 按顺序记录。'
        : '等待 stopdemo、CS2 关闭与 stale 的连续证据。',
    },
    explicitNextExecution: {
      label: '下一场从显式新执行开始',
      status: resetPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: resetPassed
        ? 'map epoch 增加且 producer/source generation 保持一致。'
        : '缺少成功的 explicit reset 证据。',
    },
    demoBRecovery: {
      label: '第二场恢复且无上一场残留',
      status:
        reopenedBeforeB &&
        resetPassed &&
        liveMarkerCausalityPassed(markers, 'demo-b-live', captureResults, 'second') &&
        finalFresh(finalRuntime)
          ? 'PASS'
          : 'INCONCLUSIVE',
      reason:
        reopenedBeforeB &&
        resetPassed &&
        liveMarkerCausalityPassed(markers, 'demo-b-live', captureResults, 'second') &&
        finalFresh(finalRuntime)
          ? 'Demo B marker 已绑定 reset 后新 execution 的 accepted frame，并恢复 fresh。'
          : '等待 CS2 重开、reset 后同一 execution 的 Demo B frame 与 fresh final runtime。',
    },
    captureIntegrity: {
      label: 'Capture recorder 可安全导出',
      status: captureFailed ? 'FAIL' : captureResults.length > 0 ? 'PASS' : 'INCONCLUSIVE',
      reason: captureFailed
        ? 'Capture V1 不完整、发生丢帧或校验失败。'
        : captureResults.length > 0
          ? 'Capture V1 frame count/hash/schema 校验通过。'
          : '没有找到已发布 Capture V1。',
    },
  };
  if (artifact === undefined) {
    checks.captureIntegrity.status = 'FAIL';
    checks.captureIntegrity.reason = '缺少 artifact identity。';
  }
  return checks;
}

function resultFromChecks(checks) {
  const values = Object.values(checks);
  if (values.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (values.some((check) => check.status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

function scanForSecrets(value, path) {
  if (typeof value !== 'string') return;
  if (STEAM_LIKE_ID_PATTERN.test(value)) {
    throw new QualificationEvidenceError('SECRET_LEAK', `${path} contains a Steam-like identity`);
  }
  if (SECRET_PATTERN.test(path) && value.length > 0) {
    throw new QualificationEvidenceError('SECRET_LEAK', `${path} contains a secret-bearing value`);
  }
}

async function walkFiles(root) {
  const output = [];
  async function visit(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'hashes.txt' || entry.name === '.qualification-local') continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) output.push(child);
    }
  }
  await visit(root);
  return output.sort();
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyHashes(runDir) {
  const hashesPath = join(runDir, 'hashes.txt');
  try {
    await access(hashesPath);
  } catch {
    throw new QualificationEvidenceError('INVALID_HASHES', `${hashesPath} is missing`);
  }
  const text = await readFile(hashesPath, 'utf8');
  const entries = text.length === 0 ? [] : text.trimEnd().split('\n');
  const expectedPaths = new Set(
    (await walkFiles(runDir)).map((path) => relative(resolve(runDir), path).replaceAll('\\', '/')),
  );
  const seenPaths = new Set();
  for (const line of entries) {
    const match = /^(?<hash>[a-f0-9]{64})\x20{2}(?<path>.+)$/.exec(line);
    if (match?.groups === undefined)
      throw new QualificationEvidenceError('INVALID_HASHES', `invalid hash line: ${line}`);
    if (seenPaths.has(match.groups.path)) {
      throw new QualificationEvidenceError(
        'INVALID_HASHES',
        'duplicate hash path: ' + match.groups.path,
      );
    }
    seenPaths.add(match.groups.path);
    if (!expectedPaths.has(match.groups.path)) {
      throw new QualificationEvidenceError(
        'INVALID_HASHES',
        'hash list contains an unexpected path: ' + match.groups.path,
      );
    }
    const path = resolve(runDir, match.groups.path);
    const relativePath = relative(resolve(runDir), path);
    if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new QualificationEvidenceError(
        'INVALID_HASHES',
        `hash path escapes evidence root: ${match.groups.path}`,
      );
    }
    if ((await sha256File(path)) !== match.groups.hash) {
      throw new QualificationEvidenceError(
        'HASH_MISMATCH',
        `hash mismatch for ${match.groups.path}`,
      );
    }
  }
  if (seenPaths.size !== expectedPaths.size) {
    const missing = [...expectedPaths].find((path) => !seenPaths.has(path));
    throw new QualificationEvidenceError(
      'INVALID_HASHES',
      'hash list is missing ' + (missing ?? 'one or more evidence files'),
    );
  }
  return entries.length;
}

export async function readQualificationEvidence(runDir) {
  const resolvedRunDir = resolve(runDir);
  const qualification = await readJson(join(resolvedRunDir, 'qualification.json'));
  if (!isRecord(qualification) || qualification.schemaVersion !== QUALIFICATION_SCHEMA_VERSION) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'qualification.json schema is unsupported',
    );
  }
  const runId = requireString(qualification.runId, 'qualification.runId');
  if (!isRecord(qualification.artifact))
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'qualification.artifact is missing');
  requireString(qualification.artifact.gitSha, 'qualification.artifact.gitSha');
  if (!SHA256_PATTERN.test(qualification.artifact.artifactSha256)) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'qualification.artifact.artifactSha256 is invalid',
    );
  }
  if (!QUALIFICATION_RESULT_VALUES.has(qualification.result)) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'qualification.result is invalid');
  }
  if (
    !isRecord(qualification.checks) ||
    CHECK_KEYS.some((key) => {
      const check = qualification.checks[key];
      return !isRecord(check) && typeof check !== 'string';
    })
  ) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'qualification checks are incomplete');
  }
  for (const key of CHECK_KEYS) {
    const check = qualification.checks[key];
    const status = typeof check === 'string' ? check : check.status;
    if (!QUALIFICATION_RESULT_VALUES.has(status)) {
      throw new QualificationEvidenceError(
        'INVALID_EVIDENCE',
        `qualification check ${key} is invalid`,
      );
    }
  }
  const artifact = validateArtifact(await readJson(join(resolvedRunDir, 'artifact.json')));
  if (artifact.gitSha !== qualification.artifact.gitSha) {
    throw new QualificationEvidenceError(
      'ARTIFACT_MISMATCH',
      'qualification and evidence artifact SHA differ',
    );
  }
  const scenario = await readScenario(resolvedRunDir);
  if (scenario.runId !== undefined && scenario.runId !== runId) {
    throw new QualificationEvidenceError(
      'SCENARIO_MISMATCH',
      'scenario runId differs from qualification runId',
    );
  }
  scanJsonForSecrets(qualification, '$.qualification');
  scanJsonForSecrets(artifact, '$.artifact');
  scenario.markers.forEach((marker, index) => scanJsonForSecrets(marker, `$.scenario[${index}]`));
  const environment = await readJson(join(resolvedRunDir, 'environment.json'));
  if (!isRecord(environment))
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'environment.json must be an object');
  requireString(environment.runId, 'environment.runId');
  requireString(environment.windowsVersion, 'environment.windowsVersion');
  requireString(environment.cs2Version, 'environment.cs2Version');
  if (environment.runId !== runId) {
    throw new QualificationEvidenceError(
      'EVIDENCE_MISMATCH',
      'environment runId differs from qualification runId',
    );
  }
  const finalRuntime = await readOptionalJson(join(resolvedRunDir, 'debug', 'final-runtime.json'));
  scanJsonForSecrets(environment, '$.environment');
  if (finalRuntime !== undefined) scanJsonForSecrets(finalRuntime, '$.finalRuntime');
  const recorderDir = join(resolvedRunDir, 'recorder');
  const recorderEntries = await immediateDirectories(recorderDir);
  const captureResults = [];
  const captureErrors = [];
  const observationReferences = liveObservationReferences(scenario.markers);
  for (const captureDir of recorderEntries) {
    if (basename(captureDir).endsWith('.partial')) {
      captureErrors.push(
        new QualificationEvidenceError('UNFINALIZED_CAPTURE', `${captureDir} is unpublished`),
      );
      continue;
    }
    try {
      captureResults.push(await verifyCaptureDirectory(captureDir, observationReferences));
    } catch (error) {
      captureErrors.push(error);
    }
  }
  const result = {
    runDir: resolvedRunDir,
    qualification,
    artifact,
    environment,
    scenario,
    finalRuntime,
    captureResults,
    captureErrors,
    checks: checksFrom({
      markers: scenario.markers,
      finalRuntime,
      captureResults,
      captureErrors,
      artifact,
    }),
  };
  for (const key of CHECK_KEYS) {
    const stored =
      typeof qualification.checks[key] === 'string'
        ? qualification.checks[key]
        : qualification.checks[key].status;
    if (stored !== result.checks[key].status) {
      throw new QualificationEvidenceError(
        'CHECK_MISMATCH',
        `qualification check ${key} differs from recomputed evidence`,
      );
    }
  }
  if (qualification.result !== resultFromChecks(result.checks)) {
    throw new QualificationEvidenceError(
      'CHECK_MISMATCH',
      'qualification result differs from recomputed evidence',
    );
  }
  await verifyHashes(resolvedRunDir);
  return result;
}

export async function writeQualificationEvidence({
  runDir,
  artifact,
  environment = {},
  archiveSha256,
}) {
  const resolvedRunDir = resolve(runDir);
  validateArtifact(artifact);
  const scenario = await readScenario(resolvedRunDir);
  const finalRuntime = await readOptionalJson(join(resolvedRunDir, 'debug', 'final-runtime.json'));
  const recorderDir = join(resolvedRunDir, 'recorder');
  const recorderEntries = await immediateDirectories(recorderDir);
  const captureResults = [];
  const captureErrors = [];
  const observationReferences = liveObservationReferences(scenario.markers);
  for (const captureDir of recorderEntries) {
    if (basename(captureDir).endsWith('.partial')) {
      captureErrors.push(
        new QualificationEvidenceError('UNFINALIZED_CAPTURE', `${captureDir} is unpublished`),
      );
      continue;
    }
    try {
      captureResults.push(await verifyCaptureDirectory(captureDir, observationReferences));
    } catch (error) {
      captureErrors.push(error);
    }
  }
  const checks = checksFrom({
    markers: scenario.markers,
    finalRuntime,
    captureResults,
    captureErrors,
    artifact,
  });
  const result = resultFromChecks(checks);
  const artifactSha256 =
    archiveSha256 ?? artifact.artifactSha256 ?? sha256Text(JSON.stringify(artifact));
  if (!SHA256_PATTERN.test(artifactSha256)) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'artifact digest must be a lowercase SHA-256 value',
    );
  }
  const qualification = {
    schemaVersion: QUALIFICATION_SCHEMA_VERSION,
    runId:
      scenario.runId ?? (typeof environment.runId === 'string' ? environment.runId : 'unknown'),
    artifact: {
      gitSha: artifact.gitSha,
      artifactSha256,
    },
    environment: {
      runId:
        typeof environment.runId === 'string' ? environment.runId : (scenario.runId ?? 'unknown'),
      windowsVersion:
        typeof environment.windowsVersion === 'string' ? environment.windowsVersion : 'unknown',
      cs2Version: typeof environment.cs2Version === 'string' ? environment.cs2Version : 'unknown',
    },
    result,
    checks: Object.fromEntries(Object.entries(checks).map(([key, check]) => [key, check.status])),
  };
  const qualificationPath = join(resolvedRunDir, 'qualification.json');
  await writeFile(qualificationPath, `${JSON.stringify(qualification, null, 2)}\n`, 'utf8');
  const report = renderReport({
    qualification,
    artifact,
    scenario,
    finalRuntime,
    captureResults,
    captureErrors,
    checks,
  });
  await writeFile(join(resolvedRunDir, 'REPORT.md'), report, 'utf8');
  const files = await walkFiles(resolvedRunDir);
  const hashLines = [];
  for (const path of files) {
    const digest = await sha256File(path);
    hashLines.push(`${digest}  ${relative(resolvedRunDir, path).replaceAll('\\', '/')}`);
  }
  await writeFile(join(resolvedRunDir, 'hashes.txt'), `${hashLines.join('\n')}\n`, 'utf8');
  return { qualification, report, captureResults, captureErrors, checks };
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function renderReport({
  qualification,
  artifact,
  scenario,
  finalRuntime,
  captureResults,
  captureErrors,
  checks,
}) {
  const lines = [
    '# RivalHub Broadcast Qualification Report',
    '',
    `- Result: **${qualification.result}**`,
    `- Run ID: \`${qualification.runId}\``,
    `- Git SHA: \`${artifact.gitSha}\``,
    `- Node runtime: \`${artifact.nodeVersion}\``,
    '',
    '## Checks',
    '',
  ];
  for (const check of Object.values(checks))
    lines.push(`- ${check.label}: **${check.status}** — ${check.reason}`);
  lines.push(
    '',
    '## Capture',
    '',
    `- Published captures: ${captureResults.length}`,
    `- Capture errors: ${captureErrors.length}`,
  );
  for (const capture of captureResults)
    lines.push(
      `- \`${basename(capture.directory)}\`: ${capture.frameCount} frames, ${capture.computedFramesSha256}`,
    );
  lines.push('', '## Scenario markers', '');
  if (scenario.markers.length === 0) lines.push('- No markers recorded.');
  else
    for (const marker of scenario.markers)
      lines.push(
        `- ${marker.wallClockAt} — ${marker.kind}${marker.phase === undefined ? '' : ` (${marker.phase})`}`,
      );
  lines.push(
    '',
    '## Final runtime',
    '',
    finalRuntime === undefined
      ? '- final-runtime.json unavailable'
      : `- Freshness: **${finalRuntime.freshness ?? 'unknown'}**`,
    '',
    'This report contains no raw GSI token or account identity.',
  );
  return `${lines.join('\n')}\n`;
}

export function scanJsonForSecrets(value, path = '$') {
  if (typeof value === 'string') {
    scanForSecrets(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanJsonForSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) scanJsonForSecrets(child, `${path}.${key}`);
  }
}

async function qualificationCli(argv) {
  const mode = argv[0];
  if (mode === '--verify') {
    const runDir = argv[1];
    if (runDir === undefined || argv.length !== 2)
      throw new Error('usage: verify-evidence.mjs --verify <evidence-dir>');
    const result = await readQualificationEvidence(runDir);
    console.log(
      JSON.stringify({
        result: result.qualification.result,
        runId: result.qualification.runId,
        gitSha: result.qualification.artifact.gitSha,
        captureCount: result.captureResults.length,
        hashEntries: await verifyHashes(result.runDir),
      }),
    );
    return;
  }
  if (mode === '--finish') {
    const runDir = argv[1];
    if (runDir === undefined)
      throw new Error(
        'usage: verify-evidence.mjs --finish <evidence-dir> [--archive-sha256 <sha256>]',
      );
    let archiveSha256;
    if (argv.length === 4 && argv[2] === '--archive-sha256') archiveSha256 = argv[3];
    else if (argv.length !== 2)
      throw new Error(
        'usage: verify-evidence.mjs --finish <evidence-dir> [--archive-sha256 <sha256>]',
      );
    const artifact = await readJson(join(resolve(runDir), 'artifact.json'));
    let environment = {};
    try {
      environment = await readJson(join(resolve(runDir), 'environment.json'));
    } catch {
      // An interrupted run may not have platform metadata; it remains INCONCLUSIVE.
    }
    const result = await writeQualificationEvidence({
      runDir,
      artifact,
      environment,
      archiveSha256,
    });
    console.log(
      JSON.stringify({ result: result.qualification.result, runId: result.qualification.runId }),
    );
    return;
  }
  throw new Error('usage: verify-evidence.mjs --finish <evidence-dir> | --verify <evidence-dir>');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  qualificationCli(process.argv.slice(2)).catch((error) => {
    const code = error instanceof QualificationEvidenceError ? `${error.code}: ` : '';
    console.error(
      `QUALIFICATION_EVIDENCE_ERROR: ${code}${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
