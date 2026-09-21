import type { HudWidgetRendererProps } from '../../hud-renderer-registry';

import { buildMatchHeaderPresentation, type MatchHeaderRoundPresentation } from './presentation';

/** Clean-room renderer. It consumes #48's entrant-oriented series.roundHistory only. */

function markerClass(entrant: 'a' | 'b', round: MatchHeaderRoundPresentation): string {
  if (round.state === 'missing') return 'is-missing';
  if (round.winner === 'unknown') return 'is-unknown';
  if (round.winner !== entrant) return 'is-empty';
  if (round.winnerSide === 'CT') return 'is-ct';
  if (round.winnerSide === 'T') return 'is-t';
  return 'is-unknown';
}

export function RoundHistory({ snapshot }: HudWidgetRendererProps) {
  const presentation = buildMatchHeaderPresentation(snapshot.payload);
  const history = presentation.roundHistory;
  if (history === null) return null;

  const columns = `repeat(${Math.max(history.rounds.length, 1)}, minmax(0, 1fr))`;
  return (
    <section
      aria-label="回合历史"
      className="match-header match-header__round-history"
      data-completeness={history.completeness}
      data-match-header-widget="round-history"
    >
      <div className="match-header__round-history-labels" aria-hidden="true">
        <span>A</span>
        <span>B</span>
      </div>
      <div className="match-header__round-history-names" aria-hidden="true">
        <span title={presentation.teamA.name}>{presentation.teamA.name}</span>
        <span title={presentation.teamB.name}>{presentation.teamB.name}</span>
      </div>
      <div className="match-header__round-history-tracks">
        {(['a', 'b'] as const).map((entrant) => (
          <div
            className="match-header__round-history-track"
            data-entrant={entrant}
            key={entrant}
            style={{ gridTemplateColumns: columns }}
          >
            {history.rounds.map((round) => (
              <span
                aria-label={`第 ${round.roundNumber} 回合`}
                className={`match-header__round-marker ${markerClass(entrant, round)}`}
                data-round-number={round.roundNumber}
                data-round-state={round.state}
                data-winner={round.winner}
                data-winner-side={round.winnerSide}
                key={`${entrant}-${round.roundNumber}`}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
