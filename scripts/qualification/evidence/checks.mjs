import {
  QUALIFICATION_CHECK_KEYS,
  RELEASE_CHECK_KEYS,
  QualificationEvidenceError,
} from './contract.mjs';
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

export function checksFrom({
  markers,
  finalRuntime,
  captureResults,
  captureErrors,
  artifact,
  qualificationProfile = 'base',
  hostCheckpoints = [],
}) {
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
      label: '第一场数据进入制播数据链路',
      status: productionChainPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: productionChainPassed
        ? '第一场场景标记已绑定显式重置前同一地图执行中的已接收采集数据帧。'
        : '缺少与第一场场景标记对应、属于同一地图执行且序列和时间戳一致的采集数据帧。',
    },
    realSilenceToStale: {
      label: '停止输入后进入数据已过期状态',
      status: stopPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: stopPassed
        ? '本地制播服务未重启即观察到数据已过期，并在下一场显式重置前记录了“已确认 CS2 退出”。'
        : '等待第一场数据后运行状态进入数据已过期，并在下一场显式重置前确认“已确认 CS2 退出”。',
    },
    explicitNextExecution: {
      label: '下一场从显式新地图执行开始',
      status: resetPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: resetPassed
        ? '地图执行编号已推进、数据来源编号保持一致，且上一场正式节目数据已清理。'
        : '缺少成功的显式“开始下一场”重置证据。',
    },
    demoBRecovery: {
      label: '第二场恢复且无上一场残留',
      status: demoBRecoveryPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: demoBRecoveryPassed
        ? '第二场场景标记已绑定显式重置后新地图执行中的已接收数据帧，并恢复为数据正常。'
        : '等待 CS2 重开、显式重置后的新地图执行数据帧，以及最终运行状态恢复正常。',
    },
    captureIntegrity: {
      label: '采集记录完整性',
      status: captureFailed ? 'FAIL' : captureResults.length > 0 ? 'PASS' : 'INCONCLUSIVE',
      reason: captureFailed
        ? '采集记录不完整、存在丢失数据帧或完整性校验失败。'
        : captureResults.length > 0
          ? '采集记录的数据帧数量、完整性摘要和结构校验通过。'
          : '没有找到已完成的采集记录。',
    },
  };
  if (artifact === undefined) {
    checks.captureIntegrity.status = 'FAIL';
    checks.captureIntegrity.reason = '缺少验收包身份信息。';
  }

  if (qualificationProfile === 'release') {
    const getMaxEventSequence = (checkpoint) => {
      const events = checkpoint?.host?.recentEvents;
      if (!Array.isArray(events) || events.length === 0) return 0;
      return Math.max(0, ...events.map((e) => (typeof e?.sequence === 'number' ? e.sequence : 0)));
    };

    const hasOrderedDisconnectConnect = (events, host, channel, baselineSequence) => {
      if (!Array.isArray(events)) return false;
      const targetEvents = events.filter(
        (e) =>
          typeof e?.sequence === 'number' &&
          e.sequence > baselineSequence &&
          e.host === host &&
          e.channel === channel,
      );
      const discIndex = targetEvents.findIndex((e) => e.action === 'disconnected');
      if (discIndex === -1) return false;
      return targetEvents.slice(discIndex + 1).some((e) => e.action === 'connected');
    };

    const hasNoDisconnectWithCompleteWindow = (events, host, channel, baselineSequence) => {
      if (!Array.isArray(events) || events.length === 0) return false;
      const newEvents = events
        .filter((e) => typeof e?.sequence === 'number' && e.sequence > baselineSequence)
        .sort((left, right) => left.sequence - right.sequence);
      if (newEvents.length === 0) return true;
      let expectedSequence = baselineSequence + 1;
      for (const event of newEvents) {
        if (event.sequence !== expectedSequence) return false;
        expectedSequence++;
      }
      return !newEvents.some(
        (e) => e.host === host && e.channel === channel && e.action === 'disconnected',
      );
    };

    const browserBefore = hostCheckpoints.find(
      (c) => c.scenario === 'browser-reload' && c.phase === 'before',
    );
    const browserAfter = hostCheckpoints.find(
      (c) => c.scenario === 'browser-reload' && c.phase === 'after',
    );
    const browserPassed =
      browserBefore !== undefined &&
      browserAfter !== undefined &&
      browserBefore.host?.byHostChannel?.browser?.program >= 1 &&
      browserAfter.host?.byHostChannel?.browser?.program >= 1 &&
      browserBefore.runtime?.producerInstanceId === browserAfter.runtime?.producerInstanceId &&
      hasOrderedDisconnectConnect(
        browserAfter.host?.recentEvents,
        'browser',
        'program',
        getMaxEventSequence(browserBefore),
      ) &&
      browserAfter.runtime?.freshness === 'fresh' &&
      browserAfter.programVisible === true;

    const obsBefore = hostCheckpoints.find(
      (c) => c.scenario === 'obs-reload' && c.phase === 'before',
    );
    const obsAfter = hostCheckpoints.find(
      (c) => c.scenario === 'obs-reload' && c.phase === 'after',
    );
    const obsPassed =
      obsBefore !== undefined &&
      obsAfter !== undefined &&
      obsBefore.host?.byHostChannel?.obs?.program >= 1 &&
      obsAfter.host?.byHostChannel?.obs?.program >= 1 &&
      obsBefore.runtime?.producerInstanceId === obsAfter.runtime?.producerInstanceId &&
      hasOrderedDisconnectConnect(
        obsAfter.host?.recentEvents,
        'obs',
        'program',
        getMaxEventSequence(obsBefore),
      ) &&
      obsAfter.runtime?.freshness === 'fresh' &&
      obsAfter.programVisible === true;

    const sceneBefore = hostCheckpoints.find(
      (c) => c.scenario === 'scene-visibility' && c.phase === 'before',
    );
    const sceneAfter = hostCheckpoints.find(
      (c) => c.scenario === 'scene-visibility' && c.phase === 'after',
    );
    const scenePassed =
      sceneBefore !== undefined &&
      sceneAfter !== undefined &&
      sceneBefore.host?.byHostChannel?.obs?.program >= 1 &&
      sceneAfter.host?.byHostChannel?.obs?.program >= 1 &&
      sceneBefore.runtime?.producerInstanceId === sceneAfter.runtime?.producerInstanceId &&
      hasNoDisconnectWithCompleteWindow(
        sceneAfter.host?.recentEvents,
        'obs',
        'program',
        getMaxEventSequence(sceneBefore),
      ) &&
      sceneAfter.runtime?.freshness === 'fresh' &&
      sceneAfter.programVisible === true;

    const restartBefore = hostCheckpoints.find(
      (c) => c.scenario === 'companion-restart' && c.phase === 'before',
    );
    const restartAfter = hostCheckpoints.find(
      (c) => c.scenario === 'companion-restart' && c.phase === 'after',
    );
    const restartPassed =
      restartBefore !== undefined &&
      restartAfter !== undefined &&
      restartBefore.host?.byHostChannel?.obs?.program >= 1 &&
      restartAfter.host?.byHostChannel?.obs?.program >= 1 &&
      restartAfter.runtime?.producerInstanceId !== restartBefore.runtime?.producerInstanceId &&
      restartAfter.runtime?.freshness === 'fresh' &&
      restartAfter.programVisible === true;

    checks.browserReload = {
      label: '普通浏览器重载',
      status: browserPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: browserPassed
        ? '普通浏览器已成功重载且画面恢复。'
        : '等待完成普通浏览器重载前/后检查点与目视确认。',
    };
    checks.obsReload = {
      label: 'OBS Browser Source 重载',
      status: obsPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: obsPassed
        ? 'OBS Browser Source 已成功重载且画面恢复。'
        : '等待完成 OBS Browser Source 重载前/后检查点与目视确认。',
    };
    checks.sceneVisibility = {
      label: 'OBS 场景可见性切换',
      status: scenePassed ? 'PASS' : 'INCONCLUSIVE',
      reason: scenePassed
        ? 'OBS 场景可见性切换完成且连接未中断。'
        : '等待完成 OBS 场景切换前/后检查点与目视确认。',
    };
    checks.companionRestart = {
      label: '制播服务受控重启',
      status: restartPassed ? 'PASS' : 'INCONCLUSIVE',
      reason: restartPassed
        ? '制播服务已成功受控重启，OBS 源自动重连且画面恢复。'
        : '等待完成服务重启前/后检查点与目视确认。',
    };
  }

  const expectedKeys =
    qualificationProfile === 'release'
      ? [...QUALIFICATION_CHECK_KEYS, ...RELEASE_CHECK_KEYS]
      : QUALIFICATION_CHECK_KEYS;

  if (
    Object.keys(checks).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(checks, key))
  ) {
    throw new QualificationEvidenceError('INVALID_EVIDENCE', '现场验收检查与证据契约不一致');
  }
  return checks;
}

export function resultFromChecks(checks) {
  const values = Object.values(checks);
  if (values.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (values.some((check) => check.status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}
