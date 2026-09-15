import {
  createInitialRuntimeState,
  getProgramSourceFreshness,
  reduceRuntime,
  type LiveSessionBinding,
  type MapExecutionResetReason,
  type RuntimeContinuityPolicy,
  type RuntimeDisposition,
  type RuntimeReduceResult,
  type ProgramSourceFreshness,
  type RuntimeState,
  type RuntimeTime,
  type RuntimeTransition,
} from '@rivalhub-broadcast/core/runtime';
import type { TelemetryObservation } from '@rivalhub-broadcast/core/telemetry';

export const PROGRAM_RUNTIME_RECENT_TRANSITIONS_MAX = 32;
export const PRODUCTION_RUNTIME_CONTINUITY_POLICY: RuntimeContinuityPolicy = Object.freeze({
  staleAfterMs: 20_000,
});

export interface ProgramRuntimeOptions {
  readonly producerInstanceId: string;
  readonly liveSession?: LiveSessionBinding;
  readonly continuityPolicy?: RuntimeContinuityPolicy;
}

export interface ProgramRuntimeSnapshot {
  readonly producerInstanceId: string;
  readonly sourceGeneration: number;
  readonly continuityPolicy: RuntimeContinuityPolicy;
  readonly current: RuntimeState;
  readonly lastDisposition?: RuntimeDisposition;
  readonly recentTransitions: readonly RuntimeTransition[];
}

/** The sole Companion composition owner for the mutable Core RuntimeState. */
export class ProgramRuntime {
  private readonly continuityPolicy: RuntimeContinuityPolicy;
  private state: RuntimeState;
  private lastDisposition: RuntimeDisposition | undefined;
  private readonly recentTransitions: RuntimeTransition[] = [];

  constructor(options: ProgramRuntimeOptions | string) {
    const normalizedOptions: ProgramRuntimeOptions =
      typeof options === 'string' ? { producerInstanceId: options } : options;
    this.continuityPolicy =
      normalizedOptions.continuityPolicy ?? PRODUCTION_RUNTIME_CONTINUITY_POLICY;
    this.state = createInitialRuntimeState(
      normalizedOptions.producerInstanceId,
      normalizedOptions.liveSession,
    );
  }

  acceptObservation(observation: TelemetryObservation): RuntimeReduceResult {
    return this.apply({
      kind: 'program-telemetry',
      sourceGeneration: this.state.programSource.generation,
      observation,
    });
  }

  advanceProgramSourceGeneration(at: RuntimeTime): RuntimeReduceResult {
    return this.apply({
      kind: 'advance-program-source-generation',
      nextGeneration: this.state.programSource.generation + 1,
      at,
    });
  }

  resetMapExecution(reason: MapExecutionResetReason, at: RuntimeTime): RuntimeReduceResult {
    return this.apply({
      kind: 'reset-map-execution',
      reason,
      at,
    });
  }

  getCurrentState(): RuntimeState {
    return this.state;
  }

  getLastDisposition(): RuntimeDisposition | undefined {
    return this.lastDisposition;
  }

  getSourceFreshness(nowMonotonicMs: number): ProgramSourceFreshness {
    return getProgramSourceFreshness(this.state, nowMonotonicMs, this.continuityPolicy);
  }

  getSnapshot(): ProgramRuntimeSnapshot {
    return {
      producerInstanceId: this.state.producerInstanceId,
      sourceGeneration: this.state.programSource.generation,
      continuityPolicy: this.continuityPolicy,
      current: this.state,
      ...(this.lastDisposition === undefined ? {} : { lastDisposition: this.lastDisposition }),
      recentTransitions: this.recentTransitions.slice(),
    };
  }

  private apply(input: Parameters<typeof reduceRuntime>[1]): RuntimeReduceResult {
    const result = reduceRuntime(this.state, input, this.continuityPolicy);
    this.state = result.state;
    this.lastDisposition = result.disposition;
    if (result.transitions.length > 0) {
      this.recentTransitions.push(...result.transitions);
      const overflow = this.recentTransitions.length - PROGRAM_RUNTIME_RECENT_TRANSITIONS_MAX;
      if (overflow > 0) this.recentTransitions.splice(0, overflow);
    }
    return result;
  }
}

export function createProgramRuntime(
  producerInstanceId: string,
  options: Omit<ProgramRuntimeOptions, 'producerInstanceId'> = {},
): ProgramRuntime {
  return new ProgramRuntime({ producerInstanceId, ...options });
}
