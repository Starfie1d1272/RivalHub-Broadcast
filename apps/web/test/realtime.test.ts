import { describe, expect, it } from 'vitest';

import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';
import { programSnapshotSchema } from '@rivalhub-broadcast/protocol/program';
import {
  createLocalChannelClient,
  localWebSocketUrl,
  RECONNECT_BACKOFF_MS,
  type BrowserWebSocketLike,
  type WebSocketFactory,
} from '../src/realtime';

const cursor = {
  producerInstanceId: 'web-realtime-producer',
  liveSessionId: 'live-session-1',
  runtimeSeq: 1,
  programSourceGeneration: 0,
  programReceiveSequence: 1,
  mapEpoch: 0,
};

function snapshot(
  channelSeq: number,
  cursorOverrides: Partial<typeof cursor> = {},
): ProgramSnapshot {
  return programSnapshotSchema.parse({
    type: 'snapshot',
    protocolVersion: 1,
    channel: 'program',
    schemaVersion: 1,
    channelSeq,
    cursor: { ...cursor, ...cursorOverrides },
    payload: {
      status: { telemetry: 'fresh', context: 'unbound', identity: 'unbound' },
      match: null,
      teams: {
        ct: { mode: 'neutral', entryId: null, name: 'CT', logoUrl: null, seriesScore: null },
        t: { mode: 'neutral', entryId: null, name: 'T', logoUrl: null, seriesScore: null },
      },
      map: {
        name: 'de_mirage',
        mode: null,
        phase: 'live',
        roundNumber: 1,
        score: { ct: 0, t: 0 },
        timeoutsRemaining: { ct: null, t: null },
      },
      round: null,
      clock: null,
      observedPlayerSourceId: null,
      players: [],
      bomb: null,
      coverage: {
        map: 'present',
        round: 'absent',
        phaseCountdowns: 'absent',
        player: 'absent',
        allPlayers: 'absent',
        bomb: 'absent',
      },
    },
  });
}

class FakeWebSocket implements BrowserWebSocketLike {
  readyState = 0;
  protocol = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null;
  readonly closeCalls: Array<{ readonly code: number; readonly reason: string }> = [];
  sent: string[] = [];

  open(protocol = 'rivalhub-broadcast.local.v1'): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.();
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code: code ?? 1000, reason: reason ?? '' });
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  serverClose(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function socketFactory(): {
  readonly factory: WebSocketFactory;
  readonly sockets: FakeWebSocket[];
  readonly urls: string[];
  readonly protocols: string[];
} {
  const sockets: FakeWebSocket[] = [];
  const urls: string[] = [];
  const protocols: string[] = [];
  return {
    sockets,
    urls,
    protocols,
    factory: (url, protocol) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      urls.push(url);
      protocols.push(protocol);
      return socket;
    },
  };
}

function scheduler(): {
  readonly scheduler: {
    setTimeout(callback: () => void, delayMs: number): object;
    clearTimeout(handle: object): void;
  };
  readonly delays: number[];
  runNext(): void;
} {
  const timers: Array<{
    readonly callback: () => void;
    readonly delayMs: number;
    cleared: boolean;
  }> = [];
  const delays: number[] = [];
  return {
    delays,
    scheduler: {
      setTimeout(callback, delayMs) {
        delays.push(delayMs);
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(handle) {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
    runNext() {
      const timer = timers.find((candidate) => !candidate.cleared);
      if (timer === undefined) throw new Error('no scheduled timer');
      timer.cleared = true;
      timer.callback();
    },
  };
}

describe('local realtime browser client', () => {
  it('derives same-origin ws URLs and selects the frozen subprotocol', () => {
    expect(
      localWebSocketUrl('/local/v1/program', { protocol: 'http:', host: '127.0.0.1:4173' }),
    ).toBe('ws://127.0.0.1:4173/local/v1/program');
    expect(
      localWebSocketUrl('/local/v1/program', { protocol: 'https:', host: 'broadcast.test' }),
    ).toBe('wss://broadcast.test/local/v1/program');
  });

  it('requires a valid baseline, ignores duplicates, and exposes reset signals', () => {
    const sockets = socketFactory();
    const client = createLocalChannelClient('program', {
      location: { protocol: 'http:', host: '127.0.0.1:4173' },
      webSocketFactory: sockets.factory,
    });

    client.start();
    expect(client.getSnapshot().state).toBe('connecting');
    expect(sockets.sockets).toHaveLength(1);
    expect(sockets.urls[0]).toBe('ws://127.0.0.1:4173/local/v1/program');
    expect(sockets.protocols[0]).toBe('rivalhub-broadcast.local.v1');

    sockets.sockets[0]!.open();
    expect(client.getSnapshot().state).toBe('awaiting-baseline');
    sockets.sockets[0]!.message(JSON.stringify(snapshot(1)));
    expect(client.getSnapshot()).toMatchObject({ state: 'live', current: { channelSeq: 1 } });
    const firstSnapshot = client.getSnapshot();
    sockets.sockets[0]!.message(JSON.stringify(snapshot(1)));
    expect(client.getSnapshot()).toBe(firstSnapshot);

    sockets.sockets[0]!.message(JSON.stringify(snapshot(2, { runtimeSeq: 2, mapEpoch: 1 })));
    expect(client.getSnapshot()).toMatchObject({
      state: 'live',
      current: { channelSeq: 2 },
      reset: { mapEpochChanged: true },
    });
    client.dispose();
  });

  it('uses bounded reconnect backoff and resets only after a new valid baseline', () => {
    const sockets = socketFactory();
    const clock = scheduler();
    const client = createLocalChannelClient('program', {
      location: { protocol: 'http:', host: '127.0.0.1:4173' },
      webSocketFactory: sockets.factory,
      scheduler: clock.scheduler,
    });

    client.start();
    sockets.sockets[0]!.open();
    sockets.sockets[0]!.serverClose();
    expect(clock.delays).toEqual([RECONNECT_BACKOFF_MS[0]]);
    clock.runNext();

    sockets.sockets[1]!.open();
    sockets.sockets[1]!.serverClose();
    expect(clock.delays).toEqual([250, 500]);
    clock.runNext();
    sockets.sockets[2]!.open();
    sockets.sockets[2]!.message(JSON.stringify(snapshot(1)));
    sockets.sockets[2]!.serverClose();
    expect(clock.delays).toEqual([250, 500, 250]);
    client.dispose();
  });

  it('treats schema errors as terminal and producer/runtime regressions as reconnectable', () => {
    const sockets = socketFactory();
    const clock = scheduler();
    const client = createLocalChannelClient('program', {
      location: { protocol: 'http:', host: '127.0.0.1:4173' },
      webSocketFactory: sockets.factory,
      scheduler: clock.scheduler,
    });

    client.start();
    sockets.sockets[0]!.open();
    sockets.sockets[0]!.message(JSON.stringify(snapshot(1)));
    sockets.sockets[0]!.message(
      JSON.stringify(snapshot(2, { producerInstanceId: 'different-producer', runtimeSeq: 2 })),
    );
    expect(client.getSnapshot().state).toBe('reconnecting');
    expect(clock.delays).toEqual([250]);
    clock.runNext();
    sockets.sockets[1]!.open();
    sockets.sockets[1]!.message(JSON.stringify(snapshot(1)));
    sockets.sockets[1]!.message(JSON.stringify(snapshot(2, { runtimeSeq: 0 })));
    expect(client.getSnapshot().state).toBe('reconnecting');
    expect(clock.delays).toEqual([250, 250]);
    clock.runNext();
    sockets.sockets[2]!.open();
    sockets.sockets[2]!.message('{not-json');
    expect(client.getSnapshot().state).toBe('protocol-error');
    expect(clock.delays).toEqual([250, 250]);
    expect(sockets.sockets[2]!.closeCalls[0]).toMatchObject({ code: 1002 });
    client.start();
    expect(sockets.sockets).toHaveLength(3);
    client.dispose();
  });

  it('ignores callbacks from stale connections and cancels reconnect on dispose', () => {
    const sockets = socketFactory();
    const clock = scheduler();
    const client = createLocalChannelClient('program', {
      location: { protocol: 'http:', host: '127.0.0.1:4173' },
      webSocketFactory: sockets.factory,
      scheduler: clock.scheduler,
    });

    client.start();
    const staleSocket = sockets.sockets[0]!;
    staleSocket.serverClose();
    clock.runNext();
    const currentSocket = sockets.sockets[1]!;
    currentSocket.open();
    staleSocket.open();
    staleSocket.message(JSON.stringify(snapshot(99)));
    expect(client.getSnapshot().state).toBe('awaiting-baseline');
    expect(client.getSnapshot().current).toBeNull();

    client.dispose();
    expect(client.getSnapshot().state).toBe('closed');
    expect(() => clock.runNext()).toThrow('no scheduled timer');

    const recreated = createLocalChannelClient('program', {
      location: { protocol: 'http:', host: '127.0.0.1:4173' },
      webSocketFactory: sockets.factory,
      scheduler: clock.scheduler,
    });
    recreated.start();
    sockets.sockets[2]!.open();
    sockets.sockets[2]!.message(JSON.stringify(snapshot(1)));
    expect(recreated.getSnapshot()).toMatchObject({ state: 'live', current: { channelSeq: 1 } });
    recreated.dispose();
  });
});
