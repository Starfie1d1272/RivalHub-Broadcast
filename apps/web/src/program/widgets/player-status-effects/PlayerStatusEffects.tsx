import type { CSSProperties } from 'react';

export interface PlayerStatusEffectState {
  readonly flashed: number | null;
  readonly smoked: number | null;
  readonly burning: number | null;
}

function effectStrength(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  // CS2 GSI commonly exposes these status fields on a 0..255-ish scale.
  // Synthetic fixtures may use normalized values, so accept both forms.
  const normalized = value <= 1 ? value : value / 255;
  return Math.max(0.42, Math.min(1, normalized));
}

export function PlayerStatusEffects({
  state,
  anchor = 'left',
}: {
  readonly state: PlayerStatusEffectState;
  readonly anchor?: 'left' | 'right';
}) {
  const smoke = effectStrength(state.smoked);
  const burning = effectStrength(state.burning);
  const flashed = effectStrength(state.flashed);
  if (smoke === 0 && burning === 0 && flashed === 0) return null;

  const style = {
    '--rh-player-status-smoke': smoke,
    '--rh-player-status-burning': burning,
    '--rh-player-status-flashed': flashed,
  } as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="player-status-effects"
      data-anchor={anchor}
      data-burning={burning > 0 || undefined}
      data-flashed={flashed > 0 || undefined}
      data-smoked={smoke > 0 || undefined}
      style={style}
    >
      <span className="player-status-effects__smoke" />
      <span className="player-status-effects__fire" />
      <span className="player-status-effects__flash" />
    </div>
  );
}
