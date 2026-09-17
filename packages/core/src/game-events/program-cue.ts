import type { PlayerDeathGameEvent, PlayerHurtGameEvent } from './combat.js';
import type { RoleScopedGameEventObservation } from './observation.js';

export type ProgramPlayerImpactEffect = 'he' | 'zeus' | 'sniper';
export type ProgramEliminationWeaponFamily = ProgramPlayerImpactEffect | 'other';

export interface ProgramCueBase {
  readonly id: string;
  readonly mapEpoch: number;
  readonly source: {
    readonly generation: number;
    readonly sequence: number;
    readonly tick: number;
  };
}

export interface ProgramPlayerImpactCue extends ProgramCueBase {
  readonly kind: 'player-impact';
  readonly effect: ProgramPlayerImpactEffect;
  readonly targetSourcePlayerId: string;
  readonly attackerSourcePlayerId: string | null;
  readonly weapon: string;
  readonly damageHealth: number;
  readonly healthRemaining: number;
  readonly hitgroup: number;
  readonly lethal: boolean;
}

export interface ProgramPlayerEliminationCue extends ProgramCueBase {
  readonly kind: 'player-elimination';
  readonly victimSourcePlayerId: string;
  readonly attackerSourcePlayerId: string | null;
  readonly assisterSourcePlayerId: string | null;
  readonly weapon: string;
  readonly weaponFamily: ProgramEliminationWeaponFamily;
  readonly modifiers: {
    readonly assistedFlash: boolean;
    readonly headshot: boolean;
    readonly penetratedObjects: number;
    readonly noScope: boolean;
    readonly throughSmoke: boolean;
    readonly attackerBlind: boolean;
    readonly attackerInAir: boolean;
  };
}

export type ProgramCue = ProgramPlayerImpactCue | ProgramPlayerEliminationCue;

export interface ProgramCueProjectorInput {
  readonly observation: RoleScopedGameEventObservation<'program'>;
  readonly producerInstanceId: string;
  readonly mapEpoch: number;
}

function stableSourcePlayerId(
  player: { readonly sourcePlayerId?: string } | undefined,
): string | null {
  const sourcePlayerId = player?.sourcePlayerId;
  return typeof sourcePlayerId === 'string' && sourcePlayerId.trim().length > 0
    ? sourcePlayerId
    : null;
}

function cueId(producerInstanceId: string, generation: number, sequence: number): string {
  return `pc:${producerInstanceId}:${generation}:${sequence}`;
}

/** Classify only the presentation families frozen for ProgramCue V1. */
export function classifyProgramWeapon(weapon: string): ProgramEliminationWeaponFamily {
  const normalized = weapon
    .trim()
    .toLowerCase()
    .replace(/^weapon_/, '');
  if (normalized === 'hegrenade') return 'he';
  if (normalized === 'taser') return 'zeus';
  if (
    normalized === 'awp' ||
    normalized === 'ssg08' ||
    normalized === 'scar20' ||
    normalized === 'g3sg1'
  ) {
    return 'sniper';
  }
  return 'other';
}

function baseCue(input: ProgramCueProjectorInput): ProgramCueBase {
  const { cursor } = input.observation;
  return {
    id: cueId(input.producerInstanceId, cursor.generation, cursor.sequence),
    mapEpoch: input.mapEpoch,
    source: {
      generation: cursor.generation,
      sequence: cursor.sequence,
      tick: cursor.tick,
    },
  };
}

function projectPlayerHurt(
  event: PlayerHurtGameEvent,
  input: ProgramCueProjectorInput,
): ProgramCue | null {
  const targetSourcePlayerId = stableSourcePlayerId(event.victim);
  if (targetSourcePlayerId === null) return null;
  const effect = classifyProgramWeapon(event.weapon);
  if (effect === 'other') return null;
  return {
    ...baseCue(input),
    kind: 'player-impact',
    effect,
    targetSourcePlayerId,
    attackerSourcePlayerId: stableSourcePlayerId(event.attacker),
    weapon: event.weapon,
    damageHealth: event.damageHealth,
    healthRemaining: event.healthRemaining,
    hitgroup: event.hitgroup,
    lethal: event.healthRemaining <= 0,
  };
}

function projectPlayerDeath(
  event: PlayerDeathGameEvent,
  input: ProgramCueProjectorInput,
): ProgramCue | null {
  const victimSourcePlayerId = stableSourcePlayerId(event.victim);
  if (victimSourcePlayerId === null) return null;
  return {
    ...baseCue(input),
    kind: 'player-elimination',
    victimSourcePlayerId,
    attackerSourcePlayerId: stableSourcePlayerId(event.attacker),
    assisterSourcePlayerId: stableSourcePlayerId(event.assister),
    weapon: event.weapon,
    weaponFamily: classifyProgramWeapon(event.weapon),
    modifiers: {
      assistedFlash: event.assistedFlash,
      headshot: event.headshot,
      penetratedObjects: event.penetratedObjects,
      noScope: event.noScope,
      throughSmoke: event.throughSmoke,
      attackerBlind: event.attackerBlind,
      attackerInAir: event.attackerInAir,
    },
  };
}

/** Project one Program-role normalized CSTV observation into at most one cue. */
export function projectProgramCue(input: ProgramCueProjectorInput): ProgramCue | null {
  if (input.observation.cursor.role !== 'program') return null;
  switch (input.observation.kind) {
    case 'player-hurt':
      return projectPlayerHurt(input.observation, input);
    case 'player-death':
      return projectPlayerDeath(input.observation, input);
    default:
      return null;
  }
}
