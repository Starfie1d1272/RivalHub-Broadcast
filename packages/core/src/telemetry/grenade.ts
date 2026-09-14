import type { ObservedVector3 } from './player.js';

export interface ObservedGrenadeFlame {
  readonly sourceFlameId: string;
  readonly position?: ObservedVector3;
  readonly lifetimeSeconds?: number;
  readonly effectSeconds?: number;
}

export interface ObservedGrenade {
  readonly sourceEntityId: string;
  readonly kind?: string;
  readonly ownerSourceId?: string;
  readonly position?: ObservedVector3;
  readonly velocity?: ObservedVector3;
  readonly lifetimeSeconds?: number;
  readonly effectSeconds?: number;
  readonly flames?: readonly ObservedGrenadeFlame[];
}
