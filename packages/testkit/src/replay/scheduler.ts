import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import type { ReplayScheduler } from './types.js';

export const realReplayScheduler: ReplayScheduler = {
  nowMs: () => performance.now(),
  sleep: async (delayMs, signal) => {
    if (delayMs <= 0) return;
    await sleep(delayMs, undefined, signal === undefined ? undefined : { signal });
  },
};
