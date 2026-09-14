import type { MapPhase, ObservedMap, ObservedMapSide } from '@rivalhub-broadcast/core/telemetry';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import { optionalEnum } from '../parse/enum.js';
import { asSourceRecord } from '../parse/record.js';
import { optionalInteger, optionalString } from '../parse/scalar.js';
import { finishBlock, type ParsedBlock } from './types.js';

function normalizeMapPhase(value: string): MapPhase | undefined {
  switch (value.toLowerCase()) {
    case 'warmup':
      return 'warmup';
    case 'live':
      return 'live';
    case 'intermission':
      return 'intermission';
    case 'gameover':
      return 'gameover';
    default:
      return undefined;
  }
}

function parseMapSide(
  value: unknown,
  diagnostics: DiagnosticCollector,
  path: string,
): ObservedMapSide | undefined {
  const record = asSourceRecord(value);
  if (record === undefined) {
    diagnostics.add('UNEXPECTED_BLOCK_SHAPE', 'error', path);
    return undefined;
  }

  const name = optionalString(record, 'name', diagnostics, `${path}.name`);
  const score = optionalInteger(record, 'score', diagnostics, `${path}.score`);
  const timeoutsRemaining = optionalInteger(
    record,
    'timeouts_remaining',
    diagnostics,
    `${path}.timeouts_remaining`,
  );

  return {
    ...(name === undefined ? {} : { name }),
    ...(score === undefined ? {} : { score }),
    ...(timeoutsRemaining === undefined ? {} : { timeoutsRemaining }),
  };
}

export function parseMap(
  value: unknown,
  diagnostics: DiagnosticCollector,
  path: string,
): ParsedBlock<ObservedMap> {
  const start = diagnostics.totalCount;
  const record = asSourceRecord(value);
  if (record === undefined) {
    diagnostics.add('UNEXPECTED_BLOCK_SHAPE', 'error', path);
    return finishBlock<ObservedMap>(diagnostics, start, undefined);
  }

  const name = optionalString(record, 'name', diagnostics, `${path}.name`);
  const mode = optionalString(record, 'mode', diagnostics, `${path}.mode`);
  const phase = optionalEnum(
    record,
    'phase',
    normalizeMapPhase,
    'unknown',
    diagnostics,
    `${path}.phase`,
  );
  const roundNumber = optionalInteger(record, 'round', diagnostics, `${path}.round`);

  const sideValues: { ct?: ObservedMapSide; t?: ObservedMapSide } = {};
  if (Object.hasOwn(record, 'team_ct')) {
    const ct = parseMapSide(record.team_ct, diagnostics, `${path}.team_ct`);
    if (ct !== undefined) sideValues.ct = ct;
  }
  if (Object.hasOwn(record, 'team_t')) {
    const t = parseMapSide(record.team_t, diagnostics, `${path}.team_t`);
    if (t !== undefined) sideValues.t = t;
  }

  const hasSides = sideValues.ct !== undefined || sideValues.t !== undefined;
  return finishBlock(diagnostics, start, {
    ...(name === undefined ? {} : { name }),
    ...(mode === undefined ? {} : { mode }),
    ...(phase === undefined ? {} : { phase }),
    ...(roundNumber === undefined ? {} : { roundNumber }),
    ...(hasSides ? { sides: sideValues } : {}),
  });
}
