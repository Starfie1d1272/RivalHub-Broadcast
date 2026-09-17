import { QUALIFICATION_CHECK_KEYS, QualificationEvidenceError } from './contract.mjs';
import { observationKey } from './capture.mjs';
import { isRecord } from './integrity.mjs';
import { hasOrderedMarkers, markerIndex } from './scenario.mjs';

function markerResetPassed(markers) {
  const beforeIndex = markerIndex(markers, 'next-execution');
  if (beforeIndex === -1) return false;
  const before = markers
    .slice(beforeIndex)
    .find((marker) => marker.kind === 'next-execution' && marker.phase === 'before');
  const after = markers
    .slice(beforeIndex)
    .find((marker) => marker.kind === 'next-execution' && marker.phase === 'after');
  return (
    before !== undefined &&
    after !== undefined &&
    after.mapEpoch > before.mapEpoch &&
    after.sourceGeneration === before.sourceGeneration &&
    after.producerInstanceId === before.producerInstanceId &&
    after.reset?.disposition === 'accepted' &&
    after.reset.mapEpoch === after.mapEpoch &&
    after.reset.previousMapEpoch === before.mapEpoch &&
    after.reset.programTelemetryCleared === true
  );
}

function finalFresh(finalRuntime) {
  return isRecord(finalRuntime) && finalRuntime.freshness === 'fresh';
}

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function observedMapBoundaryPassed(finalRuntime, marker, resetAfter) {
  if (
    !isRecord(finalRuntime) ||
    !Array.isArray(finalRuntime.recentTransitions) ||
    marker === undefined ||
    marker.observation === null ||
    resetAfter === undefined
  )
    return false;
  const observation = marker.observation;
  return finalRuntime.recentTransitions.some((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.kind !== 'map_execution_changed' ||
      candidate.reason !== 'observed-map-name-change' ||
      !isRecord(candidate.at)
    )
      return false;
    const previousMapEpoch = candidate.previousMapEpoch;
    const mapEpoch = candidate.mapEpoch;
    const sourceGeneration = candidate.sourceGeneration;
    const receiveSequence = candidate.receiveSequence;
    const runtimeSeq = candidate.runtimeSeq;
    const atMonotonicMs = candidate.at.monotonicMs;
    const previousMapName = candidate.previousMapName;
    const mapName = candidate.mapName;
    return (
      isSafeNonNegativeInteger(previousMapEpoch) &&
      isSafeNonNegativeInteger(mapEpoch) &&
      mapEpoch > previousMapEpoch &&
      previousMapEpoch === resetAfter.mapEpoch &&
      mapEpoch === marker.mapEpoch &&
      candidate.producerInstanceId === marker.producerInstanceId &&
      sourceGeneration === marker.sourceGeneration &&
      isSafeNonNegativeInteger(receiveSequence) &&
      receiveSequence < observation.sequence &&
      isSafeNonNegativeInteger(runtimeSeq) &&
      runtimeSeq < marker.runtimeSeq &&
      typeof atMonotonicMs === 'number' &&
      Number.isFinite(atMonotonicMs) &&
      atMonotonicMs > resetAfter.monotonicMs &&
      atMonotonicMs < observation.receivedMonotonicMs &&
      typeof previousMapName === 'string' &&
      typeof mapName === 'string' &&
      previousMapName.trim().length > 0 &&
      mapName.trim().length > 0 &&
      previousMapName.trim() !== mapName.trim()
    );
  });
}

function realSilenceToStalePassed(markers) {
  const demoALive = markers.find((marker) => marker.kind === 'demo-a-live');
  const runtimeStale = markers.find((marker) => marker.kind === 'runtime-stale');
  const cs2Closed = markers.find((marker) => marker.kind === 'cs2-closed');
  const resetBefore = markers.find(
    (marker) => marker.kind === 'next-execution' && marker.phase === 'before',
  );
  if (demoALive === undefined || runtimeStale === undefined || cs2Closed === undefined)
    return false;
  if (
    runtimeStale.freshness !== 'stale' ||
    runtimeStale.monotonicMs <= demoALive.monotonicMs ||
    cs2Closed.monotonicMs <= demoALive.monotonicMs
  )
    return false;
  return (
    resetBefore === undefined ||
    (runtimeStale.monotonicMs < resetBefore.monotonicMs &&
      cs2Closed.monotonicMs < resetBefore.monotonicMs)
  );
}

function markerObservationWasCaptured(marker, captureResults) {
  if (marker === undefined || marker.observation === null) return false;
  const key = observationKey(marker.observation);
  return captureResults.some((capture) => capture.matchedObservationKeys?.includes(key));
}

function liveMarkerCausalityPassed(markers, kind, captureResults, finalRuntime, execution) {
  const markerIndexValue = markerIndex(markers, kind);
  if (markerIndexValue === -1) return false;
  const marker = markers[markerIndexValue];
  if (!markerObservationWasCaptured(marker, captureResults)) return false;
  const observation = marker.observation;
  if (observation === null) return false;

  const resetBeforeIndex = markers.findIndex(
    (candidate) => candidate.kind === 'next-execution' && candidate.phase === 'before',
  );
  const resetAfterIndex = markers.findIndex(
    (candidate) => candidate.kind === 'next-execution' && candidate.phase === 'after',
  );
  if (execution === 'first') {
    const resetBefore = resetBeforeIndex === -1 ? undefined : markers[resetBeforeIndex];
    return (
      resetBefore === undefined ||
      (markerIndexValue < resetBeforeIndex &&
        observation.receivedMonotonicMs < resetBefore.monotonicMs)
    );
  }
  const resetAfter = resetAfterIndex === -1 ? undefined : markers[resetAfterIndex];
  return (
    resetAfter !== undefined &&
    markerIndexValue > resetAfterIndex &&
    observation.receivedMonotonicMs > resetAfter.monotonicMs &&
    (marker.mapEpoch === resetAfter.mapEpoch ||
      observedMapBoundaryPassed(finalRuntime, marker, resetAfter))
  );
}

export function checksFrom({ markers, finalRuntime, captureResults, captureErrors, artifact }) {
  const resetPassed = markerResetPassed(markers);
  const stopPassed = realSilenceToStalePassed(markers);
  const reopenedBeforeB = hasOrderedMarkers(markers, [
    'next-execution',
    'cs2-reopened',
    'demo-b-live',
  ]);
  const captureFailed =
    captureErrors.length > 0 ||
    captureResults.some(
      (capture) => !capture.manifest.complete || capture.manifest.droppedFrames > 0,
    );
  const productionChainPassed = liveMarkerCausalityPassed(
    markers,
    'demo-a-live',
    captureResults,
    finalRuntime,
    'first',
  );
  const demoBRecoveryPassed =
    reopenedBeforeB &&
    resetPassed &&
    liveMarkerCausalityPassed(markers, 'demo-b-live', captureResults, finalRuntime, 'second') &&
    finalFresh(finalRuntime);
  const checks = {
    productionChain: {
      label: '第一场数据进入制播数据链路（production chain）',
      status: productionChainPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: productionChainPassed
        ? 'Demo A 场景标记已绑定显式重置（reset）前同一地图执行（map execution）的已接受 Capture V1 数据帧（accepted frame）。'
        : '缺少与 Demo A 场景标记对应、同一地图执行（map execution）和同一序列/时间戳（sequence/timestamp）的 Capture V1 数据帧。',
    },
    realSilenceToStale: {
      label: '停止输入后进入数据已过期状态（stale）',
      status: stopPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: stopPassed
        ? '本地制播服务未重启即观察到数据已过期状态（runtime-stale），并在下一场显式重置（reset）前记录了“已确认 CS2 退出”（cs2-closed）。'
        : '等待 Demo A 后运行状态进入数据已过期状态（stale），并在下一场显式重置（reset）前确认“已确认 CS2 退出”（cs2-closed）。',
    },
    explicitNextExecution: {
      label: '下一场从显式新地图执行（map execution）开始',
      status: resetPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: resetPassed
        ? 'mapEpoch 已推进、producerInstanceId 保持一致，且上一场 Program telemetry 已清理。'
        : '缺少成功的显式下一场重置（explicit next-execution reset）证据。',
    },
    demoBRecovery: {
      label: '第二场恢复且无上一场残留',
      status: demoBRecoveryPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: demoBRecoveryPassed
        ? 'Demo B 场景标记已绑定显式重置（reset）后新地图执行（map execution）的已接受数据帧（accepted frame），并恢复为数据正常（fresh）。'
        : '等待 CS2 重开、显式重置（reset）后新地图执行（map execution）的 Demo B 数据帧，以及最终运行状态恢复正常（fresh）。',
    },
    captureIntegrity: {
      label: 'Capture V1 完整性',
      status: captureFailed ? 'FAIL' : captureResults.length > 0 ? 'PASS' : 'INCONCLUSIVE',
      reason: captureFailed
        ? 'Capture V1 不完整、存在丢失数据帧（dropped frame）或完整性校验失败。'
        : captureResults.length > 0
          ? 'Capture V1 数据帧数量、hash 与 schema 校验通过。'
          : '没有找到已发布的 Capture V1。',
    },
  };
  if (artifact === undefined) {
    checks.captureIntegrity.status = 'FAIL';
    checks.captureIntegrity.reason = '缺少验收包身份信息（artifact identity）。';
  }
  if (
    Object.keys(checks).length !== QUALIFICATION_CHECK_KEYS.length ||
    QUALIFICATION_CHECK_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(checks, key))
  ) {
    throw new QualificationEvidenceError(
      'INVALID_EVIDENCE',
      'qualification check 实现与 evidence contract 不一致',
    );
  }
  return checks;
}

export function resultFromChecks(checks) {
  const values = Object.values(checks);
  if (values.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (values.some((check) => check.status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}
