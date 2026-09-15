import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  QUALIFICATION_CONTRACT,
  QUALIFICATION_FRESHNESS_VALUES,
  QUALIFICATION_LIVE_MARKER_KINDS,
  QUALIFICATION_MARKER_KINDS,
  QUALIFICATION_MARKER_PHASES,
  QUALIFICATION_RESET_DISPOSITIONS,
  QUALIFICATION_RESET_EVIDENCE_FIELDS,
  QUALIFICATION_SCHEMA_VERSION,
  QualificationEvidenceError,
} from './contract.mjs';
import { assertUtc, isRecord, isSafeNonNegativeInteger, requireString } from './integrity.mjs';

export function validateObservation(observation, marker, lineNumber) {
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

export function validateMarker(marker, runId, lineNumber) {
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
      !isSafeNonNegativeInteger(marker.reset.mapEpoch) ||
      typeof marker.reset.programTelemetryCleared !== 'boolean' ||
      QUALIFICATION_RESET_EVIDENCE_FIELDS.some(
        (field) => !Object.prototype.hasOwnProperty.call(marker.reset, field),
      )
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

export async function readScenario(runDir) {
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

export function liveObservationReferences(markers) {
  return markers
    .filter((marker) => QUALIFICATION_LIVE_MARKER_KINDS.has(marker.kind))
    .map((marker) => marker.observation)
    .filter((observation) => observation !== null);
}

export function markerIndex(markers, kind, start = 0) {
  for (let index = start; index < markers.length; index += 1) {
    if (markers[index]?.kind === kind) return index;
  }
  return -1;
}

export function hasOrderedMarkers(markers, kinds) {
  let start = 0;
  for (const kind of kinds) {
    const index = markerIndex(markers, kind, start);
    if (index === -1) return false;
    start = index + 1;
  }
  return true;
}
