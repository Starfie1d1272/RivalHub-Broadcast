export const LATEST_WINS_CLOSE_TIMEOUT_MS = 10_000;

export type LatestWinsConsumerState = 'idle' | 'sending' | 'closing' | 'closed';

export type LatestWinsConsumerErrorCode = 'delivery_rejected' | 'close_timeout';

export interface LatestWinsConsumerDiagnostic {
  readonly code: LatestWinsConsumerErrorCode;
}

export interface LatestWinsConsumerHealth {
  readonly id: string;
  readonly state: LatestWinsConsumerState;
  readonly inFlight: boolean;
  readonly hasPendingLatest: boolean;
  readonly offered: number;
  readonly sent: number;
  readonly coalesced: number;
  readonly failed: number;
  readonly lastErrorCode?: LatestWinsConsumerErrorCode;
}

export interface LatestWinsConsumer<T> {
  offer(snapshot: T): void;
  getHealth(): LatestWinsConsumerHealth;
  close(): Promise<void>;
}

export interface LatestWinsConsumerOptions<T> {
  readonly id: string;
  readonly send: (snapshot: T) => PromiseLike<void> | void;
  readonly closeTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: LatestWinsConsumerDiagnostic) => void;
}

type Lifecycle = 'accepting' | 'closing' | 'closed';

class BoundedLatestWinsConsumer<T> implements LatestWinsConsumer<T> {
  private readonly id: string;
  private readonly send: (snapshot: T) => PromiseLike<void> | void;
  private readonly closeTimeoutMs: number;
  private readonly onDiagnostic: ((diagnostic: LatestWinsConsumerDiagnostic) => void) | undefined;

  private lifecycle: Lifecycle = 'accepting';
  private inFlight = false;
  private pendingLatest: T | undefined;
  private hasPendingLatest = false;
  private offered = 0;
  private sent = 0;
  private coalesced = 0;
  private failed = 0;
  private lastErrorCode: LatestWinsConsumerErrorCode | undefined;
  private closePromise: Promise<void> | undefined;
  private resolveClose: (() => void) | undefined;
  private closeTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

  constructor(options: LatestWinsConsumerOptions<T>) {
    if (options.id.trim().length === 0) throw new Error('LatestWinsConsumer id must be non-empty');
    const closeTimeoutMs = options.closeTimeoutMs ?? LATEST_WINS_CLOSE_TIMEOUT_MS;
    if (!Number.isFinite(closeTimeoutMs) || closeTimeoutMs < 0) {
      throw new RangeError('LatestWinsConsumer closeTimeoutMs must be finite and non-negative');
    }

    this.id = options.id;
    this.send = options.send;
    this.closeTimeoutMs = closeTimeoutMs;
    this.onDiagnostic = options.onDiagnostic;
  }

  offer(snapshot: T): void {
    if (this.lifecycle !== 'accepting') return;

    this.offered += 1;
    if (this.inFlight) {
      if (this.hasPendingLatest) this.coalesced += 1;
      this.pendingLatest = snapshot;
      this.hasPendingLatest = true;
      return;
    }

    this.start(snapshot);
  }

  getHealth(): LatestWinsConsumerHealth {
    const state: LatestWinsConsumerState =
      this.lifecycle === 'closed'
        ? 'closed'
        : this.lifecycle === 'closing'
          ? 'closing'
          : this.inFlight
            ? 'sending'
            : 'idle';

    return {
      id: this.id,
      state,
      inFlight: this.inFlight,
      hasPendingLatest: this.hasPendingLatest,
      offered: this.offered,
      sent: this.sent,
      coalesced: this.coalesced,
      failed: this.failed,
      ...(this.lastErrorCode === undefined ? {} : { lastErrorCode: this.lastErrorCode }),
    };
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;

    this.lifecycle = 'closing';
    this.pendingLatest = undefined;
    this.hasPendingLatest = false;

    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });

    if (!this.inFlight || this.closeTimeoutMs === 0) {
      if (this.inFlight && this.closeTimeoutMs === 0) {
        this.lastErrorCode = 'close_timeout';
        this.emitDiagnostic({ code: 'close_timeout' });
      }
      this.finishClose();
      return this.closePromise;
    }

    this.closeTimeoutHandle = setTimeout(() => {
      this.lastErrorCode = 'close_timeout';
      this.emitDiagnostic({ code: 'close_timeout' });
      this.finishClose();
    }, this.closeTimeoutMs);

    return this.closePromise;
  }

  private start(snapshot: T): void {
    this.inFlight = true;

    let result: PromiseLike<void> | void;
    try {
      result = this.send(snapshot);
    } catch {
      this.completeDelivery(false);
      return;
    }

    void Promise.resolve(result).then(
      () => this.completeDelivery(true),
      () => this.completeDelivery(false),
    );
  }

  private completeDelivery(succeeded: boolean): void {
    this.inFlight = false;
    if (succeeded) {
      this.sent += 1;
    } else {
      this.failed += 1;
      this.lastErrorCode = 'delivery_rejected';
      this.emitDiagnostic({ code: 'delivery_rejected' });
    }

    if (this.lifecycle === 'closing' || this.lifecycle === 'closed') {
      this.finishClose();
      return;
    }

    if (this.hasPendingLatest) {
      const pending = this.pendingLatest;
      this.pendingLatest = undefined;
      this.hasPendingLatest = false;
      this.start(pending as T);
      return;
    }

    this.lifecycle = 'accepting';
  }

  private finishClose(): void {
    if (this.closeTimeoutHandle !== undefined) {
      clearTimeout(this.closeTimeoutHandle);
      this.closeTimeoutHandle = undefined;
    }
    this.lifecycle = 'closed';
    this.pendingLatest = undefined;
    this.hasPendingLatest = false;
    const resolve = this.resolveClose;
    this.resolveClose = undefined;
    resolve?.();
  }

  private emitDiagnostic(diagnostic: LatestWinsConsumerDiagnostic): void {
    try {
      this.onDiagnostic?.(diagnostic);
    } catch {
      // A delivery diagnostic must never affect the producer or another consumer.
    }
  }
}

export function createLatestWinsConsumer<T>(
  options: LatestWinsConsumerOptions<T>,
): LatestWinsConsumer<T>;
export function createLatestWinsConsumer<T>(
  id: string,
  send: (snapshot: T) => PromiseLike<void> | void,
): LatestWinsConsumer<T>;
export function createLatestWinsConsumer<T>(
  optionsOrId: LatestWinsConsumerOptions<T> | string,
  send?: (snapshot: T) => PromiseLike<void> | void,
): LatestWinsConsumer<T> {
  const options: LatestWinsConsumerOptions<T> =
    typeof optionsOrId === 'string'
      ? { id: optionsOrId, send: send ?? (() => undefined) }
      : optionsOrId;
  return new BoundedLatestWinsConsumer(options);
}
