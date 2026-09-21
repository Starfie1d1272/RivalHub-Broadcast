import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  QUALIFICATION_CHECK_KEYS,
  QUALIFICATION_CONTRACT,
  QUALIFICATION_FRESHNESS_VALUES,
  QUALIFICATION_LIVE_MARKER_KINDS,
  QUALIFICATION_MARKER_KINDS,
  QUALIFICATION_MARKER_PHASES,
  QUALIFICATION_OBJECTIVE_SCENARIO_MARKER_KINDS,
  QUALIFICATION_RESET_DISPOSITIONS,
  QUALIFICATION_RESET_EVIDENCE_FIELDS,
  QUALIFICATION_RESULT_VALUES,
  QUALIFICATION_REPOSITORY,
  QUALIFICATION_SCHEMA_VERSION,
  QualificationEvidenceError,
} from './evidence/contract.mjs';
export { iterateCaptureFrames, verifyCaptureDirectory } from './evidence/capture.mjs';
export {
  analyzeObjectiveTimingCapture,
  aggregateObjectiveScenarioCoverage,
  renderObjectiveTimingReport,
} from './evidence/objective-timing.mjs';
export { checksFrom, resultFromChecks } from './evidence/checks.mjs';
export {
  readJson,
  readOptionalJson,
  scanJsonForSecrets,
  sha256File,
  sha256Text,
  validateArtifact,
  verifyHashes,
  walkFiles,
} from './evidence/integrity.mjs';
export {
  readQualificationEvidence,
  writeQualificationEvidence,
} from './evidence/qualification.mjs';
export {
  hasOrderedMarkers,
  liveObservationReferences,
  markerIndex,
  readScenario,
  validateMarker,
  validateObservation,
} from './evidence/scenario.mjs';

import { QualificationEvidenceError } from './evidence/contract.mjs';
import { readJson, verifyHashes } from './evidence/integrity.mjs';
import {
  readQualificationEvidence,
  writeQualificationEvidence,
} from './evidence/qualification.mjs';

async function qualificationCli(argv) {
  const mode = argv[0];
  if (mode === '--verify') {
    const runDir = argv[1];
    if (runDir === undefined || argv.length !== 2)
      throw new Error('用法：verify-evidence.mjs --verify <evidence-dir>');
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
        '用法：verify-evidence.mjs --finish <evidence-dir> [--archive-sha256 <sha256>]',
      );
    let archiveSha256;
    if (argv.length === 4 && argv[2] === '--archive-sha256') archiveSha256 = argv[3];
    else if (argv.length !== 2)
      throw new Error(
        '用法：verify-evidence.mjs --finish <evidence-dir> [--archive-sha256 <sha256>]',
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
  throw new Error('用法：verify-evidence.mjs --finish <evidence-dir> | --verify <evidence-dir>');
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
