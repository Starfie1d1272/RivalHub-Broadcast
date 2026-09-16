import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  LocalChannelPublisher,
  LocalSubscription,
} from '../src/local-protocol/channel-publisher.js';
import {
  createLocalWebSocketTransport,
  type LocalWebSocketLike,
  type LocalWebSocketTransport,
} from '../src/local-web/websocket-transport.js';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_LOCAL_SNAPSHOT_BYTES,
  MAX_LOCAL_WS_BUFFER_BYTES,
  type LocalWebChannel,
} from '../src/local-web/transport-constants.js';

type TransportSnapshot = {
  readonly channel: LocalWebChannel;
  readonly channelSeq: number;
  readonly value: string;
};

class FakePublisher implements LocalChannelPublisher<TransportSnapshot> {
  private readonly subscribers = new Map<number, (snapshot: TransportSnapshot) => Promise<void>>();
  private nextSubscriberId = 0;
  private current: TransportSnapshot | null = null;

  publish(snapshot: Omit<TransportSnapshot, 'channelSeq'>): void {
    this.current = { ...snapshot, channelSeq: (this.current?.channelSeq ?? 0) + 1 };
    for (const send of this.subscribers.values()) void send(this.current).catch(() => undefined);
  }

  getCurrent(): TransportSnapshot | null {
    return this.current;
  }

  subscribe(send: (snapshot: TransportSnapshot) => Promise<void>): LocalSubscription {
    const id = ++this.nextSubscriberId;
    this.subscribers.set(id, send);
    if (this.current !== null) void send(this.current).catch(() => undefined);
    return {
      close: () => {
        this.subscribers.delete(id);
        return Promise.resolve();
      },
      getHealth: () => ({
        id: `fake-${id}`,
        state: 'idle' as const,
        inFlight: false,
        hasPendingLatest: false,
        offered: 0,
        sent: 0,
        coalesced: 0,
        failed: 0,
      }),
    };
  }

  close(): Promise<void> {
    this.subscribers.clear();
    return Promise.resolve();
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

class FakeSocket extends EventEmitter {
  bufferedAmount = 0;
  readyState = 1;
  protocol = 'rivalhub-broadcast.local.v1';
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ readonly code: number; readonly reason: string }> = [];
  terminated = 0;
  pings = 0;
  sendError: Error | undefined;
  deferSend = false;
  private readonly deferredCallbacks: Array<(error?: Error) => void> = [];

  send(data: string, callback: (error?: Error) => void): void {
    this.sent.push(data);
    if (this.deferSend) {
      this.deferredCallbacks.push(callback);
      return;
    }
    callback(this.sendError);
  }

  resolveSend(): void {
    for (const callback of this.deferredCallbacks.splice(0)) callback();
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code: code ?? 1000, reason: reason ?? '' });
    this.readyState = 3;
    this.emit('close', code ?? 1000, Buffer.from(reason ?? ''));
  }

  terminate(): void {
    this.terminated += 1;
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  }

  ping(): void {
    this.pings += 1;
  }
}

class FakeHeartbeatScheduler {
  callback: (() => void) | undefined;
  intervalMs: number | undefined;
  cleared = false;

  setInterval(callback: () => void, delayMs: number): object {
    this.callback = callback;
    this.intervalMs = delayMs;
    return this;
  }

  clearInterval(): void {
    this.cleared = true;
  }

  tick(): void {
    this.callback?.();
  }
}

const transports: LocalWebSocketTransport[] = [];

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createTransport(
  publisher: FakePublisher,
  scheduler?: FakeHeartbeatScheduler,
  diagnostics: Array<{ readonly code: string; readonly bufferedBytes?: number }> = [],
): LocalWebSocketTransport {
  const transport = createLocalWebSocketTransport({
    getPublisher: () => publisher,
    ...(scheduler === undefined ? {} : { heartbeatScheduler: scheduler }),
    onDiagnostic: (diagnostic) =>
      diagnostics.push({
        code: diagnostic.code,
        ...(diagnostic.bufferedBytes === undefined
          ? {}
          : { bufferedBytes: diagnostic.bufferedBytes }),
      }),
  });
  transports.push(transport);
  return transport;
}

function attach(transport: LocalWebSocketTransport, socket: FakeSocket): void {
  transport.attach('program', socket as unknown as LocalWebSocketLike, 'http://localhost:4173');
}

describe('local WebSocket transport lifecycle', () => {
  it('sends the publisher baseline first and forwards later full snapshots', async () => {
    const publisher = new FakePublisher();
    publisher.publish({ channel: 'program', value: 'baseline' });
    const socket = new FakeSocket();
    const transport = createTransport(publisher);

    attach(transport, socket);
    await flushMicrotasks();
    publisher.publish({ channel: 'program', value: 'latest' });
    await flushMicrotasks();

    expect(socket.sent.map((value) => JSON.parse(value) as unknown)).toEqual([
      { channel: 'program', channelSeq: 1, value: 'baseline' },
      { channel: 'program', channelSeq: 2, value: 'latest' },
    ]);
  });

  it('removes only the failed subscriber and keeps another channel consumer live', async () => {
    const publisher = new FakePublisher();
    publisher.publish({ channel: 'program', value: 'baseline' });
    const failedSocket = new FakeSocket();
    failedSocket.sendError = new Error('socket send failed');
    const healthySocket = new FakeSocket();
    const transport = createTransport(publisher);

    attach(transport, failedSocket);
    attach(transport, healthySocket);
    await flushMicrotasks();

    expect(failedSocket.terminated).toBe(1);
    expect(healthySocket.sent).toHaveLength(1);
    expect(publisher.subscriberCount).toBe(1);
  });

  it('terminates a slow consumer before an unbounded transport queue can form', async () => {
    const publisher = new FakePublisher();
    publisher.publish({ channel: 'program', value: 'baseline' });
    const socket = new FakeSocket();
    socket.bufferedAmount = MAX_LOCAL_WS_BUFFER_BYTES + 1;
    const diagnostics: Array<{ readonly code: string; readonly bufferedBytes?: number }> = [];
    const transport = createTransport(publisher, undefined, diagnostics);

    attach(transport, socket);
    await flushMicrotasks();

    expect(socket.terminated).toBe(1);
    expect(publisher.subscriberCount).toBe(0);
    expect(diagnostics).toContainEqual({
      code: 'slow_consumer_terminated',
      bufferedBytes: MAX_LOCAL_WS_BUFFER_BYTES + 1,
    });
  });

  it('closes an oversized snapshot with the fixed bounded failure', async () => {
    const publisher = new FakePublisher();
    publisher.publish({ channel: 'program', value: 'x'.repeat(MAX_LOCAL_SNAPSHOT_BYTES) });
    const socket = new FakeSocket();
    const transport = createTransport(publisher);

    attach(transport, socket);
    await flushMicrotasks();

    expect(socket.closeCalls[0]).toMatchObject({
      code: 1009,
      reason: 'local snapshot exceeds 256 KiB',
    });
    expect(socket.terminated).toBe(0);
    expect(publisher.subscriberCount).toBe(0);
  });

  it('uses one shared heartbeat timer and terminates only connections that miss two ticks', () => {
    const publisher = new FakePublisher();
    const scheduler = new FakeHeartbeatScheduler();
    const first = new FakeSocket();
    const second = new FakeSocket();
    const transport = createTransport(publisher, scheduler);

    attach(transport, first);
    attach(transport, second);
    expect(scheduler.intervalMs).toBe(HEARTBEAT_INTERVAL_MS);
    scheduler.tick();
    expect(first.pings).toBe(1);
    expect(second.pings).toBe(1);
    first.emit('pong');
    scheduler.tick();
    expect(first.terminated).toBe(0);
    expect(second.terminated).toBe(1);
    scheduler.tick();
    expect(first.terminated).toBe(1);
  });

  it('cleans timer, socket subscriptions, and in-flight sends on shutdown', async () => {
    const publisher = new FakePublisher();
    publisher.publish({ channel: 'program', value: 'baseline' });
    const scheduler = new FakeHeartbeatScheduler();
    const socket = new FakeSocket();
    socket.deferSend = true;
    const transport = createTransport(publisher, scheduler);

    attach(transport, socket);
    await transport.close();
    await transport.close();

    expect(scheduler.cleared).toBe(true);
    expect(socket.closeCalls[0]).toMatchObject({ code: 1001, reason: 'server shutdown' });
    expect(publisher.subscriberCount).toBe(0);
    socket.resolveSend();
    await flushMicrotasks();
  });
});
