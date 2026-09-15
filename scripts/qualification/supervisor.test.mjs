import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readQualificationEvidence } from './evidence.mjs';
import {
  finalizeQualificationRun,
  markCleanupFailure,
  shouldCleanupQualificationState,
} from './supervisor.mjs';

const BASE_TIME = '2026-09-15T00:00:00.000Z';

function artifact() {
  return {
    schemaVersion: 1,
    repository: 'Starfie1d1272/RivalHub-Broadcast',
    gitSha: '293f97a000000000000000000000000000000000',
    buildTimestamp: BASE_TIME,
    platform: 'win32-x64',
    nodeVersion: 'v24.21.0',
    qualificationSchemaVersion: 1,
    artifactSha256: 'a'.repeat(64),
  };
}

describe('qualification supervisor finalization', () => {
  it('finishes and verifies evidence without stop.ps1', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'rivalhub-qualification-supervisor-'));
    const logDir = await mkdtemp(join(tmpdir(), 'rivalhub-qualification-supervisor-log-'));
    const logPath = join(logDir, 'supervisor.log');
    try {
      await mkdir(join(runDir, 'debug'), { recursive: true });
      await mkdir(join(runDir, 'recorder'), { recursive: true });
      await mkdir(join(runDir, 'logs'), { recursive: true });
      await writeFile(join(runDir, 'scenario.jsonl'), '', 'utf8');
      await writeFile(join(runDir, 'artifact.json'), `${JSON.stringify(artifact())}\n`, 'utf8');
      await writeFile(
        join(runDir, 'environment.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          runId: 'supervisor-test-run',
          windowsVersion: 'Windows 11 test',
          cs2Version: 'CS2 test',
        })}\n`,
        'utf8',
      );
      await writeFile(
        join(runDir, 'debug', 'final-runtime.json'),
        '{"freshness":"fresh"}\n',
        'utf8',
      );

      const result = await finalizeQualificationRun({
        nodePath: process.execPath,
        evidenceScript: join(process.cwd(), 'scripts/qualification/evidence.mjs'),
        runDir,
        bundleRoot: process.cwd(),
        logPath,
      });

      expect(result).toMatchObject({ result: 'INCONCLUSIVE', verification: 'passed' });
      await expect(readQualificationEvidence(runDir)).resolves.toMatchObject({
        qualification: { result: 'INCONCLUSIVE' },
      });
      await expect(readFile(join(runDir, 'REPORT.md'), 'utf8')).resolves.toContain(
        '# RivalHub Broadcast Qualification 验收报告',
      );
      await expect(readFile(join(runDir, 'REPORT.md'), 'utf8')).resolves.toContain('INCONCLUSIVE');
      await expect(readFile(join(runDir, 'hashes.txt'), 'utf8')).resolves.toContain('REPORT.md');
    } finally {
      await rm(runDir, { recursive: true, force: true });
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it('keeps cleanup failure separate from the verified qualification result', () => {
    const completion = {
      result: 'PASS',
      verification: 'passed',
      cleanup: 'pending',
      reportPath: 'evidence/run/REPORT.md',
      qualificationPath: 'evidence/run/qualification.json',
    };

    expect(markCleanupFailure(completion)).toMatchObject({
      result: 'PASS',
      verification: 'passed',
      cleanup: 'failed',
    });
    expect(shouldCleanupQualificationState({ ...completion, cleanup: 'failed' })).toBe(false);
    expect(shouldCleanupQualificationState({ ...completion, cleanup: 'passed' })).toBe(true);
    expect(
      shouldCleanupQualificationState({ ...completion, verification: 'failed', cleanup: 'passed' }),
    ).toBe(false);
  });
});
