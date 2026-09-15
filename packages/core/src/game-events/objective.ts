import type { GameEventObservationBase } from './observation.js';
import type { GameEventPlayerRef } from './player.js';

export interface BombBeginPlantGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-begin-plant';
  readonly player: GameEventPlayerRef;
  /** Raw Source 2 site scalar; it is not interpreted as A/B here. */
  readonly site: number;
}

export interface BombAbortPlantGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-abort-plant';
  readonly player: GameEventPlayerRef;
  readonly site: number;
}

export interface BombPlantedGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-planted';
  readonly player: GameEventPlayerRef;
  readonly site: number;
  readonly c4EntityId: number;
}

export interface BombBeginDefuseGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-begin-defuse';
  readonly player: GameEventPlayerRef;
  readonly hasKit: boolean;
}

export interface BombAbortDefuseGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-abort-defuse';
  readonly player: GameEventPlayerRef;
}

export interface BombDefusedGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-defused';
  readonly player: GameEventPlayerRef;
  readonly site: number;
  readonly c4EntityId: number;
}

export interface BombExplodedGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-exploded';
  readonly player: GameEventPlayerRef;
  readonly site: number;
  readonly c4EntityId: number;
}

export interface BombDroppedGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-dropped';
  readonly player: GameEventPlayerRef;
  readonly entityId: number;
}

export interface BombPickupGameEvent extends GameEventObservationBase {
  readonly kind: 'bomb-pickup';
  readonly sourcePawnId: number;
}

export type BombGameEventObservation =
  | BombBeginPlantGameEvent
  | BombAbortPlantGameEvent
  | BombPlantedGameEvent
  | BombBeginDefuseGameEvent
  | BombAbortDefuseGameEvent
  | BombDefusedGameEvent
  | BombExplodedGameEvent
  | BombDroppedGameEvent
  | BombPickupGameEvent;
