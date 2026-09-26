import { readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  QUALIFICATION_CHECK_KEYS,
  QUALIFICATION_PROFILES,
  QUALIFICATION_RESULT_VALUES,
  QUALIFICATION_SCHEMA_VERSION,
  RELEASE_CHECK_KEYS,
  SHA256_PATTERN,
  QualificationEvidenceError,
} from './contract.mjs';
import { readHostCheckpoints } from './host-checkpoints.mjs';
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
import { captureObservationReferences, readScenario } from './scenario.mjs';
import {
  aggregateObjectiveScenarioCoverage,
  analyzeObjectiveTimingCapture,
  evaluateObjectiveTimingRun,
} from './objective-timing.mjs';
import { renderReport } from './report.mjs';

export const QUALIFICATION_PROFILE_VALUES = QUALIFICATION_PROFILES;

function qualificationProfile(value, name) {
  const profile = value === undefined ? 'base' : requireString(value, name);
  if (!QUALIFICATION_PROFILE_VALUES.has(profile)) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', `${name} 无效`);
  }
  return profile;
}

function resultForProfile(profile, checks, objectiveTiming) {
  if (profile !== 'objective-timing') return resultFromChecks(checks);
  const foundationResult = objectiveTiming?.qualification?.foundation?.result;
  return QUALIFICATION_RESULT_VALUES.has(foundationResult) ? foundationResult : 'INCONCLUSIVE';
}

function serializedEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function immediateDirectories(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function readCaptureResults(runDir, markers, qualificationContext) {
  const recorderDir = join(runDir, 'recorder');
  const recorderEntries = await immediateDirectories(recorderDir);
  const captureResults = [];
  const captureErrors = [];
  const observationReferences = captureObservationReferences(markers);
  for (const captureDir of recorderEntries) {
    if (basename(captureDir).endsWith('.partial')) {
      captureErrors.push(
        new QualificationEvidenceError('UNFINALIZED_CAPTURE', `${captureDir} 尚未发布`),
      );
      continue;
    }
    try {
      const capture = await verifyCaptureDirectory(captureDir, observationReferences);
      captureResults.push({
        ...capture,
        objectiveTiming: await analyzeObjectiveTimingCapture(captureDir, {
          qualificationContext,
          scenarioMarkers: markers.filter((marker) => marker.kind.startsWith('objective-')),
        }),
      });
    } catch (error) {
      captureErrors.push(error);
    }
  }
  return {
    captureResults,
    captureErrors,
    objectiveTimingCoverage: aggregateObjectiveScenarioCoverage(captureResults, markers),
    objectiveTiming: evaluateObjectiveTimingRun(captureResults, markers, { captureErrors }),
  };
}

export async function readQualificationEvidence(runDir) {
  const resolvedRunDir = resolve(runDir);
  const qualification = await readJson(join(resolvedRunDir, 'qualification.json'));
  if (!isRecord(qualification) || qualification.schemaVersion !== QUALIFICATION_SCHEMA_VERSION) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'qualification.json 的格式版本不受支持',
    );
  }
  const profile = qualificationProfile(qualification.profile, 'qualification.profile');
  const runId = requireString(qualification.runId, 'qualification.runId');
  if (!isRecord(qualification.artifact))
    throw new QualificationEvidenceError('INVALID_EVIDENCE', '缺少验收包身份信息');
  requireString(qualification.artifact.gitSha, 'qualification.artifact.gitSha');
  if (!SHA256_PATTERN.test(qualification.artifact.artifactSha256)) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', '验收包身份摘要无效');
  }
  if (!QUALIFICATION_RESULT_VALUES.has(qualification.result)) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', '现场验收结果无效');
  }
  const expectedCheckKeys =
    profile === 'release'
      ? [...QUALIFICATION_CHECK_KEYS, ...RELEASE_CHECK_KEYS]
      : QUALIFICATION_CHECK_KEYS;
  if (
    !isRecord(qualification.checks) ||
    expectedCheckKeys.some((key) => {
      const check = qualification.checks[key];
      return !isRecord(check) && typeof check !== 'string';
    })
  ) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', '现场验收检查不完整');
  }
  for (const key of expectedCheckKeys) {
    const check = qualification.checks[key];
    const status = typeof check === 'string' ? check : check.status;
    if (!QUALIFICATION_RESULT_VALUES.has(status)) {
      throw new QualificationEvidenceError('INVALID_EVIDENCE', `现场验收检查 ${key} 无效`);
    }
  }
  const artifact = validateArtifact(await readJson(join(resolvedRunDir, 'artifact.json')));
  if (artifact.gitSha !== qualification.artifact.gitSha) {
    throw new QualificationEvidenceError(
      'ARTIFACT_MISMATCH',
      '现场验收结果与验收包身份信息的 SHA 不一致',
    );
  }
  const scenario = await readScenario(resolvedRunDir);
  if (scenario.runId !== undefined && scenario.runId !== runId) {
    throw new QualificationEvidenceError(
      'SCENARIO_MISMATCH',
      '场景记录的验收轮次编号与现场验收结果的编号不一致',
    );
  }
  const hostCheckpoints = await readHostCheckpoints(resolvedRunDir, runId, artifact);
  scanJsonForSecrets(qualification, '$.qualification');
  scanJsonForSecrets(artifact, '$.artifact');
  scenario.markers.forEach((marker, index) => scanJsonForSecrets(marker, `$.scenario[${index}]`));
  hostCheckpoints.checkpoints.forEach((cp, index) =>
    scanJsonForSecrets(cp, `$.hostCheckpoints[${index}]`),
  );
  const environment = await readJson(join(resolvedRunDir, 'environment.json'));
  if (!isRecord(environment))
    throw new QualificationEvidenceError('INVALID_EVIDENCE', 'environment.json 必须是对象');
  requireString(environment.runId, 'environment.runId');
  requireString(environment.windowsVersion, 'environment.windowsVersion');
  requireString(environment.cs2Version, 'environment.cs2Version');
  const environmentProfile = qualificationProfile(
    environment.qualificationProfile,
    'environment.qualificationProfile',
  );
  if (environmentProfile !== profile) {
    throw new QualificationEvidenceError(
      'EVIDENCE_MISMATCH',
      'environment.json 的现场验收类型与 qualification.json 不一致',
    );
  }
  if (environment.runId !== runId) {
    throw new QualificationEvidenceError(
      'EVIDENCE_MISMATCH',
      '环境记录的验收轮次编号与现场验收结果的编号不一致',
    );
  }
  const finalRuntime = await readOptionalJson(join(resolvedRunDir, 'debug', 'final-runtime.json'));
  scanJsonForSecrets(environment, '$.environment');
  if (finalRuntime !== undefined) scanJsonForSecrets(finalRuntime, '$.finalRuntime');
  const { captureResults, captureErrors, objectiveTimingCoverage, objectiveTiming } =
    await readCaptureResults(resolvedRunDir, scenario.markers, {
      runId,
      artifactGitSha: qualification.artifact.gitSha,
      artifactSha256: qualification.artifact.artifactSha256,
      windowsVersion: environment.windowsVersion,
      cs2Version: environment.cs2Version,
    });
  const result = {
    runDir: resolvedRunDir,
    qualification,
    artifact,
    environment,
    scenario,
    finalRuntime,
    captureResults,
    captureErrors,
    objectiveTimingCoverage,
    objectiveTiming,
    qualificationProfile: profile,
    hostCheckpoints: hostCheckpoints.checkpoints,
    checks: checksFrom({
      markers: scenario.markers,
      finalRuntime,
      captureResults,
      captureErrors,
      artifact,
      qualificationProfile: profile,
      hostCheckpoints: hostCheckpoints.checkpoints,
    }),
  };
  for (const key of expectedCheckKeys) {
    const stored =
      typeof qualification.checks[key] === 'string'
        ? qualification.checks[key]
        : qualification.checks[key].status;
    if (stored !== result.checks[key].status) {
      throw new QualificationEvidenceError(
        'CHECK_MISMATCH',
        `现场验收检查 ${key} 与重新计算的证据不一致`,
      );
    }
  }
  if (
    qualification.objectiveTiming !== undefined &&
    !serializedEqual(qualification.objectiveTiming, objectiveTiming.qualification)
  ) {
    throw new QualificationEvidenceError(
      'CHECK_MISMATCH',
      'qualification.json 中的目标时钟判定与重新计算的证据不一致',
    );
  }
  if (profile === 'objective-timing' && qualification.objectiveTiming === undefined) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      '目标时钟现场验收缺少 objectiveTiming 判定',
    );
  }
  if (qualification.result !== resultForProfile(profile, result.checks, objectiveTiming)) {
    throw new QualificationEvidenceError('CHECK_MISMATCH', '现场验收结果与重新计算的证据不一致');
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
  const hostCheckpoints = await readHostCheckpoints(
    resolvedRunDir,
    scenario.runId ?? environment.runId,
    artifact,
  );
  const finalRuntime = await readOptionalJson(join(resolvedRunDir, 'debug', 'final-runtime.json'));
  const { captureResults, captureErrors, objectiveTimingCoverage, objectiveTiming } =
    await readCaptureResults(resolvedRunDir, scenario.markers, {
      runId: scenario.runId ?? environment.runId ?? 'unknown',
      artifactGitSha: artifact.gitSha,
      artifactSha256: artifact.artifactSha256,
      windowsVersion: environment.windowsVersion,
      cs2Version: environment.cs2Version,
    });
  const profile = qualificationProfile(
    environment.qualificationProfile,
    'environment.qualificationProfile',
  );
  const checks = checksFrom({
    markers: scenario.markers,
    finalRuntime,
    captureResults,
    captureErrors,
    artifact,
    qualificationProfile: profile,
    hostCheckpoints: hostCheckpoints.checkpoints,
  });
  const result = resultForProfile(profile, checks, objectiveTiming);
  const artifactSha256 =
    archiveSha256 ?? artifact.artifactSha256 ?? sha256Text(JSON.stringify(artifact));
  if (!SHA256_PATTERN.test(artifactSha256)) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', '验收包摘要必须是小写 SHA-256 值');
  }
  const allObsVersions = new Set();
  for (const cp of hostCheckpoints.checkpoints) {
    if (Array.isArray(cp.host?.obsVersions)) {
      for (const v of cp.host.obsVersions) {
        if (typeof v === 'string' && v.trim()) allObsVersions.add(v.trim());
      }
    }
  }
  const aggregatedObsVersions = Array.from(allObsVersions).sort();
  const finishedAt = new Date().toISOString();

  const updatedEnvironment = {
    ...environment,
    finishedAt,
    ...(aggregatedObsVersions.length > 0 ? { obsVersions: aggregatedObsVersions } : {}),
  };
  await writeFile(
    join(resolvedRunDir, 'environment.json'),
    `${JSON.stringify(updatedEnvironment, null, 2)}\n`,
    'utf8',
  );

  const qualification = {
    schemaVersion: QUALIFICATION_SCHEMA_VERSION,
    runId:
      scenario.runId ??
      (typeof updatedEnvironment.runId === 'string' ? updatedEnvironment.runId : 'unknown'),
    artifact: {
      gitSha: artifact.gitSha,
      artifactSha256,
    },
    environment: {
      runId:
        typeof updatedEnvironment.runId === 'string'
          ? updatedEnvironment.runId
          : (scenario.runId ?? 'unknown'),
      windowsVersion:
        typeof updatedEnvironment.windowsVersion === 'string'
          ? updatedEnvironment.windowsVersion
          : 'unknown',
      cs2Version:
        typeof updatedEnvironment.cs2Version === 'string'
          ? updatedEnvironment.cs2Version
          : 'unknown',
      qualificationProfile: profile,
      finishedAt,
      ...(aggregatedObsVersions.length > 0 ? { obsVersions: aggregatedObsVersions } : {}),
    },
    profile,
    result,
    objectiveTiming: objectiveTiming.qualification,
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
    objectiveTimingCoverage,
    objectiveTiming,
    qualificationProfile: profile,
    checks,
    hostCheckpoints: hostCheckpoints.checkpoints,
  });
  await writeFile(join(resolvedRunDir, 'REPORT.md'), report, 'utf8');
  const files = await walkFiles(resolvedRunDir);
  const hashLines = [];
  for (const path of files) {
    const digest = await sha256File(path);
    hashLines.push(`${digest}  ${relative(resolvedRunDir, path).replaceAll('\\', '/')}`);
  }
  await writeFile(join(resolvedRunDir, 'hashes.txt'), `${hashLines.join('\n')}\n`, 'utf8');
  return {
    qualification,
    report,
    captureResults,
    captureErrors,
    objectiveTimingCoverage,
    objectiveTiming,
    checks,
  };
}
