export interface ReplayControllerFrame {
  readonly cursor: {
    readonly captureIndex: number;
    readonly sequence: number;
    readonly scheduledElapsedUs: number;
  };
}

export interface ReplayControllerEvent {
  readonly id: string;
  readonly kind: string;
  readonly captureIndex: number;
  readonly sequence: number;
  readonly scheduledElapsedUs: number;
  readonly label: string;
}

export interface ReplayControllerSnapshot<Frame extends ReplayControllerFrame> {
  readonly current: Frame | null;
  readonly currentIndex: number;
  readonly currentEventId: string | null;
  readonly isPlaying: boolean;
  readonly isSeeking: boolean;
  readonly error: string | null;
}

export interface ReplayControllerSource<Frame extends ReplayControllerFrame> {
  readonly frames: readonly Frame[];
  readonly events: readonly ReplayControllerEvent[];
  rebuild(targetCaptureIndex: number, signal: AbortSignal): Promise<Frame>;
}

export interface ReplayControllerScheduler {
  nowMs(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: ReplayControllerScheduler = {
  nowMs: () => globalThis.performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ReplayController<Frame extends ReplayControllerFrame> {
  private readonly listeners = new Set<() => void>();
  private readonly source: ReplayControllerSource<Frame>;
  private readonly scheduler: ReplayControllerScheduler;
  private snapshot: ReplayControllerSnapshot<Frame>;
  private timer: unknown;
  private generation = 0;
  private seekController: AbortController | undefined;
  private disposed = false;
  private playbackAnchorMs = 0;

  constructor(source: ReplayControllerSource<Frame>, scheduler = defaultScheduler) {
    if (source.frames.length === 0) throw new RangeError('Replay needs at least one frame');
    for (let index = 0; index < source.frames.length; index += 1) {
      const frame = source.frames[index];
      if (frame === undefined || frame.cursor.captureIndex !== index) {
        throw new RangeError(`Replay frame cursor mismatch at captureIndex ${index}`);
      }
      if (
        index > 0 &&
        frame.cursor.scheduledElapsedUs < source.frames[index - 1]!.cursor.scheduledElapsedUs
      ) {
        throw new RangeError('Replay frame elapsed time must be non-decreasing');
      }
    }
    this.source = source;
    this.scheduler = scheduler;
    this.snapshot = {
      current: source.frames[0]!,
      currentIndex: 0,
      currentEventId: this.eventIdAt(0),
      isPlaying: false,
      isSeeking: false,
      error: null,
    };
  }

  getSnapshot = (): ReplayControllerSnapshot<Frame> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play(): void {
    this.assertActive();
    if (this.snapshot.currentIndex >= this.source.frames.length - 1 || this.snapshot.isPlaying)
      return;
    const currentElapsedUs = this.snapshot.current?.cursor.scheduledElapsedUs ?? 0;
    const firstElapsedUs = this.source.frames[0]!.cursor.scheduledElapsedUs;
    this.playbackAnchorMs = this.scheduler.nowMs() - (currentElapsedUs - firstElapsedUs) / 1_000;
    this.update({ isPlaying: true, error: null });
    this.scheduleNextFrame();
  }

  pause(): void {
    if (this.disposed || !this.snapshot.isPlaying) return;
    this.cancelTimer();
    this.update({ isPlaying: false });
  }

  async restart(): Promise<void> {
    await this.seekCaptureIndex(0);
  }

  async seekCaptureIndex(targetCaptureIndex: number, eventId?: string): Promise<void> {
    this.assertActive();
    if (
      !Number.isSafeInteger(targetCaptureIndex) ||
      targetCaptureIndex < 0 ||
      targetCaptureIndex >= this.source.frames.length
    ) {
      throw new RangeError(`Replay captureIndex is out of range: ${targetCaptureIndex}`);
    }
    if (
      eventId !== undefined &&
      !this.source.events.some(
        (event) => event.id === eventId && event.captureIndex === targetCaptureIndex,
      )
    ) {
      throw new RangeError(`Replay event does not match captureIndex ${targetCaptureIndex}`);
    }
    const generation = ++this.generation;
    this.seekController?.abort();
    const controller = new AbortController();
    this.seekController = controller;
    this.cancelTimer();
    this.update({ isPlaying: false, isSeeking: true, error: null });
    try {
      const frame = await this.source.rebuild(targetCaptureIndex, controller.signal);
      if (this.disposed || generation !== this.generation) return;
      if (frame.cursor.captureIndex !== targetCaptureIndex) {
        throw new Error('Replay rebuild returned a mismatched capture cursor');
      }
      this.update({
        current: frame,
        currentIndex: targetCaptureIndex,
        currentEventId: eventId ?? this.eventIdAt(targetCaptureIndex),
        isSeeking: false,
      });
      this.seekController = undefined;
    } catch (error: unknown) {
      if (this.disposed || generation !== this.generation) return;
      this.update({
        isSeeking: false,
        error: error instanceof Error ? error.message : 'Replay seek failed',
      });
      this.seekController = undefined;
      throw error;
    }
  }

  async seekEvent(eventId: string): Promise<void> {
    this.assertActive();
    const event = this.source.events.find((candidate) => candidate.id === eventId);
    if (event === undefined) throw new RangeError(`Replay event not found: ${eventId}`);
    await this.seekCaptureIndex(event.captureIndex, event.id);
  }

  async stepEvent(direction: -1 | 1): Promise<void> {
    this.assertActive();
    const currentEventIndex = this.source.events.findIndex(
      (event) => event.id === this.snapshot.currentEventId,
    );
    const fallbackIndex = this.source.events.findIndex(
      (event) => event.captureIndex >= this.snapshot.currentIndex,
    );
    const currentIndex = currentEventIndex >= 0 ? currentEventIndex : fallbackIndex;
    const target = this.source.events[currentIndex + direction];
    if (target !== undefined) await this.seekCaptureIndex(target.captureIndex, target.id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.seekController?.abort();
    this.seekController = undefined;
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
    this.snapshot = {
      current: null,
      currentIndex: -1,
      currentEventId: null,
      isPlaying: false,
      isSeeking: false,
      error: null,
    };
  }

  private scheduleNextFrame(): void {
    if (this.disposed || !this.snapshot.isPlaying) return;
    const nextIndex = this.snapshot.currentIndex + 1;
    const nextFrame = this.source.frames[nextIndex];
    if (nextFrame === undefined) {
      this.update({ isPlaying: false });
      return;
    }
    const deadline =
      this.playbackAnchorMs +
      (nextFrame.cursor.scheduledElapsedUs - this.source.frames[0]!.cursor.scheduledElapsedUs) /
        1_000;
    this.timer = this.scheduler.setTimeout(
      () => {
        this.timer = undefined;
        if (this.disposed || !this.snapshot.isPlaying) return;
        this.playbackAnchorMs =
          this.scheduler.nowMs() -
          (nextFrame.cursor.scheduledElapsedUs - this.source.frames[0]!.cursor.scheduledElapsedUs) /
            1_000;
        this.update({
          current: nextFrame,
          currentIndex: nextIndex,
          currentEventId: this.eventIdAt(nextIndex),
        });
        if (nextIndex >= this.source.frames.length - 1) this.update({ isPlaying: false });
        else this.scheduleNextFrame();
      },
      Math.max(0, deadline - this.scheduler.nowMs()),
    );
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private eventIdAt(captureIndex: number): string | null {
    for (let index = this.source.events.length - 1; index >= 0; index -= 1) {
      const event = this.source.events[index];
      if (event !== undefined && event.captureIndex <= captureIndex) return event.id;
    }
    return null;
  }

  private update(patch: Partial<ReplayControllerSnapshot<Frame>>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Replay controller has been disposed');
  }
}

export function createReplayController<Frame extends ReplayControllerFrame>(
  source: ReplayControllerSource<Frame>,
  scheduler?: ReplayControllerScheduler,
): ReplayController<Frame> {
  return new ReplayController(source, scheduler);
}
