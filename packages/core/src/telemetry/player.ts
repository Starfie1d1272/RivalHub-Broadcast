import type { SourceSide } from './map.js';

export interface ObservedVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type WeaponState = 'active' | 'holstered' | 'reloading' | 'unknown';

export interface ObservedPlayerState {
  readonly health?: number;
  readonly armor?: number;
  readonly hasHelmet?: boolean;
  readonly hasDefuser?: boolean;
  readonly flashed?: number;
  readonly smoked?: number;
  readonly burning?: number;
  readonly money?: number;
  readonly roundTotalDamage?: number;
  readonly roundKills?: number;
  readonly roundKillHeadshots?: number;
  readonly equipValue?: number;
}

export interface ObservedMatchStats {
  readonly kills?: number;
  readonly assists?: number;
  readonly deaths?: number;
  readonly mvps?: number;
  readonly score?: number;
}

export interface ObservedWeapon {
  readonly sourceWeaponId: string;
  readonly name?: string;
  readonly paintKit?: string;
  readonly type?: string;
  readonly ammoClip?: number;
  readonly ammoClipMax?: number;
  readonly ammoReserve?: number;
  readonly state?: WeaponState;
}

export interface ObservedPlayer {
  readonly sourcePlayerId: string;
  readonly displayName?: string;
  readonly side?: SourceSide;
  readonly observerSlot?: number;
  readonly activity?: string;
  readonly state?: ObservedPlayerState;
  readonly matchStats?: ObservedMatchStats;
  readonly weapons?: readonly ObservedWeapon[];
  readonly position?: ObservedVector3;
  readonly forward?: ObservedVector3;
}
