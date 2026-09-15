import { basename } from 'node:path';

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
    '# RivalHub Broadcast Qualification 验收报告',
    '',
    `- 结果：**${qualification.result}**`,
    `- Run ID：\`${qualification.runId}\``,
    `- Git SHA：\`${artifact.gitSha}\``,
    `- Node runtime：\`${artifact.nodeVersion}\``,
    '',
    '## 验收检查',
    '',
  ];
  for (const check of Object.values(checks))
    lines.push(`- ${check.label}：**${check.status}** — ${check.reason}`);
  lines.push(
    '',
    '## Capture 记录',
    '',
    `- 已发布 capture：${captureResults.length}`,
    `- Capture 错误：${captureErrors.length}`,
  );
  for (const capture of captureResults)
    lines.push(
      `- \`${basename(capture.directory)}\`：${capture.frameCount} 个 frame，${capture.computedFramesSha256}`,
    );
  lines.push('', '## 场景 marker', '');
  if (scenario.markers.length === 0) lines.push('- 未记录 marker。');
  else
    for (const marker of scenario.markers)
      lines.push(
        `- ${marker.wallClockAt} — ${marker.kind}${marker.phase === undefined ? '' : ` (${marker.phase})`}`,
      );
  lines.push(
    '',
    '## 最终 runtime',
    '',
    finalRuntime === undefined
      ? '- final-runtime.json 不可用'
      : `- 数据新鲜度：**${finalRuntime.freshness ?? 'unknown'}**`,
    '',
    '本报告不包含 raw GSI token 或账户身份信息。',
  );
  return `${lines.join('\n')}\n`;
}
