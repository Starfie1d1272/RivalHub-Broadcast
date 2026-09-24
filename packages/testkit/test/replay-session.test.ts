import { describe, expect, it } from 'vitest';

import { createReplaySession } from '../src/replay/session.js';
import type {
  ReplaySessionEvent,
  ReplaySessionFrame,
  ReplaySessionScheduler,
} from '../src/replay/session.js';

interface TestFrame extends ReplaySessionFrame {
  readonly value: string;
}

class ManualScheduler implements ReplaySessionScheduler {
  private currentMs = 0;
  private nextId = 0;
  private readonly timers = new Map<
    number,
    { readonly deadline: number; readonly callback: () => void }
  >();

  nowMs(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.timers.set(id, { deadline: this.currentMs + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advanceBy(durationMs: number): void {
    const end = this.currentMs + durationMs;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.deadline <= end)
        .sort((left, right) => left[1].deadline - right[1].deadline)[0];
      if (due === undefined) break;
      this.currentMs = due[1].deadline;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.currentMs = end;
  }
}

const frames: readonly TestFrame[] = [0, 1, 2, 3].map((captureIndex) => ({
  cursor: {
    captureIndex,
    sequence: 100 + captureIndex,
    scheduledElapsedUs: captureIndex * 100_000,
  },
  value: `frame-${captureIndex}`,
}));
const events: readonly ReplaySessionEvent[] = [
  {
    id: 'event-a',
    kind: 'damage',
    captureIndex: 1,
    sequence: 101,
    scheduledElapsedUs: 100_000,
    label: '伤害',
  },
  {
    id: 'event-b',
    kind: 'death',
    captureIndex: 3,
    sequence: 103,
    scheduledElapsedUs: 300_000,
    label: '击杀',
  },
];

describe('ReplaySession', () => {
  it('rebuilds the production replay prefix for seek, restart, frame and event stepping', async () => {
    const rebuilt: number[] = [];
    const session = createReplaySession({
      frames,
      events,
      rebuild: (captureIndex) => {
        rebuilt.push(captureIndex);
        return frames[captureIndex]!;
      },
    });

    await session.seekEvent('event-b');
    expect(session.getSnapshot().current?.value).toBe('frame-3');
    await session.stepEvent(-1);
    expect(session.getSnapshot().current?.value).toBe('frame-1');
    await session.stepFrame(1);
    expect(session.getSnapshot().current?.value).toBe('frame-2');
    await session.restart();

    expect(rebuilt).toEqual([3, 1, 2, 0]);
    session.dispose();
  });

  it('plays on capture elapsed time and pause stops future frames', () => {
    const scheduler = new ManualScheduler();
    const session = createReplaySession(
      { frames, events, rebuild: (index) => frames[index]! },
      scheduler,
    );
    const observed: number[] = [];
    session.subscribe(() => observed.push(session.getSnapshot().currentIndex));

    session.play();
    scheduler.advanceBy(199);
    expect(session.getSnapshot().currentIndex).toBe(1);
    session.pause();
    scheduler.advanceBy(1_000);

    expect(session.getSnapshot().currentIndex).toBe(1);
    expect(observed).toContain(1);
    expect(session.getSnapshot().isPlaying).toBe(false);
    session.dispose();
  });

  it('rejects mismatched frame rebuilds and prevents work after disposal', async () => {
    const session = createReplaySession({
      frames,
      events,
      rebuild: () => frames[1]!,
    });
    await expect(session.seekCaptureIndex(2)).rejects.toThrow('mismatched capture cursor');
    session.dispose();
    await expect(session.restart()).rejects.toThrow('disposed');
  });
});
