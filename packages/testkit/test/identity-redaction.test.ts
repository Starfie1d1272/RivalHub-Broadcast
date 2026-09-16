import { describe, expect, it } from 'vitest';

import { redactObservationPlayerIds } from '../src/capture/identity-redaction.js';
import type { TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';

function observation(): TelemetryObservation {
  return {
    receive: {
      sequence: 1,
      receivedAt: '2026-09-17T00:00:00.000Z',
      receivedMonotonicMs: 1,
    },
    source: { kind: 'cs2-gsi' },
    coverage: {
      provider: 'present',
      map: 'absent',
      round: 'absent',
      phaseCountdowns: 'absent',
      player: 'present',
      allPlayers: 'absent',
      bomb: 'present',
      grenades: 'present',
    },
    telemetry: {
      player: { sourcePlayerId: '184' },
      bomb: { sourcePlayerId: '184' },
      grenades: [{ sourceEntityId: 'grenade-1', ownerSourceId: '184' }],
    },
  };
}

describe('capture identity redaction', () => {
  it('does not fall back to raw optional participant identifiers', () => {
    const mapping = new Map<string, string>();
    const first = redactObservationPlayerIds(observation(), mapping);
    const second = redactObservationPlayerIds(observation(), mapping);

    expect(first).toEqual(second);
    expect(first.telemetry.player?.sourcePlayerId).toMatch(/^redacted-player-[0-9a-f]{8}$/);
    expect(first.telemetry.player?.sourcePlayerId).not.toBe('184');
    expect(first.telemetry.bomb?.sourcePlayerId).toBe(first.telemetry.player?.sourcePlayerId);
    expect(first.telemetry.grenades?.[0]?.ownerSourceId).toBe(
      first.telemetry.player?.sourcePlayerId,
    );
  });
});
