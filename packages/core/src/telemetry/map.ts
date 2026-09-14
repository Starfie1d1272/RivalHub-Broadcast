export type SourceSide = 'CT' | 'T' | 'unknown';

export type MapPhase = 'warmup' | 'live' | 'intermission' | 'gameover' | 'unknown';

export interface ObservedMapSide {
  readonly name?: string;
  readonly score?: number;
  readonly timeoutsRemaining?: number;
}

export interface ObservedMap {
  readonly name?: string;
  readonly mode?: string;
  readonly phase?: MapPhase;
  readonly roundNumber?: number;
  readonly sides?: {
    readonly ct?: ObservedMapSide;
    readonly t?: ObservedMapSide;
  };
}
