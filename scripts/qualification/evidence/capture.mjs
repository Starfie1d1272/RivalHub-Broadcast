import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { TextDecoder } from 'node:util';

import { SHA256_PATTERN, QualificationEvidenceError } from './contract.mjs';
import {
  assertUtc,
  isRecord,
  isSafeNonNegativeInteger,
  readJson,
  requireString,
} from './integrity.mjs';

function validateCaptureManifest(manifest, captureDir) {
  if (!isRecord(manifest) || manifest.formatVersion !== 1) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      `${captureDir}/manifest.json 必须声明格式版本 1`,
    );
  }
  requireString(manifest.captureId, 'manifest.captureId');
  assertUtc(manifest.createdAt, 'manifest.createdAt');
  requireString(manifest.platform, 'manifest.platform');
  requireString(manifest.broadcastCommit, 'manifest.broadcastCommit');
  requireString(manifest.scenario, 'manifest.scenario');
  if (!isRecord(manifest.gsiConfig)) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      'manifest 中的 GSI 配置必须是对象',
    );
  }
  if (
    !isSafeNonNegativeInteger(manifest.frameCount) ||
    !isSafeNonNegativeInteger(manifest.droppedFrames)
  ) {
    throw new QualificationEvidenceError('INVALID_CAPTURE_SCHEMA', 'manifest 中的数据帧数量无效');
  }
  if (typeof manifest.complete !== 'boolean') {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_SCHEMA',
      'manifest 的完整性标记必须是布尔值',
    );
  }
  if (manifest.framesSha256 !== undefined && !SHA256_PATTERN.test(manifest.framesSha256)) {
    throw new QualificationEvidenceError('INVALID_CAPTURE_SCHEMA', 'manifest 的数据帧摘要无效');
  }
  return manifest;
}

function parseCaptureFrame(line, lineNumber, captureDir) {
  if (line.length === 0) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_FRAME',
      `${captureDir}/frames.jsonl 第 ${lineNumber} 行为空`,
    );
  }
  let frame;
  try {
    frame = JSON.parse(line);
  } catch (error) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_FRAME',
      `${captureDir}/frames.jsonl 第 ${lineNumber} 行不是有效 JSON`,
      error,
    );
  }
  if (
    !isRecord(frame) ||
    frame.version !== 1 ||
    !isSafeNonNegativeInteger(frame.sequence) ||
    !isSafeNonNegativeInteger(frame.elapsedUs) ||
    typeof frame.payload !== 'object' ||
    frame.payload === null ||
    Array.isArray(frame.payload)
  ) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE_FRAME',
      `${captureDir}/frames.jsonl 第 ${lineNumber} 行的采集记录结构无效`,
    );
  }
  assertUtc(frame.receivedAt, `frame ${lineNumber}.receivedAt`);
  return frame;
}

async function* streamLines(path, hash) {
  let stream;
  try {
    stream = createReadStream(path);
  } catch (error) {
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE',
      `无法打开 ${path}：${String(error)}`,
      error,
    );
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let lineNumber = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        let line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lineNumber += 1;
        yield { line, lineNumber };
        newline = pending.indexOf('\n');
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) {
      lineNumber += 1;
      yield { line: pending, lineNumber };
    }
  } catch (error) {
    if (error instanceof QualificationEvidenceError) throw error;
    throw new QualificationEvidenceError(
      'INVALID_CAPTURE',
      `无法读取 ${path}：${String(error)}`,
      error,
    );
  }
}

export function observationKey(observation) {
  return `${observation.sequence}\0${observation.receivedAt}`;
}

export async function* iterateCaptureFrames(captureDir) {
  const framesPath = join(captureDir, 'frames.jsonl');
  for await (const record of streamLines(framesPath, createHash('sha256'))) {
    yield parseCaptureFrame(record.line, record.lineNumber, captureDir);
  }
}

export async function verifyCaptureDirectory(captureDir, observationReferences = []) {
  if (basename(captureDir).endsWith('.partial')) {
    throw new QualificationEvidenceError('UNFINALIZED_CAPTURE', `${captureDir} 尚未发布`);
  }
  const manifest = validateCaptureManifest(
    await readJson(join(captureDir, 'manifest.json'), 'INVALID_CAPTURE_SCHEMA'),
    captureDir,
  );
  const framesPath = join(captureDir, 'frames.jsonl');
  try {
    await access(framesPath);
  } catch (error) {
    throw new QualificationEvidenceError('INVALID_CAPTURE', `无法访问 ${framesPath}`, error);
  }
  const hash = createHash('sha256');
  let count = 0;
  let previousSequence;
  let previousElapsedUs;
  const referenceKeys = new Set(
    observationReferences.map((observation) => observationKey(observation)),
  );
  const matchedObservationKeys = new Set();
  for await (const record of streamLines(framesPath, hash)) {
    const frame = parseCaptureFrame(record.line, record.lineNumber, captureDir);
    if (previousSequence !== undefined && frame.sequence <= previousSequence) {
      throw new QualificationEvidenceError(
        'INVALID_CAPTURE_FRAME',
        `${framesPath} 的数据帧序号未递增`,
      );
    }
    if (previousElapsedUs !== undefined && frame.elapsedUs < previousElapsedUs) {
      throw new QualificationEvidenceError(
        'INVALID_CAPTURE_FRAME',
        `${framesPath} 的采集时间未单调递增`,
      );
    }
    previousSequence = frame.sequence;
    previousElapsedUs = frame.elapsedUs;
    const key = observationKey(frame);
    if (referenceKeys.has(key)) matchedObservationKeys.add(key);
    count += 1;
  }
  if (count !== manifest.frameCount) {
    throw new QualificationEvidenceError(
      'FRAME_COUNT_MISMATCH',
      `${framesPath} 包含 ${count} 个数据帧，但 manifest 声明为 ${manifest.frameCount} 个`,
    );
  }
  const computedFramesSha256 = hash.digest('hex');
  if (manifest.framesSha256 !== undefined && manifest.framesSha256 !== computedFramesSha256) {
    throw new QualificationEvidenceError(
      'FRAMES_HASH_MISMATCH',
      `${framesPath} 的完整性摘要 ${computedFramesSha256} 与 manifest 中的 ${manifest.framesSha256} 不一致`,
    );
  }
  return {
    directory: captureDir,
    manifest,
    computedFramesSha256,
    frameCount: count,
    matchedObservationKeys: [...matchedObservationKeys].sort(),
  };
}
