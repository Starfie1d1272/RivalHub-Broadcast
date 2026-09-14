export type CountdownPhase =
  'warmup' | 'freezetime' | 'live' | 'bomb' | 'defuse' | 'over' | 'unknown';

export interface ObservedPhaseCountdown {
  readonly phase?: CountdownPhase;
  readonly endsInSeconds?: number;
}
