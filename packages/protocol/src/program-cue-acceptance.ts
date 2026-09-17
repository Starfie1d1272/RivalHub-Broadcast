import {
  programCueEnvelopeSchema,
  type ProgramCueLaneCursor,
  type ProgramCueLaneMessage,
} from './program-cue.js';

export const PROGRAM_CUE_DEDUPE_MAX = 128;

export interface ProgramCueAcceptanceState {
  readonly baseline: Extract<ProgramCueLaneMessage, { readonly type: 'cue-baseline' }> | null;
  readonly producerInstanceId: string | null;
  readonly lastAcceptedChannelSeq: number | null;
  readonly lastCursor: ProgramCueLaneCursor | null;
  readonly recentCueIds: readonly string[];
}

export type ProgramCueAcceptanceResultKind = 'accepted' | 'ignored' | 'rejected';

export interface ProgramCueAccepted {
  readonly kind: 'accepted';
  readonly message: ProgramCueLaneMessage;
  readonly state: ProgramCueAcceptanceState;
  readonly reset: boolean;
}

export interface ProgramCueIgnored {
  readonly kind: 'ignored';
  readonly reason: 'duplicate-or-out-of-order' | 'duplicate-cue-id' | 'cue-before-baseline';
  readonly state: ProgramCueAcceptanceState;
}

export interface ProgramCueRejected {
  readonly kind: 'rejected';
  readonly reason: 'schema-invalid' | 'producer-changed' | 'cursor-mismatch';
  readonly state: ProgramCueAcceptanceState;
}

export type ProgramCueAcceptanceResult =
  ProgramCueAccepted | ProgramCueIgnored | ProgramCueRejected;

export function createProgramCueAcceptanceState(): ProgramCueAcceptanceState {
  return {
    baseline: null,
    producerInstanceId: null,
    lastAcceptedChannelSeq: null,
    lastCursor: null,
    recentCueIds: [],
  };
}

function sameCursor(left: ProgramCueLaneCursor, right: ProgramCueLaneCursor): boolean {
  return (
    left.producerInstanceId === right.producerInstanceId &&
    left.liveSessionId === right.liveSessionId &&
    left.mapEpoch === right.mapEpoch &&
    left.cstvProgramGeneration === right.cstvProgramGeneration
  );
}

function ignored(
  state: ProgramCueAcceptanceState,
  reason: ProgramCueIgnored['reason'],
): ProgramCueIgnored {
  return { kind: 'ignored', reason, state };
}

function rejected(
  state: ProgramCueAcceptanceState,
  reason: ProgramCueRejected['reason'],
): ProgramCueRejected {
  return { kind: 'rejected', reason, state };
}

/** Accept one transient lane message without retaining a replayable cue history. */
export function acceptProgramCue(
  input: unknown,
  previous: ProgramCueAcceptanceState = createProgramCueAcceptanceState(),
): ProgramCueAcceptanceResult {
  let message: ProgramCueLaneMessage;
  try {
    message = programCueEnvelopeSchema.parse(input);
  } catch {
    return rejected(previous, 'schema-invalid');
  }

  if (
    previous.producerInstanceId !== null &&
    previous.producerInstanceId !== message.cursor.producerInstanceId
  ) {
    return rejected(previous, 'producer-changed');
  }
  if (
    previous.lastAcceptedChannelSeq !== null &&
    message.channelSeq <= previous.lastAcceptedChannelSeq
  ) {
    return ignored(previous, 'duplicate-or-out-of-order');
  }

  if (message.type === 'cue-baseline') {
    const state: ProgramCueAcceptanceState = {
      baseline: message,
      producerInstanceId: message.cursor.producerInstanceId,
      lastAcceptedChannelSeq: message.channelSeq,
      lastCursor: message.cursor,
      recentCueIds: [],
    };
    return {
      kind: 'accepted',
      message,
      state,
      reset: true,
    };
  }

  if (previous.baseline === null || previous.lastCursor === null) {
    return ignored(previous, 'cue-before-baseline');
  }
  if (!sameCursor(previous.lastCursor, message.cursor)) {
    return rejected(previous, 'cursor-mismatch');
  }

  const nextState: ProgramCueAcceptanceState = {
    baseline: previous.baseline,
    producerInstanceId: message.cursor.producerInstanceId,
    lastAcceptedChannelSeq: message.channelSeq,
    lastCursor: message.cursor,
    recentCueIds: previous.recentCueIds.includes(message.cue.id)
      ? previous.recentCueIds
      : [...previous.recentCueIds, message.cue.id].slice(-PROGRAM_CUE_DEDUPE_MAX),
  };
  if (previous.recentCueIds.includes(message.cue.id)) {
    return { ...ignored(nextState, 'duplicate-cue-id') };
  }

  return {
    kind: 'accepted',
    message,
    state: nextState,
    reset: false,
  };
}

export interface ProgramCueAcceptance {
  accept(input: unknown): ProgramCueAcceptanceResult;
  getState(): ProgramCueAcceptanceState;
  reset(): void;
}

export function createProgramCueAcceptance(): ProgramCueAcceptance {
  let state = createProgramCueAcceptanceState();
  return {
    accept(input) {
      const result = acceptProgramCue(input, state);
      if (result.kind === 'accepted' || result.kind === 'ignored') state = result.state;
      return result;
    },
    getState: () => state,
    reset: () => {
      state = createProgramCueAcceptanceState();
    },
  };
}
