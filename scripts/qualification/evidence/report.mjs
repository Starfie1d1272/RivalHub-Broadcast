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
    '# RivalHub Broadcast Qualification Report',
    '',
    `- Result: **${qualification.result}**`,
    `- Run ID: \`${qualification.runId}\``,
    `- Git SHA: \`${artifact.gitSha}\``,
    `- Node runtime: \`${artifact.nodeVersion}\``,
    '',
    '## Checks',
    '',
  ];
  for (const check of Object.values(checks))
    lines.push(`- ${check.label}: **${check.status}** — ${check.reason}`);
  lines.push(
    '',
    '## Capture',
    '',
    `- Published captures: ${captureResults.length}`,
    `- Capture errors: ${captureErrors.length}`,
  );
  for (const capture of captureResults)
    lines.push(
      `- \`${basename(capture.directory)}\`: ${capture.frameCount} frames, ${capture.computedFramesSha256}`,
    );
  lines.push('', '## Scenario markers', '');
  if (scenario.markers.length === 0) lines.push('- No markers recorded.');
  else
    for (const marker of scenario.markers)
      lines.push(
        `- ${marker.wallClockAt} — ${marker.kind}${marker.phase === undefined ? '' : ` (${marker.phase})`}`,
      );
  lines.push(
    '',
    '## Final runtime',
    '',
    finalRuntime === undefined
      ? '- final-runtime.json unavailable'
      : `- Freshness: **${finalRuntime.freshness ?? 'unknown'}**`,
    '',
    'This report contains no raw GSI token or account identity.',
  );
  return `${lines.join('\n')}\n`;
}
