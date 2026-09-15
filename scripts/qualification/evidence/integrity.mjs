import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  QUALIFICATION_CONTRACT,
  QUALIFICATION_REPOSITORY,
  QUALIFICATION_SCHEMA_VERSION,
  SHA256_PATTERN,
  SECRET_PATTERN,
  STEAM_LIKE_ID_PATTERN,
  QualificationEvidenceError,
} from './contract.mjs';

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', `${name} must be a non-empty string`);
  }
  return value;
}

export async function readJson(path, code = 'INVALID_EVIDENCE') {
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

export async function readOptionalJson(path) {
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

export function assertUtc(value, name) {
  requireString(value, name);
  if (!Number.isFinite(Date.parse(value))) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', `${name} must be a valid timestamp`);
  }
}

export function validateArtifact(artifact) {
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

function scanForSecrets(value, path) {
  if (typeof value !== 'string') return;
  if (STEAM_LIKE_ID_PATTERN.test(value)) {
    throw new QualificationEvidenceError('SECRET_LEAK', `${path} contains a Steam-like identity`);
  }
  if (SECRET_PATTERN.test(path) && value.length > 0) {
    throw new QualificationEvidenceError('SECRET_LEAK', `${path} contains a secret-bearing value`);
  }
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

export async function walkFiles(root) {
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

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
