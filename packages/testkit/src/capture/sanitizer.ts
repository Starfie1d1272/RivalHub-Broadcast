import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';

import { canonicalJson, canonicalJsonLine } from './canonical-json.js';
import { CaptureFormatError } from './errors.js';
import { iterateCaptureFrames, verifyCapture } from './reader.js';
import type {
  CaptureFrameV1,
  CaptureManifestV1,
  CaptureSelection,
  VerifiedCapture,
} from './types.js';

const SANITIZER_VERSION = 1 as const;
const STEAM_LIKE_ID_PATTERN = /^\d{17}$/;
const IDENTITY_KEYS = new Set([
  'steamid',
  'steam64',
  'steamid64',
  'steam_id',
  'steam_id64',
  'accountid',
  'account_id',
  'xuid',
]);
const SAFE_GSI_PARAMETERS = [
  'timeout',
  'buffer',
  'throttle',
  'heartbeat',
  'precision_time',
  'precision_position',
  'precision_vector',
] as const;

export interface SanitizeCaptureOptions {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly scenario: string;
  readonly lifecycleCoverage: 'partial' | 'full-match';
  readonly selection?: CaptureSelection;
}

interface NameMappings {
  readonly identities: Map<string, string>;
  readonly playerNames: Map<string, string>;
  readonly observerNames: Map<string, string>;
  readonly teamNames: Map<string, string>;
  readonly sensitiveLiterals: Set<string>;
  readonly originalNames: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function normalizedPath(path: readonly (string | number)[]): string {
  return path.map((segment) => String(segment).toLowerCase()).join('.');
}

function isIdentityKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll('-', '_');
  return IDENTITY_KEYS.has(normalized) || normalized.includes('steamid');
}

function isSteamLikeId(value: string): boolean {
  return STEAM_LIKE_ID_PATTERN.test(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'auth' ||
    normalized === 'token' ||
    normalized === 'password' ||
    normalized === 'secret' ||
    normalized === 'uri' ||
    normalized === 'endpoint' ||
    normalized.includes('token') ||
    normalized.includes('secret')
  );
}

function isPlayerContext(path: readonly (string | number)[]): boolean {
  const text = normalizedPath(path);
  return text.includes('player') || text.includes('allplayers');
}

function isPlayerNameContext(path: readonly (string | number)[]): boolean {
  const text = normalizedPath(path);
  return (
    isPlayerContext(path) &&
    !text.includes('weapons') &&
    !text.includes('grenades') &&
    !text.includes('flames')
  );
}

function isObserverContext(path: readonly (string | number)[]): boolean {
  const text = normalizedPath(path);
  return text.includes('observer') || text.includes('spectator');
}

function isTeamNameContext(path: readonly (string | number)[]): boolean {
  const text = normalizedPath(path);
  return text.includes('team_ct') || text.includes('team_t');
}

function isNameField(key: string): boolean {
  return key.toLowerCase() === 'name' || key.toLowerCase() === 'displayname';
}

function isTeamDisplayField(key: string): boolean {
  return key.toLowerCase() === 'clan';
}

function collectSensitiveValues(
  value: unknown,
  path: readonly (string | number)[],
  output: Set<string>,
): void {
  if (typeof value === 'string') {
    const key = path.at(-1);
    if (key !== undefined && isSensitiveKey(String(key))) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectSensitiveValues(entry, [...path, index], output));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectSensitiveValues(child, [...path, key], output);
  }
}

function collectMappingsFromValue(
  value: unknown,
  path: readonly (string | number)[],
  identityKinds: Map<string, Set<'player' | 'observer'>>,
  playerNames: Set<string>,
  observerNames: Set<string>,
  teamNames: Set<string>,
  sensitiveLiterals: Set<string>,
): void {
  if (typeof value === 'string' || typeof value === 'number') {
    const key = path.at(-1);
    const parentPath = path.slice(0, -1);
    if (key !== undefined && isIdentityKey(String(key)) && isStringOrNumber(value)) {
      const identity = String(value);
      const kind = isPlayerContext(parentPath) ? 'player' : 'observer';
      const kinds = identityKinds.get(identity) ?? new Set<'player' | 'observer'>();
      kinds.add(kind);
      identityKinds.set(identity, kinds);
      if (isSteamLikeId(identity)) sensitiveLiterals.add(identity);
    }
    if (typeof value === 'string' && key !== undefined) {
      if (isNameField(String(key)) && isTeamNameContext(parentPath)) {
        if (value.trim().length > 0) teamNames.add(value);
      } else if (isTeamDisplayField(String(key)) && isPlayerNameContext(parentPath)) {
        if (value.trim().length > 0) teamNames.add(value);
      } else if (isNameField(String(key)) && isPlayerNameContext(parentPath)) {
        playerNames.add(value);
      } else if (isNameField(String(key)) && isObserverContext(parentPath)) {
        observerNames.add(value);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectMappingsFromValue(
        entry,
        [...path, index],
        identityKinds,
        playerNames,
        observerNames,
        teamNames,
        sensitiveLiterals,
      ),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (isSteamLikeId(key)) {
      const kind = isPlayerContext(path) ? 'player' : 'observer';
      const kinds = identityKinds.get(key) ?? new Set<'player' | 'observer'>();
      kinds.add(kind);
      identityKinds.set(key, kinds);
      sensitiveLiterals.add(key);
    }
    collectSensitiveValues(child, childPath, sensitiveLiterals);
    collectMappingsFromValue(
      child,
      childPath,
      identityKinds,
      playerNames,
      observerNames,
      teamNames,
      sensitiveLiterals,
    );
  }
}

function numberedMap(values: Iterable<string>, prefix: string): Map<string, string> {
  return new Map(
    [...values]
      .sort()
      .map((value, index) => [value, `${prefix}${String(index + 1).padStart(3, '0')}`]),
  );
}

function teamNumberedMap(values: Iterable<string>): Map<string, string> {
  const grouped = new Map<string, string[]>();
  for (const value of values) {
    const identity = value.trim();
    const variants = grouped.get(identity) ?? [];
    variants.push(value);
    grouped.set(identity, variants);
  }

  const output = new Map<string, string>();
  [...grouped.keys()].sort().forEach((identity, index) => {
    const replacement = `Fixture Team ${String(index + 1).padStart(3, '0')}`;
    for (const variant of grouped.get(identity) ?? []) output.set(variant, replacement);
  });
  return output;
}

async function discoverMappings(capture: VerifiedCapture): Promise<NameMappings> {
  const identityKinds = new Map<string, Set<'player' | 'observer'>>();
  const playerNames = new Set<string>();
  const observerNames = new Set<string>();
  const teamNames = new Set<string>();
  const sensitiveLiterals = new Set<string>();

  collectSensitiveValues(capture.manifest.gsiConfig, ['gsiConfig'], sensitiveLiterals);
  for await (const frame of iterateCaptureFrames(capture)) {
    collectMappingsFromValue(
      frame.payload,
      ['payload'],
      identityKinds,
      playerNames,
      observerNames,
      teamNames,
      sensitiveLiterals,
    );
  }

  const playerIdentities = [...identityKinds]
    .filter(([, kinds]) => kinds.has('player'))
    .map(([value]) => value);
  const observerIdentities = [...identityKinds]
    .filter(([, kinds]) => !kinds.has('player'))
    .map(([value]) => value);
  const identities = new Map<string, string>([
    ...numberedMap(playerIdentities, 'fixture-player-'),
    ...numberedMap(observerIdentities, 'fixture-observer-'),
  ]);
  const originalNames = new Set([...playerNames, ...observerNames, ...teamNames]);

  return {
    identities,
    playerNames: numberedMap(playerNames, 'Fixture Player '),
    observerNames: numberedMap(observerNames, 'Fixture Observer '),
    teamNames: teamNumberedMap(teamNames),
    sensitiveLiterals,
    originalNames,
  };
}

function replacementFor(
  value: string,
  path: readonly (string | number)[],
  mappings: NameMappings,
): string {
  const identityReplacement = mappings.identities.get(value);
  if (identityReplacement !== undefined) return identityReplacement;

  const teamReplacement = mappings.teamNames.get(value);
  if (teamReplacement !== undefined) return teamReplacement;

  const key = path.at(-1);
  const parentPath = path.slice(0, -1);
  if (key !== undefined && isNameField(String(key))) {
    if (isPlayerNameContext(parentPath)) {
      return mappings.playerNames.get(value) ?? value;
    }
    if (isObserverContext(parentPath)) {
      return mappings.observerNames.get(value) ?? value;
    }
  }
  return value;
}

function sanitizeValueAtPath(
  value: unknown,
  path: readonly (string | number)[],
  mappings: NameMappings,
): unknown {
  if (typeof value === 'string') return replacementFor(value, path, mappings);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValueAtPath(entry, [...path, index], mappings));
  }
  if (!isRecord(value)) throw new TypeError('Capture payload contains a non-JSON object');

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    const childPath = [...path, key];
    const sanitizedKey = replacementFor(key, childPath, mappings);
    const sanitizedValue = sanitizeValueAtPath(child, childPath, mappings);
    output[sanitizedKey] = sanitizedValue;
  }
  return output;
}

function sanitizeValue(value: unknown, mappings: NameMappings): unknown {
  return sanitizeValueAtPath(value, [], mappings);
}

function sanitizedGsiConfig(gsiConfig: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const parameters = gsiConfig.parameters;
  if (isRecord(parameters)) {
    const safeParameters: Record<string, unknown> = {};
    for (const key of SAFE_GSI_PARAMETERS) {
      const value = parameters[key];
      if (
        value === undefined ||
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        if (value !== undefined) safeParameters[key] = value;
      }
    }
    if (Object.keys(safeParameters).length > 0) output.parameters = safeParameters;
  }
  if (
    Array.isArray(gsiConfig.components) &&
    gsiConfig.components.every((value) => typeof value === 'string')
  ) {
    output.components = [...gsiConfig.components];
  }
  return output;
}

function selectionMatches(frame: CaptureFrameV1, selection: CaptureSelection): boolean {
  return (
    selection.kind === 'all' ||
    (frame.sequence >= selection.firstSequence && frame.sequence <= selection.lastSequence)
  );
}

function validateSelection(selection: CaptureSelection | undefined): CaptureSelection {
  if (selection === undefined) return { kind: 'all' };
  if (selection.kind === 'all') return selection;
  if (
    !Number.isSafeInteger(selection.firstSequence) ||
    !Number.isSafeInteger(selection.lastSequence) ||
    selection.firstSequence < 0 ||
    selection.lastSequence < selection.firstSequence
  ) {
    throw new CaptureFormatError(
      'INVALID_SELECTION',
      'sequence selection must be a valid inclusive range',
    );
  }
  return selection;
}

function sourceSelectionId(sourceCaptureId: string, selection: CaptureSelection): string {
  if (selection.kind === 'all') return `sanitized-${sourceCaptureId}-all`;
  return `sanitized-${sourceCaptureId}-seq-${selection.firstSequence}-${selection.lastSequence}`;
}

function assertNoLeak(line: string, mappings: NameMappings): void {
  for (const literal of [...mappings.sensitiveLiterals, ...mappings.originalNames]) {
    if (literal.length > 0 && line.includes(JSON.stringify(literal))) {
      throw new CaptureFormatError(
        'SANITIZATION_LEAK',
        `sanitized frame contains redacted value ${literal}`,
      );
    }
  }
  if (/\b\d{17}\b/.test(line)) {
    throw new CaptureFormatError(
      'SANITIZATION_LEAK',
      'sanitized frame contains a Steam-like identifier',
    );
  }
}

async function writeFrameLine(
  stream: ReturnType<typeof createWriteStream>,
  line: string,
): Promise<void> {
  if (!stream.write(line, 'utf8')) await once(stream, 'drain');
}

async function writeSanitizedFrames(
  input: VerifiedCapture,
  tempFramesPath: string,
  selection: CaptureSelection,
  mappings: NameMappings,
): Promise<{
  readonly count: number;
  readonly firstSequence: number | undefined;
  readonly lastSequence: number | undefined;
  readonly hash: string;
}> {
  const stream = createWriteStream(tempFramesPath, { encoding: 'utf8' });
  const hash = createHash('sha256');
  let count = 0;
  let firstSequence: number | undefined;
  let lastSequence: number | undefined;
  try {
    for await (const frame of iterateCaptureFrames(input)) {
      if (!selectionMatches(frame, selection)) continue;
      const sanitizedFrame: CaptureFrameV1 = {
        version: 1,
        sequence: frame.sequence,
        elapsedUs: frame.elapsedUs,
        receivedAt: frame.receivedAt,
        payload: sanitizeValue(frame.payload, mappings) as Record<string, unknown>,
      };
      const line = canonicalJsonLine(sanitizedFrame);
      assertNoLeak(line, mappings);
      hash.update(Buffer.from(line, 'utf8'));
      await writeFrameLine(stream, line);
      count += 1;
      firstSequence ??= frame.sequence;
      lastSequence = frame.sequence;
    }
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return { count, firstSequence, lastSequence, hash: hash.digest('hex') };
}

function sanitizedManifest(
  source: CaptureManifestV1,
  sourceFramesSha256: string,
  selection: CaptureSelection,
  scenario: string,
  lifecycleCoverage: 'partial' | 'full-match',
  frameStats: { readonly count: number; readonly hash: string },
): CaptureManifestV1 {
  return {
    formatVersion: 1,
    captureId: sourceSelectionId(source.captureId, selection),
    createdAt: source.createdAt,
    platform: source.platform,
    ...(source.windowsVersion === undefined ? {} : { windowsVersion: source.windowsVersion }),
    ...(source.cs2Build === undefined ? {} : { cs2Build: source.cs2Build }),
    broadcastCommit: source.broadcastCommit,
    scenario,
    gsiConfig: sanitizedGsiConfig(source.gsiConfig),
    complete: true,
    frameCount: frameStats.count,
    droppedFrames: 0,
    framesSha256: frameStats.hash,
    provenance: {
      fixtureKind: 'sanitized-real-capture',
      sourceCaptureId: source.captureId,
      sourceFramesSha256,
      sourceFrameSelection: selection,
      sanitizerVersion: SANITIZER_VERSION,
      lifecycleCoverage,
    },
  };
}

export async function sanitizeCapture(options: SanitizeCaptureOptions): Promise<VerifiedCapture> {
  if (options.scenario.length === 0) {
    throw new CaptureFormatError('INVALID_SELECTION', 'scenario must be a non-empty string');
  }
  const selection = validateSelection(options.selection);
  const inputDir = resolve(options.inputDir);
  const outputDir = resolve(options.outputDir);
  if (inputDir === outputDir || outputDir.startsWith(`${inputDir}${sep}`)) {
    throw new CaptureFormatError(
      'OUTPUT_PATH_INVALID',
      'sanitizer output must not be the input directory or its child',
    );
  }
  try {
    await access(outputDir);
    throw new CaptureFormatError('OUTPUT_EXISTS', `output directory already exists: ${outputDir}`);
  } catch (error) {
    if (error instanceof CaptureFormatError) throw error;
  }

  const input = await verifyCapture(inputDir);
  if (!input.manifest.complete || input.manifest.droppedFrames !== 0) {
    throw new CaptureFormatError(
      'INELIGIBLE_GOLD_SOURCE',
      'incomplete or dropped-frame captures cannot be materialized as sanitized fixtures',
      { captureId: input.manifest.captureId },
    );
  }
  const mappings = await discoverMappings(input);
  await mkdir(dirname(outputDir), { recursive: true });
  const tempDir = await mkdtemp(join(dirname(outputDir), '.rivalhub-testkit-'));
  try {
    const tempFramesPath = join(tempDir, 'frames.jsonl');
    const frameStats = await writeSanitizedFrames(input, tempFramesPath, selection, mappings);
    if (frameStats.count === 0) {
      throw new CaptureFormatError(
        'INVALID_SELECTION',
        'selection did not include any source frames',
      );
    }
    if (
      selection.kind === 'sequence-range' &&
      (frameStats.firstSequence !== selection.firstSequence ||
        frameStats.lastSequence !== selection.lastSequence)
    ) {
      throw new CaptureFormatError(
        'INVALID_SELECTION',
        `selection ${selection.firstSequence}..${selection.lastSequence} did not match available frame boundaries`,
      );
    }
    const manifest = sanitizedManifest(
      input.manifest,
      input.computedFramesSha256,
      selection,
      options.scenario,
      options.lifecycleCoverage,
      frameStats,
    );
    await writeFile(join(tempDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8');
    await verifyCapture(tempDir);
    await access(outputDir).then(
      () => {
        throw new CaptureFormatError(
          'OUTPUT_EXISTS',
          `output directory already exists: ${outputDir}`,
        );
      },
      () => undefined,
    );
    await rename(tempDir, outputDir);
    return verifyCapture(outputDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
