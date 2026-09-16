import { describe, expect, it } from 'vitest';

import { createLocalChannelPublisher } from '../src/local-protocol/channel-publisher.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface Snapshot {
  readonly channelSeq: number;
  readonly value: number;
}

describe('Local channel publisher', () => {
  it('publishes a baseline and coalesces slow subscribers to the latest snapshot', async () => {
    const blocked = deferred();
    const sent: number[] = [];
    const publisher = createLocalChannelPublisher<Snapshot>({
      id: 'program',
      schema: { parse: (input) => input as Snapshot },
    });
    publisher.publish({ value: 1 });
    const subscription = publisher.subscribe(async (snapshot) => {
      sent.push(snapshot.value);
      if (snapshot.value === 1) await blocked.promise;
    });

    publisher.publish({ value: 2 });
    publisher.publish({ value: 3 });
    expect(publisher.getCurrent()).toEqual({ channelSeq: 3, value: 3 });
    expect(subscription.getHealth()).toMatchObject({
      inFlight: true,
      hasPendingLatest: true,
      offered: 3,
    });

    blocked.resolve();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(sent).toEqual([1, 3]);
    expect(subscription.getHealth()).toMatchObject({
      inFlight: false,
      hasPendingLatest: false,
    });

    await subscription.close();
    await publisher.close();
  });

  it('keeps invalid snapshots out of the sequence and isolates subscribers', async () => {
    const diagnostics: string[] = [];
    const sent: number[] = [];
    const publisher = createLocalChannelPublisher<Snapshot>({
      id: 'radar',
      schema: {
        parse: (input) => {
          const snapshot = input as Snapshot;
          if (snapshot.value < 0) throw new Error('invalid');
          return snapshot;
        },
      },
      onDiagnostic: ({ code }) => diagnostics.push(code),
    });
    publisher.publish({ value: 1 });
    const subscription = publisher.subscribe((snapshot) => {
      sent.push(snapshot.value);
      return Promise.resolve();
    });
    publisher.publish({ value: -1 });
    publisher.publish({ value: 2 });
    await flushMicrotasks();

    expect(publisher.getCurrent()).toEqual({ channelSeq: 2, value: 2 });
    expect(sent).toEqual([1, 2]);
    expect(diagnostics).toEqual(['schema-validation-failed']);

    await subscription.close();
    await publisher.close();
  });
});
