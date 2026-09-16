import { describe, expect, it } from 'vitest';

import { createProjectionCoordinator } from '../src/projections/projection-coordinator.js';
import { createProgramRuntime } from '../src/runtime/program-runtime.js';
import { createCstvSourceManagers } from '../src/telemetry/cstv-source-manager.js';
import type { TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';

function observation(): TelemetryObservation {
  return {
    receive: {
      sequence: 1,
      receivedAt: '2026-09-16T00:00:00.000Z',
      receivedMonotonicMs: 0,
    },
    source: { kind: 'cs2-gsi' },
    coverage: {
      provider: 'present',
      map: 'present',
      round: 'absent',
      phaseCountdowns: 'absent',
      player: 'absent',
      allPlayers: 'absent',
      bomb: 'absent',
      grenades: 'absent',
    },
    telemetry: { map: { name: 'de_mirage', phase: 'live' } },
  };
}

describe('ProjectionCoordinator', () => {
  it('publishes current baseline snapshots and refreshes after accepted runtime mutation', async () => {
    const runtime = createProgramRuntime('coordinator-producer');
    const coordinator = createProjectionCoordinator({
      programRuntime: runtime,
      cstvSources: createCstvSourceManagers({}),
      nowMonotonicMs: () => 0,
    });
    const sent: string[] = [];
    const subscription = coordinator.getPublisher('program').subscribe((snapshot) => {
      sent.push(`${snapshot.channel}:${snapshot.channelSeq}:${snapshot.payload.map.name}`);
      return Promise.resolve();
    });

    expect(sent).toEqual(['program:1:null']);
    const result = runtime.acceptObservation(observation());
    coordinator.afterRuntimeMutation(result);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual(['program:1:null', 'program:2:de_mirage']);
    expect(coordinator.getCurrent().program.status.telemetry).toBe('fresh');
    expect(coordinator.getPublisher('radar').getCurrent()?.channel).toBe('radar');
    expect(coordinator.getPublisher('operator').getCurrent()?.channel).toBe('operator');
    expect(coordinator.getPublisher('assist').getCurrent()?.payload).toEqual({
      availability: 'unavailable',
    });
    expect(coordinator.getPublisher('operator').getCurrent()?.payload).not.toHaveProperty(
      'recentGameEvents',
    );

    await subscription.close();
    await coordinator.close();
  });
});
