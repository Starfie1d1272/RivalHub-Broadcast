import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  HOST_CHECKPOINT_SCHEMA_VERSION,
  HOST_SCENARIOS,
  QUALIFICATION_FRESHNESS_VALUES,
  QualificationEvidenceError,
} from './contract.mjs';
import { assertUtc, isRecord, isSafeNonNegativeInteger, requireString } from './integrity.mjs';

export function validateHostCheckpoint(checkpoint, runId, lineNumber, expectedArtifact) {
  if (!isRecord(checkpoint) || checkpoint.schemaVersion !== HOST_CHECKPOINT_SCHEMA_VERSION) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的格式版本不受支持`,
    );
  }
  if (!HOST_SCENARIOS.has(checkpoint.scenario)) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的场景名 ${checkpoint.scenario} 无效`,
    );
  }
  if (checkpoint.phase !== 'before' && checkpoint.phase !== 'after') {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的阶段 ${checkpoint.phase} 无效`,
    );
  }
  if (
    !isRecord(checkpoint.timestamp) ||
    !Number.isFinite(checkpoint.timestamp.monotonicMs) ||
    typeof checkpoint.timestamp.utc !== 'string'
  ) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的时间戳无效`,
    );
  }
  assertUtc(checkpoint.timestamp.utc, `Host 检查点记录第 ${lineNumber} 行的时间戳`);

  if (!isRecord(checkpoint.identity)) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的身份信息无效`,
    );
  }
  if (runId !== undefined && checkpoint.identity.runId !== runId) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的验收轮次编号与期望不一致`,
    );
  }
  if (expectedArtifact) {
    if (expectedArtifact.gitSha && checkpoint.identity.gitSha !== expectedArtifact.gitSha) {
      throw new QualificationEvidenceError(
        'INVALID_HOST_CHECKPOINT',
        `Host 检查点记录第 ${lineNumber} 行的代码提交与本次 artifact.json 不一致`,
      );
    }
    if (
      expectedArtifact.artifactSha256 &&
      checkpoint.identity.artifactSha256 !== expectedArtifact.artifactSha256
    ) {
      throw new QualificationEvidenceError(
        'INVALID_HOST_CHECKPOINT',
        `Host 检查点记录第 ${lineNumber} 行的产物摘要与本次 artifact.json 不一致`,
      );
    }
  }

  if (!isRecord(checkpoint.runtime)) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的运行状态无效`,
    );
  }
  requireString(
    checkpoint.runtime.producerInstanceId,
    `Host 检查点记录第 ${lineNumber} 行的数据来源编号`,
  );
  if (!QUALIFICATION_FRESHNESS_VALUES.has(checkpoint.runtime.freshness)) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的数据新鲜度无效`,
    );
  }
  if (
    !isSafeNonNegativeInteger(checkpoint.runtime.mapEpoch) ||
    !isSafeNonNegativeInteger(checkpoint.runtime.sourceGeneration) ||
    !isSafeNonNegativeInteger(checkpoint.runtime.runtimeSeq)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的计数器无效`,
    );
  }

  if (
    !isRecord(checkpoint.host) ||
    !isRecord(checkpoint.host.active) ||
    !isRecord(checkpoint.host.byHostChannel)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的宿主诊断信息无效`,
    );
  }
  if (
    !isSafeNonNegativeInteger(checkpoint.host.active.obs) ||
    !isSafeNonNegativeInteger(checkpoint.host.active.browser) ||
    !isSafeNonNegativeInteger(checkpoint.host.active.unknown)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的连接计数无效`,
    );
  }

  if (checkpoint.programVisible !== undefined && typeof checkpoint.programVisible !== 'boolean') {
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `Host 检查点记录第 ${lineNumber} 行的目视确认字段类型无效`,
    );
  }

  return checkpoint;
}

export async function readHostCheckpoints(runDir, runId, expectedArtifact) {
  const filePath = join(runDir, 'host-checkpoints.jsonl');
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { path: filePath, checkpoints: [] };
    }
    throw new QualificationEvidenceError(
      'INVALID_HOST_CHECKPOINT',
      `无法读取 ${filePath}：${String(error)}`,
      error,
    );
  }
  const lines = content.trim().length === 0 ? [] : content.trim().split('\n');
  const checkpoints = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new QualificationEvidenceError(
        'INVALID_HOST_CHECKPOINT',
        `Host 检查点记录第 ${i + 1} 行不是有效 JSON：${String(error)}`,
        error,
      );
    }
    validateHostCheckpoint(parsed, runId, i + 1, expectedArtifact);
    checkpoints.push(parsed);
  }
  return { path: filePath, checkpoints };
}
