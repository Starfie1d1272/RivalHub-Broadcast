import { describe, expect, it } from 'vitest';

import {
  acceptProgramCue,
  createProgramCueAcceptance,
  programCueBaselineSchema,
  programCueMessageSchema,
} from '../src/index.js';

const cursor = {
  producerInstanceId: 'producer-a',
  liveSessionId: 'session-a',
  mapEpoch: 4,
  cstvProgramGeneration: 2,
} as const;

const baseline = {
  type: 'cue-baseline' as const,
  protocolVersion: 1 as const,
  channel: 'program-cue' as const,
  schemaVersion: 1 as const,
  channelSeq: 1,
  cursor,
};

function cueMessage(channelSeq: number, id = `pc:producer-a:2:${channelSeq}`) {
  return {
    type: 'cue' as const,
    protocolVersion: 1 as const,
    channel: 'program-cue' as const,
    schemaVersion: 1 as const,
    channelSeq,
    cursor,
    cue: {
      id,
      mapEpoch: cursor.mapEpoch,
      source: {
        generation: cursor.cstvProgramGeneration,
        sequence: channelSeq,
        tick: 100 + channelSeq,
      },
      kind: 'player-impact' as const,
      effect: 'zeus' as const,
      targetSourcePlayerId: '76561198000000001',
      attackerSourcePlayerId: null,
      weapon: 'taser',
      damageHealth: 100,
      healthRemaining: 0,
      hitgroup: 1,
      lethal: true,
    },
  };
}

describe('Program cue protocol', () => {
  it('keeps cue schema/version separate from the Program snapshot schema', () => {
    expect(programCueBaselineSchema.parse(baseline)).toEqual(baseline);
    expect(programCueMessageSchema.parse(cueMessage(2))).toMatchObject({
      type: 'cue',
      channel: 'program-cue',
      schemaVersion: 1,
      channelSeq: 2,
    });
  });

  it('rejects a cue whose source metadata does not match its lane cursor', () => {
    expect(
      programCueMessageSchema.safeParse({
        ...cueMessage(2),
        cue: { ...cueMessage(2).cue, mapEpoch: cursor.mapEpoch + 1 },
      }).success,
    ).toBe(false);
    expect(
      programCueMessageSchema.safeParse({
        ...cueMessage(2),
        cue: {
          ...cueMessage(2).cue,
          source: { ...cueMessage(2).cue.source, generation: cursor.cstvProgramGeneration + 1 },
        },
      }).success,
    ).toBe(false);
  });

  it('requires a baseline, accepts gaps, and bounds cue-id dedupe to the connection', () => {
    const beforeBaseline = acceptProgramCue(cueMessage(2));
    expect(beforeBaseline).toMatchObject({ kind: 'ignored', reason: 'cue-before-baseline' });

    const acceptance = createProgramCueAcceptance();
    expect(acceptance.accept(baseline)).toMatchObject({ kind: 'accepted', reset: true });
    expect(acceptance.accept(cueMessage(3))).toMatchObject({ kind: 'accepted', reset: false });
    expect(acceptance.accept(cueMessage(5))).toMatchObject({ kind: 'accepted', reset: false });
    expect(acceptance.accept(cueMessage(6, 'same-cue-id'))).toMatchObject({ kind: 'accepted' });
    expect(acceptance.accept(cueMessage(7, 'same-cue-id'))).toMatchObject({
      kind: 'ignored',
      reason: 'duplicate-cue-id',
    });

    const nextBaseline = { ...baseline, channelSeq: 8, cursor: { ...cursor, mapEpoch: 5 } };
    expect(acceptance.accept(nextBaseline)).toMatchObject({ kind: 'accepted', reset: true });
    expect(acceptance.getState().recentCueIds).toEqual([]);
  });

  it('ignores duplicate and out-of-order channel sequence without replay requests', () => {
    const acceptance = createProgramCueAcceptance();
    acceptance.accept(baseline);
    expect(acceptance.accept(cueMessage(2))).toMatchObject({ kind: 'accepted' });
    expect(acceptance.accept(cueMessage(2, 'different-id'))).toMatchObject({
      kind: 'ignored',
      reason: 'duplicate-or-out-of-order',
    });
    expect(acceptance.accept(cueMessage(1, 'old-id'))).toMatchObject({
      kind: 'ignored',
      reason: 'duplicate-or-out-of-order',
    });
  });
});
