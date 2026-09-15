import { readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  QUALIFICATION_CHECK_KEYS,
  QUALIFICATION_RESULT_VALUES,
  QUALIFICATION_SCHEMA_VERSION,
  SHA256_PATTERN,
  QualificationEvidenceError,
} from './contract.mjs';
import { verifyCaptureDirectory } from './capture.mjs';
import { checksFrom, resultFromChecks } from './checks.mjs';
import {
  isRecord,
  readJson,
  readOptionalJson,
  requireString,
  scanJsonForSecrets,
  sha256File,
  sha256Text,
  validateArtifact,
  verifyHashes,
  walkFiles,
} from './integrity.mjs';
import { liveObservationReferences, readScenario } from './scenario.mjs';
import { renderReport } from './report.mjs';

async function immediateDirectories(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function readCaptureResults(runDir, markers) {
  const recorderDir = join(runDir, 'recorder');
  const recorderEntries = await immediateDirectories(recorderDir);
  const captureResults = [];
  const captureErrors = [];
  const observationReferences = liveObservationReferences(markers);
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
  return { captureResults, captureErrors };
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
    QUALIFICATION_CHECK_KEYS.some((key) => {
      const check = qualification.checks[key];
      return !isRecord(check) && typeof check !== 'string';
    })
  ) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'qualification checks are incomplete');
  }
  for (const key of QUALIFICATION_CHECK_KEYS) {
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
  const { captureResults, captureErrors } = await readCaptureResults(
    resolvedRunDir,
    scenario.markers,
  );
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
  for (const key of QUALIFICATION_CHECK_KEYS) {
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
  const { captureResults, captureErrors } = await readCaptureResults(
    resolvedRunDir,
    scenario.markers,
  );
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
