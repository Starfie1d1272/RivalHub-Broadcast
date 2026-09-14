export type CountdownPhase =
  | 'paused'
  | 'timeout_ct'
  | 'timeout_t'
  | 'warmup'
  | 'freezetime'
  | 'live'
  | 'bomb'
  | 'defuse'
  | 'over'
  | 'unknown';

export interface ObservedPhaseCountdown {
  readonly phase?: CountdownPhase;
  readonly endsInSeconds?: number;
}
