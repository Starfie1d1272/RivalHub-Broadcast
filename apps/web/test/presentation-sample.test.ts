import { describe, expect, it } from 'vitest';
import { consecutivePresentationSamples } from '../src/program/presentation-sample';

const sample = (programReceiveSequence: number) => ({
  producerInstanceId: 'producer',
  liveSessionId: 'session',
  runtimeSeq: programReceiveSequence,
  programSourceGeneration: 1,
  programReceiveSequence,
  mapEpoch: 2,
});

describe('renderer sample continuity', () => {
  it('allows adjacent samples only within one presentation revision', () => {
    expect(consecutivePresentationSamples(sample(10), sample(11))).toBe(true);
    expect(consecutivePresentationSamples(sample(10), sample(11), 4, 5)).toBe(false);
    expect(consecutivePresentationSamples(sample(10), sample(12), 4, 4)).toBe(false);
  });
});
