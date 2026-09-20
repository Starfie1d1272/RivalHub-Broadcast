import { basename } from 'node:path';

function resultLabel(result) {
  if (result === 'PASS') return '通过（PASS）';
  if (result === 'FAIL') return '失败（FAIL）';
  return '证据不足（INCONCLUSIVE）';
}

function freshnessLabel(value) {
  if (value === 'fresh') return '正常（fresh）';
  if (value === 'stale') return '已过期（stale）';
  if (value === 'awaiting') return '等待数据（awaiting）';
  return value ?? '未知';
}

function objectiveTimingLabel(value) {
  if (value === 'PASS') return '通过（PASS）';
  if (value === 'FAIL') return '失败（FAIL）';
  if (value === 'NOT_PROMISED') return '不承诺（NOT_PROMISED）';
  return '证据不足（INCONCLUSIVE）';
}

export function renderReport({
  qualification,
  artifact,
  scenario,
  finalRuntime,
  captureResults,
  captureErrors,
  checks,
}) {
  const lines = [
    '# RivalHub Broadcast 现场验收报告',
    '',
    `- 结果：**${resultLabel(qualification.result)}**`,
    `- 运行编号：\`${qualification.runId}\``,
    `- Git SHA：\`${artifact.gitSha}\``,
    `- Node 运行时：\`${artifact.nodeVersion}\``,
    '',
    '## 验收检查',
    '',
  ];
  for (const check of Object.values(checks))
    lines.push(`- ${check.label}：**${resultLabel(check.status)}** — ${check.reason}`);
  lines.push(
    '',
    '## 采集记录',
    '',
    `- 已验证采集：${captureResults.length}`,
    `- 采集错误：${captureErrors.length}`,
  );
  for (const capture of captureResults) {
    lines.push(
      `- \`${basename(capture.directory)}\`：${capture.frameCount} 帧，${capture.computedFramesSha256}`,
    );
    if (capture.objectiveTiming !== undefined) {
      const objective = capture.objectiveTiming;
      lines.push(
        `  - Objective Clock 0.1 s：**${objectiveTimingLabel(objective.qualification.numeric01s.result)}**；active interval p99 ${objective.metrics.activePacketIntervalMs.p99 === null ? 'n/a' : `${objective.metrics.activePacketIntervalMs.p99.toFixed(1)} ms`}；reconnect gaps ${objective.metrics.reconnectGaps.count}`,
        `  - Objective Clock 0.01 s：**${objectiveTimingLabel(objective.qualification.numeric001s.result)}**`,
      );
    }
  }
  lines.push('', '## 场景标记', '');
  if (scenario.markers.length === 0) lines.push('- 未记录场景标记。');
  else
    for (const marker of scenario.markers)
      lines.push(
        `- ${marker.wallClockAt} — ${marker.kind}${marker.phase === undefined ? '' : ` (${marker.phase})`}`,
      );
  lines.push(
    '',
    '## 最终运行状态',
    '',
    finalRuntime === undefined
      ? '- 最终运行状态文件（`final-runtime.json`）不可用'
      : `- 运行状态：**${freshnessLabel(finalRuntime.freshness)}**`,
    '',
    '本报告不包含原始 GSI Token 或账户身份信息。',
  );
  return `${lines.join('\n')}\n`;
}
