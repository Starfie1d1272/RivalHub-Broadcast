import type { PlayerDeathGameEvent, PlayerHurtGameEvent } from './combat.js';
import type { GrenadeThrownGameEvent, WeaponFireGameEvent } from './combat.js';
import type { BombGameEventObservation } from './objective.js';

export type GameEventSourceRole = 'program' | 'lookahead';

/** Continuity cursor owned by one CSTV source role. */
export interface GameEventSourceCursor {
  readonly kind: 'cs2-cstv';
  readonly role: GameEventSourceRole;
  readonly generation: number;
  readonly sequence: number;
  readonly tick: number;
  readonly observedAt: string;
  readonly observedMonotonicMs: number;
  readonly mapName?: string;
  readonly ticksPerSecond?: number;
}

export interface GameEventObservationBase {
  readonly cursor: GameEventSourceCursor;
}

export type GameEventObservation =
  | PlayerDeathGameEvent
  | PlayerHurtGameEvent
  | WeaponFireGameEvent
  | GrenadeThrownGameEvent
  | BombGameEventObservation;

export type GameEventKind = GameEventObservation['kind'];
