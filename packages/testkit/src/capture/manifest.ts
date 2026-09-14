import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CaptureFormatError } from './errors.js';
import type { CaptureManifestV1, CaptureSelection, GoldCaptureProvenanceV1 } from './types.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isValidUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !RFC3339_UTC_PATTERN.test(value)) return false;
  const normalized = value.replace(/\.(\d{3})\d+Z$/, '.$1Z');
  return Number.isFinite(Date.parse(normalized));
}

function requiredString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CaptureFormatError('INVALID_MANIFEST', `${key} must be a non-empty string`, {
      path: `manifest.${key}`,
    });
  }
  return value;
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new CaptureFormatError('INVALID_MANIFEST', `${key} must be a string`, {
      path: `manifest.${key}`,
    });
  }
  return value;
}

function validateSelection(raw: unknown, path: string): CaptureSelection {
  if (!isRecord(raw) || (raw.kind !== 'all' && raw.kind !== 'sequence-range')) {
    throw new CaptureFormatError('INVALID_PROVENANCE', `${path} is invalid`, { path });
  }
  if (raw.kind === 'all') return { kind: 'all' };
  if (
    !isNonNegativeSafeInteger(raw.firstSequence) ||
    !isNonNegativeSafeInteger(raw.lastSequence) ||
    raw.firstSequence > raw.lastSequence
  ) {
    throw new CaptureFormatError('INVALID_PROVENANCE', `${path} sequence range is invalid`, {
      path,
    });
  }
  return {
    kind: 'sequence-range',
    firstSequence: raw.firstSequence,
    lastSequence: raw.lastSequence,
  };
}

function validateProvenance(raw: unknown): GoldCaptureProvenanceV1 {
  if (!isRecord(raw)) {
    throw new CaptureFormatError('INVALID_PROVENANCE', 'manifest.provenance must be an object', {
      path: 'manifest.provenance',
    });
  }
  if (raw.fixtureKind !== 'sanitized-real-capture' || raw.sanitizerVersion !== 1) {
    throw new CaptureFormatError('INVALID_PROVENANCE', 'manifest.provenance version is invalid', {
      path: 'manifest.provenance',
    });
  }
  const sourceCaptureId = raw.sourceCaptureId;
  const sourceFramesSha256 = raw.sourceFramesSha256;
  if (typeof sourceCaptureId !== 'string' || sourceCaptureId.length === 0) {
    throw new CaptureFormatError('INVALID_PROVENANCE', 'sourceCaptureId is invalid', {
      path: 'manifest.provenance.sourceCaptureId',
    });
  }
  if (typeof sourceFramesSha256 !== 'string' || !SHA256_PATTERN.test(sourceFramesSha256)) {
    throw new CaptureFormatError('INVALID_PROVENANCE', 'sourceFramesSha256 is invalid', {
      path: 'manifest.provenance.sourceFramesSha256',
    });
  }
  if (raw.lifecycleCoverage !== 'partial' && raw.lifecycleCoverage !== 'full-match') {
    throw new CaptureFormatError('INVALID_PROVENANCE', 'lifecycleCoverage is invalid', {
      path: 'manifest.provenance.lifecycleCoverage',
    });
  }
  return {
    fixtureKind: 'sanitized-real-capture',
    sourceCaptureId,
    sourceFramesSha256,
    sourceFrameSelection: validateSelection(
      raw.sourceFrameSelection,
      'manifest.provenance.sourceFrameSelection',
    ),
    sanitizerVersion: 1,
    lifecycleCoverage: raw.lifecycleCoverage,
  };
}

function parseManifest(raw: unknown): CaptureManifestV1 {
  if (!isRecord(raw)) {
    throw new CaptureFormatError('INVALID_MANIFEST', 'manifest.json must contain an object', {
      path: 'manifest.json',
    });
  }
  if (raw.formatVersion !== 1) {
    if (typeof raw.formatVersion === 'number') {
      throw new CaptureFormatError(
        'UNSUPPORTED_FORMAT_VERSION',
        `unsupported capture format version: ${String(raw.formatVersion)}`,
        { path: 'manifest.formatVersion' },
      );
    }
    throw new CaptureFormatError('INVALID_MANIFEST', 'formatVersion must be 1', {
      path: 'manifest.formatVersion',
    });
  }

  const createdAt = raw.createdAt;
  if (!isValidUtcTimestamp(createdAt)) {
    throw new CaptureFormatError(
      'INVALID_MANIFEST',
      'createdAt must be an RFC3339 UTC timestamp ending in Z',
      {
        path: 'manifest.createdAt',
      },
    );
  }
  const gsiConfig = raw.gsiConfig;
  if (!isRecord(gsiConfig)) {
    throw new CaptureFormatError('INVALID_GSI_CONFIG', 'gsiConfig must be a JSON object', {
      path: 'manifest.gsiConfig',
    });
  }
  const frameCount = raw.frameCount;
  const droppedFrames = raw.droppedFrames;
  if (!isNonNegativeSafeInteger(frameCount) || !isNonNegativeSafeInteger(droppedFrames)) {
    throw new CaptureFormatError(
      'INVALID_MANIFEST',
      'frameCount and droppedFrames must be non-negative safe integers',
      {
        path: 'manifest',
      },
    );
  }
  const framesSha256 = raw.framesSha256;
  if (
    framesSha256 !== undefined &&
    (typeof framesSha256 !== 'string' || !SHA256_PATTERN.test(framesSha256))
  ) {
    throw new CaptureFormatError(
      'INVALID_MANIFEST',
      'framesSha256 must be a lowercase SHA-256 hex digest',
      {
        path: 'manifest.framesSha256',
      },
    );
  }
  const windowsVersion = optionalString(raw, 'windowsVersion');
  const notes = optionalString(raw, 'notes');
  const cs2Build = raw.cs2Build;
  if (cs2Build !== undefined && typeof cs2Build !== 'string' && typeof cs2Build !== 'number') {
    throw new CaptureFormatError('INVALID_MANIFEST', 'cs2Build must be a string or number', {
      path: 'manifest.cs2Build',
    });
  }
  if (typeof raw.complete !== 'boolean') {
    throw new CaptureFormatError('INVALID_MANIFEST', 'complete must be boolean', {
      path: 'manifest.complete',
    });
  }

  const manifest: CaptureManifestV1 = {
    formatVersion: 1,
    captureId: requiredString(raw, 'captureId'),
    createdAt,
    platform: requiredString(raw, 'platform'),
    ...(windowsVersion === undefined ? {} : { windowsVersion }),
    ...(cs2Build === undefined ? {} : { cs2Build }),
    broadcastCommit: requiredString(raw, 'broadcastCommit'),
    scenario: requiredString(raw, 'scenario'),
    ...(notes === undefined ? {} : { notes }),
    gsiConfig,
    complete: raw.complete,
    frameCount,
    droppedFrames,
    ...(framesSha256 === undefined ? {} : { framesSha256 }),
    ...(raw.provenance === undefined ? {} : { provenance: validateProvenance(raw.provenance) }),
  };

  return manifest;
}

export async function readCaptureManifest(captureDir: string): Promise<CaptureManifestV1> {
  const manifestPath = join(captureDir, 'manifest.json');
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new CaptureFormatError(
      'INVALID_MANIFEST',
      `cannot read ${manifestPath}: ${String(error)}`,
      {
        path: manifestPath,
      },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CaptureFormatError(
      'INVALID_MANIFEST',
      `manifest.json is not valid JSON: ${String(error)}`,
      {
        path: manifestPath,
      },
    );
  }
  return parseManifest(raw);
}
