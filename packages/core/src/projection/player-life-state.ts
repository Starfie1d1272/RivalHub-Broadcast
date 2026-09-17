export type PlayerLifeState = 'alive' | 'dead' | 'unknown';

export function derivePlayerLifeState(health: number | null | undefined): PlayerLifeState {
  if (health == null) return 'unknown';
  return health > 0 ? 'alive' : 'dead';
}
