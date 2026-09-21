export type SourceSide = 'CT' | 'T' | 'unknown';

export type RoundWinCondition = 'elimination' | 'bomb' | 'defuse' | 'time' | 'unknown';

export interface ObservedRoundWin {
  readonly roundNumber: number;
  readonly winnerSide: SourceSide;
  readonly winCondition: RoundWinCondition;
}

export type MapPhase = 'warmup' | 'live' | 'intermission' | 'gameover' | 'unknown';

export interface ObservedMapSide {
  readonly name?: string;
  readonly score?: number;
  readonly timeoutsRemaining?: number;
  readonly consecutiveRoundLosses?: number;
}

export interface ObservedMap {
  readonly name?: string;
  readonly mode?: string;
  readonly phase?: MapPhase;
  readonly roundNumber?: number;
  readonly roundWins?: readonly ObservedRoundWin[];
  readonly sides?: {
    readonly ct?: ObservedMapSide;
    readonly t?: ObservedMapSide;
  };
}
