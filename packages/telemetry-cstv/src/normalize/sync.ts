import type { CstvSyncMetadata } from '../types.js';
import { asRecord, readPropertyValue } from './player.js';

function requiredFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = readPropertyValue(record, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requiredSafeInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = requiredFiniteNumber(record, key);
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  return requiredFiniteNumber(record, key);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = readPropertyValue(record, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Copy the stable scalar fields from cs2parser's broadcastsync payload. */
export function normalizeCstvSync(value: unknown): CstvSyncMetadata | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;

  const protocol = requiredSafeInteger(record, 'protocol');
  const tick = requiredSafeInteger(record, 'tick');
  const ticksPerSecond = requiredFiniteNumber(record, 'tps');
  const fragment = requiredSafeInteger(record, 'fragment');
  const signupFragment = requiredSafeInteger(record, 'signup_fragment');
  if (
    protocol !== 5 ||
    tick === undefined ||
    ticksPerSecond === undefined ||
    ticksPerSecond <= 0 ||
    fragment === undefined ||
    signupFragment === undefined
  ) {
    return undefined;
  }

  const mapName = optionalString(record, 'map');
  const realTimeDelaySeconds = optionalFiniteNumber(record, 'rtdelay');
  const receiveAgeSeconds = optionalFiniteNumber(record, 'rcvage');

  return {
    protocol,
    tick,
    ticksPerSecond,
    fragment,
    signupFragment,
    ...(mapName === undefined ? {} : { mapName }),
    ...(realTimeDelaySeconds === undefined ? {} : { realTimeDelaySeconds }),
    ...(receiveAgeSeconds === undefined ? {} : { receiveAgeSeconds }),
  };
}
