import { describe, expect, it } from 'vitest';

import { createReplayController } from '../src/operator/replay-controller';
import type {
  ReplayControllerEvent,
  ReplayControllerFrame,
  ReplayControllerScheduler,
} from '../src/operator/replay-controller';

interface TestFrame extends ReplayControllerFrame {
  readonly value: string;
}

class ManualScheduler implements ReplayControllerScheduler {
  private currentMs = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { deadline: number; callback: () => void }>();

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

const frames: readonly TestFrame[] = [0, 1, 2].map((captureIndex) => ({
  cursor: {
    captureIndex,
    sequence: 100 + captureIndex,
    scheduledElapsedUs: captureIndex * 100_000,
  },
  value: `frame-${captureIndex}`,
}));
const events: readonly ReplayControllerEvent[] = [
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
    captureIndex: 2,
    sequence: 102,
    scheduledElapsedUs: 200_000,
    label: '击杀',
  },
];

describe('HUD Replay controller', () => {
  it('rebuilds selected projection frames and steps through semantic events', async () => {
    const rebuilt: number[] = [];
    const controller = createReplayController({
      frames,
      events,
      rebuild: (captureIndex) => {
        rebuilt.push(captureIndex);
        return Promise.resolve(frames[captureIndex]!);
      },
    });

    await controller.seekEvent('event-b');
    expect(controller.getSnapshot().current?.value).toBe('frame-2');
    await controller.stepEvent(-1);
    expect(controller.getSnapshot().currentEventId).toBe('event-a');
    await controller.restart();

    expect(rebuilt).toEqual([2, 1, 0]);
    controller.dispose();
  });

  it('plays according to capture elapsed time and pause stops future frames', () => {
    const scheduler = new ManualScheduler();
    const controller = createReplayController(
      { frames, events, rebuild: (index) => Promise.resolve(frames[index]!) },
      scheduler,
    );

    controller.play();
    scheduler.advanceBy(150);
    expect(controller.getSnapshot().currentIndex).toBe(1);
    controller.pause();
    scheduler.advanceBy(1_000);

    expect(controller.getSnapshot().currentIndex).toBe(1);
    expect(controller.getSnapshot().isPlaying).toBe(false);
    controller.dispose();
  });
});
