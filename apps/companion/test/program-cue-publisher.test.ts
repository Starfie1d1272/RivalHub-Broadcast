import { describe, expect, it } from 'vitest';

import {
  createProgramCuePublisher,
  PROGRAM_CUE_PENDING_MAX,
  PROGRAM_CUE_PENDING_MAX_AGE_MS,
} from '../src/local-protocol/program-cue-publisher.js';

const cursor = {
  producerInstanceId: 'producer-a',
  liveSessionId: 'session-a',
  mapEpoch: 1,
  cstvProgramGeneration: 0,
} as const;

function baseline(
  mapEpoch: number = cursor.mapEpoch,
  generation: number = cursor.cstvProgramGeneration,
) {
  return {
    type: 'cue-baseline' as const,
    protocolVersion: 1 as const,
    channel: 'program-cue' as const,
    schemaVersion: 1 as const,
    cursor: { ...cursor, mapEpoch, cstvProgramGeneration: generation },
  };
}

function cue(
  sourceSequence: number,
  mapEpoch = cursor.mapEpoch,
  generation = cursor.cstvProgramGeneration,
) {
  const laneCursor = { ...cursor, mapEpoch, cstvProgramGeneration: generation };
  return {
    type: 'cue' as const,
    protocolVersion: 1 as const,
    channel: 'program-cue' as const,
    schemaVersion: 1 as const,
    cursor: laneCursor,
    cue: {
      id: `pc:producer-a:${generation}:${sourceSequence}`,
      mapEpoch,
      source: { generation, sequence: sourceSequence, tick: sourceSequence * 64 },
      kind: 'player-impact' as const,
      effect: 'he' as const,
      targetSourcePlayerId: '76561198000000001',
      attackerSourcePlayerId: null,
      weapon: 'hegrenade',
      damageHealth: 40,
      healthRemaining: 60,
      hitgroup: 1,
      lethal: false,
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProgramCuePublisher', () => {
  it('sends only the current baseline to a new subscriber and keeps cues out of history', async () => {
    const publisher = createProgramCuePublisher({ id: 'program-cue', closeTimeoutMs: 0 });
    publisher.publishBaseline(baseline());
    publisher.publishCue(cue(1));

    const delivered: string[] = [];
    const subscription = publisher.subscribe((message) => {
      delivered.push(message.type);
      return Promise.resolve();
    });
    await flush();

    expect(delivered).toEqual(['cue-baseline']);
    await subscription.close();
    await publisher.close();
  });

  it('keeps pending cues ordered, bounded, and drops the oldest on overflow', async () => {
    const diagnostics: string[] = [];
    const publisher = createProgramCuePublisher({
      id: 'program-cue',
      closeTimeoutMs: 0,
      onDiagnostic: ({ code }) => diagnostics.push(code),
    });
    publisher.publishBaseline(baseline());

    const delivered: number[] = [];
    const resolveSend: Array<() => void> = [];
    const subscription = publisher.subscribe(
      (message) =>
        new Promise<void>((resolve) => {
          if (message.type === 'cue') delivered.push(message.cue.source.sequence);
          resolveSend.push(resolve);
        }),
    );
    for (let sequence = 1; sequence <= PROGRAM_CUE_PENDING_MAX + 2; sequence += 1) {
      publisher.publishCue(cue(sequence));
    }

    expect(subscription.getHealth()).toMatchObject({
      inFlight: true,
      pendingCues: PROGRAM_CUE_PENDING_MAX,
      dropped: 2,
    });
    expect(diagnostics.filter((code) => code === 'queue-overflow')).toHaveLength(2);

    resolveSend.shift()?.();
    await flush();
    while (resolveSend.length > 0) {
      resolveSend.shift()?.();
      await flush();
    }
    expect(delivered).toEqual(
      Array.from({ length: PROGRAM_CUE_PENDING_MAX }, (_, index) => index + 3),
    );

    await subscription.close();
    await publisher.close();
  });

  it('drops an aged pending cue before send and flushes old cues behind a new baseline', async () => {
    let now = 0;
    const diagnostics: string[] = [];
    const publisher = createProgramCuePublisher({
      id: 'program-cue',
      nowMonotonicMs: () => now,
      closeTimeoutMs: 0,
      onDiagnostic: ({ code }) => diagnostics.push(code),
    });
    publisher.publishBaseline(baseline());
    const delivered: string[] = [];
    const resolveSend: Array<() => void> = [];
    const subscription = publisher.subscribe(
      (message) =>
        new Promise<void>((resolve) => {
          delivered.push(message.type === 'cue' ? message.cue.id : message.type);
          resolveSend.push(resolve);
        }),
    );
    publisher.publishCue(cue(1));
    now = PROGRAM_CUE_PENDING_MAX_AGE_MS + 1;
    resolveSend.shift()?.();
    await flush();

    expect(delivered).toEqual(['cue-baseline']);
    expect(diagnostics).toContain('cue-expired');

    await subscription.close();
    await publisher.close();

    const resetPublisher = createProgramCuePublisher({
      id: 'program-cue-reset',
      closeTimeoutMs: 0,
    });
    resetPublisher.publishBaseline(baseline());
    const resetDelivered: string[] = [];
    let releaseInitial: (() => void) | undefined;
    const resetSubscription = resetPublisher.subscribe(
      (message) =>
        new Promise<void>((resolve) => {
          resetDelivered.push(message.type === 'cue' ? message.cue.id : message.type);
          releaseInitial = resolve;
        }),
    );
    resetPublisher.publishCue(cue(2));
    resetPublisher.publishBaseline(baseline(2, 1));
    expect(resetSubscription.getHealth().hasPendingReset).toBe(true);
    releaseInitial?.();
    await flush();
    expect(resetDelivered).toEqual(['cue-baseline', 'cue-baseline']);
    await resetSubscription.close();
    await resetPublisher.close();
  });

  it('isolates a slow subscriber from a fast subscriber', async () => {
    const publisher = createProgramCuePublisher({ id: 'program-cue', closeTimeoutMs: 0 });
    publisher.publishBaseline(baseline());
    let releaseSlow: (() => void) | undefined;
    const slow = publisher.subscribe(
      () =>
        new Promise<void>((resolve) => {
          releaseSlow = resolve;
        }),
    );
    const fastMessages: string[] = [];
    const fast = publisher.subscribe((message) => {
      fastMessages.push(message.type);
      return Promise.resolve();
    });
    await flush();

    publisher.publishCue(cue(1));
    publisher.publishCue(cue(2));
    await flush();

    expect(fastMessages).toEqual(['cue-baseline', 'cue', 'cue']);
    expect(slow.getHealth().pendingCues).toBe(2);
    releaseSlow?.();
    await flush();
    await slow.close();
    await fast.close();
    await publisher.close();
  });
});
