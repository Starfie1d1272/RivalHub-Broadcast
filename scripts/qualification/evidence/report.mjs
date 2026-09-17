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
  for (const capture of captureResults)
    lines.push(
      `- \`${basename(capture.directory)}\`：${capture.frameCount} 帧，${capture.computedFramesSha256}`,
    );
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
      ? '- `final-runtime.json` 不可用'
      : `- Runtime freshness：**${freshnessLabel(finalRuntime.freshness)}**`,
    '',
    '本报告不包含原始 GSI Token 或账户身份信息。',
  );
  return `${lines.join('\n')}\n`;
}
