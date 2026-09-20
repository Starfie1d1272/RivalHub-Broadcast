import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { iterateCaptureFrames, verifyCaptureDirectory } from './capture.mjs';

export const OBJECTIVE_CLOCK_LEASE_MS = 1_000;
export const OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS = 200;
export const OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS = 100;
export const OBJECTIVE_CLOCK_OFFSET_LIMIT_MS = 100;

const ACTIVE_BOMB_STATES = new Set(['planting', 'planted', 'defusing']);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value) {
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

function rawBomb(payload) {
  const root = record(payload);
  const bomb = record(root?.bomb);
  if (bomb === undefined) return { state: undefined, countdownSeconds: undefined };
  return {
    state: stringValue(bomb.state),
    countdownSeconds: finiteNumber(bomb.countdown ?? bomb.countdownSeconds),
  };
}

function rawPhaseCountdown(payload) {
  const root = record(payload);
  const phaseCountdowns = record(root?.phase_countdowns ?? root?.phaseCountdowns);
  if (phaseCountdowns === undefined) return { phase: undefined, endsInSeconds: undefined };
  return {
    phase: stringValue(phaseCountdowns.phase),
    endsInSeconds: finiteNumber(phaseCountdowns.phase_ends_in ?? phaseCountdowns.endsInSeconds),
  };
}

function isActiveState(state) {
  return state !== undefined && ACTIVE_BOMB_STATES.has(state);
}

function matchingPhase(state) {
  if (state === 'planted') return 'bomb';
  if (state === 'defusing') return 'defuse';
  return undefined;
}

function terminalKind(from, to) {
  if (from === 'planting' && to === 'planted') return 'plant';
  if (to === 'defused') return 'defuse';
  if (to === 'exploded') return 'explosion';
  return undefined;
}

function closeMissingSpan(spans, span, endMs) {
  if (span === undefined) return undefined;
  spans.push({
    state: span.state,
    startMs: span.startMs,
    endMs,
    durationMs: Math.max(0, endMs - span.startMs),
    frameCount: span.frameCount,
  });
  return undefined;
}

function stats(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
    };
  }
  const quantile = (probability) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
  };
}

function allowlistedGsiConfig(config) {
  const recordConfig = record(config) ?? {};
  const source = record(recordConfig.parameters) ?? recordConfig;
  return Object.fromEntries(
    ['timeout', 'precision_time', 'buffer', 'throttle', 'heartbeat']
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

function gateStatus(values) {
  return Object.values(values).every((value) => value === true)
    ? 'PASS'
    : Object.values(values).some((value) => value === false)
      ? 'FAIL'
      : 'INCONCLUSIVE';
}

export async function analyzeObjectiveTimingCapture(captureDir, options = {}) {
  const verified = await verifyCaptureDirectory(captureDir);
  const reconnectThresholdMs = options.reconnectThresholdMs ?? OBJECTIVE_CLOCK_LEASE_MS;
  const activePacketIntervalsMs = [];
  const countdownDeltaResidualMs = [];
  const stateTransitionToFirstCountMs = [];
  const phaseComparisonResidualMs = [];
  const terminalEvents = [];
  const missingCountdownSpans = [];
  const reconnectGaps = [];
  let frameCount = 0;
  let activeFrameCount = 0;
  let previousFrame;
  let lastActiveFrameMs;
  let previousCountedSample;
  let pendingCountTransition;
  let missingSpan;

  for await (const frame of iterateCaptureFrames(captureDir)) {
    frameCount += 1;
    const elapsedMs = frame.elapsedUs / 1_000;
    const bomb = rawBomb(frame.payload);
    const phaseCountdown = rawPhaseCountdown(frame.payload);
    const active = isActiveState(bomb.state);

    if (previousFrame !== undefined) {
      const packetIntervalMs = elapsedMs - previousFrame.elapsedMs;
      if (packetIntervalMs > reconnectThresholdMs) {
        reconnectGaps.push(packetIntervalMs);
      }
    }

    if (previousFrame?.state !== bomb.state) {
      missingSpan = closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
      previousCountedSample = undefined;
      pendingCountTransition = active
        ? { from: previousFrame?.state ?? null, to: bomb.state, atMs: elapsedMs }
        : undefined;

      const kind = terminalKind(previousFrame?.state, bomb.state);
      if (kind !== undefined && previousFrame !== undefined) {
        const elapsedSincePreviousMs = Math.max(0, elapsedMs - previousFrame.elapsedMs);
        const remainingAtTerminalMs =
          previousFrame.countdownSeconds === undefined
            ? null
            : Math.max(0, previousFrame.countdownSeconds * 1_000 - elapsedSincePreviousMs);
        terminalEvents.push({
          kind,
          from: previousFrame.state,
          to: bomb.state,
          atMs: elapsedMs,
          remainingAtTerminalMs,
        });
      }
    }

    if (active) {
      activeFrameCount += 1;
      if (lastActiveFrameMs !== undefined) {
        activePacketIntervalsMs.push(Math.max(0, elapsedMs - lastActiveFrameMs));
      }
      lastActiveFrameMs = elapsedMs;

      if (
        pendingCountTransition !== undefined &&
        pendingCountTransition.to === bomb.state &&
        bomb.countdownSeconds !== undefined
      ) {
        stateTransitionToFirstCountMs.push(Math.max(0, elapsedMs - pendingCountTransition.atMs));
        pendingCountTransition = undefined;
      }

      if (bomb.countdownSeconds === undefined) {
        if (missingSpan === undefined || missingSpan.state !== bomb.state) {
          closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
          missingSpan = { state: bomb.state, startMs: elapsedMs, frameCount: 0 };
        }
        missingSpan.frameCount += 1;
        previousCountedSample = undefined;
      } else {
        missingSpan = closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
        if (previousCountedSample !== undefined && previousCountedSample.state === bomb.state) {
          const elapsedSeconds = (elapsedMs - previousCountedSample.elapsedMs) / 1_000;
          const countdownDeltaSeconds =
            previousCountedSample.countdownSeconds - bomb.countdownSeconds;
          countdownDeltaResidualMs.push(Math.abs(countdownDeltaSeconds - elapsedSeconds) * 1_000);
        }
        previousCountedSample = {
          state: bomb.state,
          elapsedMs,
          countdownSeconds: bomb.countdownSeconds,
        };
      }

      const expectedPhase = matchingPhase(bomb.state);
      if (
        expectedPhase !== undefined &&
        phaseCountdown.phase === expectedPhase &&
        bomb.countdownSeconds !== undefined &&
        phaseCountdown.endsInSeconds !== undefined
      ) {
        phaseComparisonResidualMs.push(
          Math.abs(bomb.countdownSeconds - phaseCountdown.endsInSeconds) * 1_000,
        );
      }
    } else {
      lastActiveFrameMs = undefined;
      previousCountedSample = undefined;
      missingSpan = closeMissingSpan(missingCountdownSpans, missingSpan, elapsedMs);
    }

    previousFrame = {
      elapsedMs,
      state: bomb.state,
      countdownSeconds: bomb.countdownSeconds,
    };
  }

  const lastElapsedMs = previousFrame?.elapsedMs ?? 0;
  closeMissingSpan(missingCountdownSpans, missingSpan, lastElapsedMs);
  const intervalStats = stats(activePacketIntervalsMs);
  const transitionStats = stats(stateTransitionToFirstCountMs);
  const phaseStats = stats(phaseComparisonResidualMs);
  const complete = verified.manifest.complete && verified.manifest.droppedFrames === 0;
  const gates = {
    captureComplete: complete,
    activePacketP99Within200Ms:
      intervalStats.p99 === null ? null : intervalStats.p99 <= OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
    transitionP95Within100Ms:
      transitionStats.p95 === null
        ? null
        : transitionStats.p95 <= OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
    noUnexplainedPhaseOffsetOver100Ms:
      phaseStats.max === null ? null : phaseStats.max <= OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
  };

  return {
    capture: {
      directory: verified.directory,
      captureId: verified.manifest.captureId,
      scenario: verified.manifest.scenario,
      platform: verified.manifest.platform,
      broadcastCommit: verified.manifest.broadcastCommit,
      frameCount: verified.frameCount,
      complete: verified.manifest.complete,
      droppedFrames: verified.manifest.droppedFrames,
      framesSha256: verified.computedFramesSha256,
      gsiConfig: allowlistedGsiConfig(verified.manifest.gsiConfig),
    },
    metrics: {
      frameCount,
      activeFrameCount,
      activePacketIntervalMs: intervalStats,
      countdownDeltaResidualMs: stats(countdownDeltaResidualMs),
      stateTransitionToFirstCountMs: transitionStats,
      phaseComparisonResidualMs: phaseStats,
      terminalEvents,
      missingCountdownSpans,
      reconnectGaps: {
        thresholdMs: reconnectThresholdMs,
        count: reconnectGaps.length,
        maxMs: reconnectGaps.length === 0 ? null : Math.max(...reconnectGaps),
        gapsMs: reconnectGaps,
      },
    },
    qualification: {
      numeric01s: {
        result: gateStatus(gates),
        gates,
        thresholds: {
          activePacketP99Ms: OBJECTIVE_CLOCK_PACKET_P99_LIMIT_MS,
          transitionP95Ms: OBJECTIVE_CLOCK_TRANSITION_P95_LIMIT_MS,
          unexplainedOffsetMs: OBJECTIVE_CLOCK_OFFSET_LIMIT_MS,
        },
      },
      numeric001s: {
        result: 'NOT_PROMISED',
        reason: 'GSI precision_time=3 不等于 1 ms 精度，当前不承诺 0.01 s 数值精度。',
      },
    },
  };
}

function formatMetric(value) {
  return value === null ? 'n/a' : `${value.toFixed(1)} ms`;
}

function resultLabel(result) {
  if (result === 'PASS') return '通过（PASS）';
  if (result === 'FAIL') return '失败（FAIL）';
  if (result === 'NOT_PROMISED') return '不承诺（NOT_PROMISED）';
  return '证据不足（INCONCLUSIVE）';
}

export function renderObjectiveTimingReport(result) {
  const { capture, metrics, qualification } = result;
  const config = capture.gsiConfig;
  const lines = [
    '# Objective Clock Capture Qualification Report',
    '',
    `- Capture：\`${capture.captureId}\``,
    `- Git SHA：\`${capture.broadcastCommit}\``,
    `- Platform：\`${capture.platform}\``,
    `- Frames：${capture.frameCount}（active ${metrics.activeFrameCount}）`,
    `- Complete：${capture.complete ? 'yes' : 'no'}；dropped：${capture.droppedFrames}`,
    `- frames SHA-256：\`${capture.framesSha256}\``,
    '',
    '## GSI configuration',
    '',
    `- precision_time：\`${String(config.precision_time ?? 'unknown')}\``,
    `- timeout：\`${String(config.timeout ?? 'unknown')}\``,
    `- buffer / throttle / heartbeat：\`${String(config.buffer ?? 'unknown')} / ${String(config.throttle ?? 'unknown')} / ${String(config.heartbeat ?? 'unknown')}\``,
    '- `precision_time=3` 是 source 配置精度声明，不是 1 ms 数值准确度保证。',
    '',
    '## Metrics',
    '',
    `- Active packet interval：p50 ${formatMetric(metrics.activePacketIntervalMs.p50)}；p95 ${formatMetric(metrics.activePacketIntervalMs.p95)}；p99 ${formatMetric(metrics.activePacketIntervalMs.p99)}；max ${formatMetric(metrics.activePacketIntervalMs.max)}`,
    `- Countdown delta vs monotonic residual：p95 ${formatMetric(metrics.countdownDeltaResidualMs.p95)}；max ${formatMetric(metrics.countdownDeltaResidualMs.max)}`,
    `- State transition → first matching countdown：p95 ${formatMetric(metrics.stateTransitionToFirstCountMs.p95)}；max ${formatMetric(metrics.stateTransitionToFirstCountMs.max)}`,
    `- Same-semantic bomb vs phase residual：p95 ${formatMetric(metrics.phaseComparisonResidualMs.p95)}；max ${formatMetric(metrics.phaseComparisonResidualMs.max)}`,
    `- Reconnect gaps > ${metrics.reconnectGaps.thresholdMs.toFixed(1)} ms：${metrics.reconnectGaps.count}；max ${formatMetric(metrics.reconnectGaps.maxMs)}`,
    `- Missing countdown spans：${metrics.missingCountdownSpans.length}`,
    `- Terminal residual events：${metrics.terminalEvents.length}`,
    '',
    '## Qualification gates',
    '',
    `- Numeric 0.1 s：**${resultLabel(qualification.numeric01s.result)}**`,
  ];
  for (const [name, value] of Object.entries(qualification.numeric01s.gates)) {
    lines.push(
      `  - ${name}：${value === true ? 'PASS' : value === false ? 'FAIL' : 'INCONCLUSIVE'}`,
    );
  }
  lines.push(
    `- Numeric 0.01 s：**${resultLabel(qualification.numeric001s.result)}** — ${qualification.numeric001s.reason}`,
    '',
    '原始 Capture V1 仍是证据源；本报告不替代 Windows + CS2 现场验收，也不打印 GSI token。',
  );
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const json = argv[0] === '--json';
  const captureDir = json ? argv[1] : argv[0];
  if (captureDir === undefined || (json && argv.length !== 2) || (!json && argv.length !== 1)) {
    throw new Error(
      '用法：node scripts/qualification/evidence/objective-timing.mjs [--json] <capture-dir>',
    );
  }
  const result = await analyzeObjectiveTimingCapture(resolve(captureDir));
  process.stdout.write(
    json ? `${JSON.stringify(result, null, 2)}\n` : renderObjectiveTimingReport(result),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `OBJECTIVE_TIMING_ANALYZER_ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
