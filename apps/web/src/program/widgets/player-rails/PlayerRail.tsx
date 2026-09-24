import type { HudWidgetRendererProps } from '../../hud-renderer-registry';

import { PlayerCard } from './PlayerCard';
import { buildPlayerRailsPresentation } from './presentation';
import { TeamSummary } from './TeamSummary';

export function PlayerRail({ snapshot, widgetId }: HudWidgetRendererProps) {
  const presentation = buildPlayerRailsPresentation(snapshot.payload);
  const physicalSide = widgetId === 'team-t-rail' ? 'right' : 'left';
  const rail = physicalSide === 'left' ? presentation.left : presentation.right;
  const side = rail.side;
  return (
    <section
      aria-label={`${physicalSide === 'left' ? '左' : '右'}选手栏`}
      className={`player-rail player-rail--${physicalSide} player-rail--${side.toLowerCase()}`}
      data-entrant={rail.entrantKey ?? 'unbound'}
      data-player-rail={side}
      data-physical-side={physicalSide}
      data-player-rail-phase={presentation.phase}
    >
      <TeamSummary phase={presentation.phase} side={side} summary={rail.summary} />
      <div className="player-rail__header" data-rail-header="true">
        <strong>{rail.entrantName ?? 'TEAM'}</strong>
      </div>
      <div className="player-rail__players">
        {rail.players.slice(0, 5).map((player) => (
          <PlayerCard key={player.sourcePlayerId} physicalSide={physicalSide} player={player} />
        ))}
        {Array.from({ length: Math.max(0, 5 - rail.players.length) }, (_, index) => (
          <div aria-hidden="true" className="player-rail__empty-card" key={`empty-${index}`} />
        ))}
      </div>
    </section>
  );
}
