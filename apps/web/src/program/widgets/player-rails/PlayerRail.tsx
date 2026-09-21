import type { HudWidgetRendererProps } from '../../hud-renderer-registry';

import { PlayerCard } from './PlayerCard';
import { buildPlayerRailsPresentation, type PlayerRailSide } from './presentation';
import { TeamSummary } from './TeamSummary';

export function PlayerRail({ snapshot, widgetId }: HudWidgetRendererProps) {
  const presentation = buildPlayerRailsPresentation(snapshot.payload);
  const side: PlayerRailSide = widgetId === 'team-t-rail' ? 'T' : 'CT';
  const rail = side === 'CT' ? presentation.ct : presentation.t;
  return (
    <section
      aria-label={`${side} 选手栏`}
      className={`player-rail player-rail--${side.toLowerCase()}`}
      data-player-rail={side}
      data-player-rail-phase={presentation.phase}
    >
      <TeamSummary phase={presentation.phase} side={side} summary={rail.summary} />
      <div className="player-rail__players">
        {rail.players.slice(0, 5).map((player) => (
          <PlayerCard key={player.sourcePlayerId} player={player} />
        ))}
        {Array.from({ length: Math.max(0, 5 - rail.players.length) }, (_, index) => (
          <div aria-hidden="true" className="player-rail__empty-card" key={`empty-${index}`} />
        ))}
      </div>
    </section>
  );
}
