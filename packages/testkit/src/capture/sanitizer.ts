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

const SANITIZER_VERSION = 2 as const;
const PRIVATE_HOST_PATTERN = /^(?:localhost|.+\.local|.+\.internal|.+\.lan)$/i;
const ABSOLUTE_LOCAL_PATH_PATTERN =
  /(?:(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/](?![\\/])|\\\\[^\\/]+[\\/][^\\/]+[\\/]|\/(?:Users|home|private|tmp|var|Volumes|mnt)\/)[^\s"'<>]*/g;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(authorization|auth|access[_-]?token|refresh[_-]?token|token|password|passwd|client[_-]?secret|api[_-]?key)\s*[:=]\s*(?:bearer\s+)?([^\s,;&"'<>]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export interface SanitizeCaptureOptions {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly scenario: string;
  readonly lifecycleCoverage: 'partial' | 'full-match';
  readonly selection?: CaptureSelection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  return (
    normalized === 'auth' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'password' ||
    normalized.endsWith('password') ||
    normalized === 'passwd' ||
    normalized === 'secret' ||
    normalized.endsWith('secret') ||
    normalized === 'apikey' ||
    normalized === 'accesskey'
  );
}

function isEndpointKey(key: string): boolean {
  return ['endpoint', 'uri', 'url', 'host', 'address'].includes(key.toLowerCase());
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const second = octets[1] ?? -1;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && second >= 16 && second <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isPrivateEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      host === '::1' || host === '0.0.0.0' || PRIVATE_HOST_PATTERN.test(host) || isPrivateIpv4(host)
    );
  } catch {
    return false;
  }
}

function scrubString(value: string): string {
  return value
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(CREDENTIAL_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(ABSOLUTE_LOCAL_PATH_PATTERN, '[REDACTED_LOCAL_PATH]');
}

function collectSensitiveLiterals(
  value: unknown,
  insideSensitiveField: boolean,
  output: Set<string>,
): void {
  if (typeof value === 'string') {
    if (insideSensitiveField && value.length > 0) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectSensitiveLiterals(child, insideSensitiveField, output);
    return;
  }
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      collectSensitiveLiterals(child, insideSensitiveField || isSensitiveKey(childKey), output);
    }
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((child) => sanitizeValue(child));
  if (!isRecord(value)) throw new TypeError('Capture payload contains a non-JSON object');

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    if (typeof child === 'string' && isEndpointKey(key) && isPrivateEndpoint(child)) continue;
    output[key] = sanitizeValue(child);
  }
  return output;
}

function assertNoLeak(line: string, sensitiveLiterals: ReadonlySet<string>): void {
  for (const literal of sensitiveLiterals) {
    if (literal.length > 0 && line.includes(JSON.stringify(literal))) {
      throw new CaptureFormatError(
        'SANITIZATION_LEAK',
        'sanitized frame contains a credential value',
      );
    }
  }
  if (
    ABSOLUTE_LOCAL_PATH_PATTERN.test(line) ||
    [
      ...line.matchAll(
        /(?:https?:\/\/)?(?:localhost|[a-z0-9.-]+\.(?:local|internal|lan)|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?/gi,
      ),
    ].some(([endpoint]) => isPrivateEndpoint(endpoint))
  ) {
    ABSOLUTE_LOCAL_PATH_PATTERN.lastIndex = 0;
    throw new CaptureFormatError(
      'SANITIZATION_LEAK',
      'sanitized frame contains local machine information',
    );
  }
  ABSOLUTE_LOCAL_PATH_PATTERN.lastIndex = 0;
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
  sensitiveLiterals: ReadonlySet<string>,
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
      if (
        selection.kind === 'sequence-range' &&
        (frame.sequence < selection.firstSequence || frame.sequence > selection.lastSequence)
      )
        continue;
      const sanitizedFrame: CaptureFrameV1 = {
        version: 1,
        sequence: frame.sequence,
        elapsedUs: frame.elapsedUs,
        receivedAt: frame.receivedAt,
        payload: sanitizeValue(frame.payload) as Record<string, unknown>,
      };
      const line = canonicalJsonLine(sanitizedFrame);
      assertNoLeak(line, sensitiveLiterals);
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
    captureId:
      selection.kind === 'all'
        ? `sanitized-${source.captureId}-all`
        : `sanitized-${source.captureId}-seq-${selection.firstSequence}-${selection.lastSequence}`,
    createdAt: source.createdAt,
    platform: source.platform,
    ...(source.cs2Build === undefined ? {} : { cs2Build: source.cs2Build }),
    broadcastCommit: source.broadcastCommit,
    scenario,
    gsiConfig: sanitizeValue(source.gsiConfig) as Record<string, unknown>,
    complete: true,
    frameCount: frameStats.count,
    droppedFrames: 0,
    framesSha256: frameStats.hash,
    provenance: {
      fixtureKind: 'sanitized-real-capture',
      sourceCaptureId: scrubString(source.captureId),
      sourceFramesSha256,
      sourceFrameSelection: selection,
      sanitizerVersion: SANITIZER_VERSION,
      lifecycleCoverage,
    },
  };
}

function validateSelection(selection: CaptureSelection | undefined): CaptureSelection {
  if (selection === undefined || selection.kind === 'all') return { kind: 'all' };
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
  const sensitiveLiterals = new Set<string>();
  collectSensitiveLiterals(input.manifest.gsiConfig, false, sensitiveLiterals);
  for await (const frame of iterateCaptureFrames(input)) {
    collectSensitiveLiterals(frame.payload, false, sensitiveLiterals);
  }
  await mkdir(dirname(outputDir), { recursive: true });
  const tempDir = await mkdtemp(join(dirname(outputDir), '.rivalhub-testkit-'));
  try {
    const tempFramesPath = join(tempDir, 'frames.jsonl');
    const frameStats = await writeSanitizedFrames(
      input,
      tempFramesPath,
      selection,
      sensitiveLiterals,
    );
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
    const manifestLine = `${canonicalJson(manifest)}\n`;
    assertNoLeak(manifestLine, sensitiveLiterals);
    await writeFile(join(tempDir, 'manifest.json'), manifestLine, 'utf8');
    await verifyCapture(tempDir);
    await access(outputDir).then(
      () => {
        throw new CaptureFormatError('OUTPUT_EXISTS', `sanitizer output already exists`);
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
