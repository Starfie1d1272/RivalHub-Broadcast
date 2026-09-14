import type { BombState, ObservedBomb } from '@rivalhub-broadcast/core/telemetry';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import { optionalEnum } from '../parse/enum.js';
import { asSourceRecord, type SourceRecord } from '../parse/record.js';
import { optionalNumber, optionalString } from '../parse/scalar.js';
import { optionalVector } from '../parse/vector.js';
import { finishBlock, type ParsedBlock } from './types.js';

function normalizeBombState(value: string): BombState | undefined {
  switch (value.toLowerCase()) {
    case 'carried':
      return 'carried';
    case 'dropped':
      return 'dropped';
    case 'planting':
      return 'planting';
    case 'planted':
      return 'planted';
    case 'defusing':
      return 'defusing';
    case 'exploded':
      return 'exploded';
    case 'defused':
      return 'defused';
    case 'unknown':
      return 'unknown';
    default:
      return undefined;
  }
}

function readCarrierId(
  record: SourceRecord,
  diagnostics: DiagnosticCollector,
  path: string,
): string | undefined {
  if (!Object.hasOwn(record, 'player')) return undefined;
  const value = record.player;
  if (typeof value === 'string') return value;
  const player = asSourceRecord(value);
  if (player !== undefined) {
    return optionalString(player, 'steamid', diagnostics, `${path}.player.steamid`);
  }
  diagnostics.add('INVALID_FIELD', 'error', `${path}.player`);
  return undefined;
}

export function parseBomb(
  value: unknown,
  diagnostics: DiagnosticCollector,
  path: string,
): ParsedBlock<ObservedBomb> {
  const start = diagnostics.totalCount;
  const record = asSourceRecord(value);
  if (record === undefined) {
    diagnostics.add('UNEXPECTED_BLOCK_SHAPE', 'error', path);
    return finishBlock<ObservedBomb>(diagnostics, start, undefined);
  }

  const state = optionalEnum(
    record,
    'state',
    normalizeBombState,
    'unknown',
    diagnostics,
    `${path}.state`,
  );
  const position = optionalVector(record, 'position', diagnostics, `${path}.position`);
  const sourceCarrierId = readCarrierId(record, diagnostics, path);
  const countdownSeconds = optionalNumber(record, 'countdown', diagnostics, `${path}.countdown`);

  return finishBlock(diagnostics, start, {
    ...(state === undefined ? {} : { state }),
    ...(position === undefined ? {} : { position }),
    ...(sourceCarrierId === undefined ? {} : { sourceCarrierId }),
    ...(countdownSeconds === undefined ? {} : { countdownSeconds }),
  });
}
