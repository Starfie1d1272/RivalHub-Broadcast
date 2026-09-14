export type RoundPhase = 'freezetime' | 'live' | 'over' | 'unknown';

export type RoundBombState = 'planted' | 'exploded' | 'defused' | 'unknown';

export interface ObservedRoundBomb {
  readonly state?: RoundBombState;
}

export interface ObservedRound {
  readonly phase?: RoundPhase;
  readonly winnerSide?: import('./map.js').SourceSide;
  readonly bomb?: ObservedRoundBomb;
}
