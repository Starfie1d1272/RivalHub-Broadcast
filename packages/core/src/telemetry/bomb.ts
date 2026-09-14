import type { ObservedVector3 } from './player.js';

export type BombState =
  'carried' | 'dropped' | 'planting' | 'planted' | 'defusing' | 'exploded' | 'defused' | 'unknown';

export interface ObservedBomb {
  readonly state?: BombState;
  readonly position?: ObservedVector3;
  readonly sourceCarrierId?: string;
  readonly countdownSeconds?: number;
}
