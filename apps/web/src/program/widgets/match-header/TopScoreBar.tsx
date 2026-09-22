/** Match composition adapted from Lexogrine cs2-react-hud@7874750c97fcecd8f72eb3fad382917e035ec651
 * (MIT). Angular shell, series pips and objective choreography follow the user-provided reference.
 * Team binding and all gameplay progress remain owned by the existing presentation join/Core. */
import type { HudWidgetRendererProps } from '../../hud-renderer-registry';
import { ObjectiveCenter, ObjectiveFuse } from './ObjectiveCenter';
import {
  buildMatchHeaderPresentation,
  formatMatchHeaderScore,
  type MatchHeaderTeamPresentation,
} from './presentation';

function Team({ team }: { readonly team: MatchHeaderTeamPresentation }) {
  return (
    <div
      className={`match-header__team match-header__team--${team.key}`}
      data-team={team.key}
      data-side={team.side}
    >
      <div className="match-header__team-identity">
        {team.logoUrl ? (
          <img alt={`${team.name} 标志`} className="match-header__team-logo" src={team.logoUrl} />
        ) : null}
        <span className="match-header__team-name" title={team.name}>
          {team.name}
        </span>
        <span className="match-header__side-badge">{team.side ?? '—'}</span>
      </div>
      <div className="match-header__score-stack">
        <strong className="match-header__map-score" data-score={team.key}>
          {formatMatchHeaderScore(team.mapScore)}
        </strong>
        <div
          className="match-header__win-slots"
          aria-label={`系列赛已赢 ${team.seriesScore ?? '未知'} 图`}
        >
          {team.winSlots.map((won, index) => (
            <span key={index} data-series-win-slot={won ? 'won' : 'pending'} />
          ))}
        </div>
      </div>
    </div>
  );
}
export function TopScoreBar({ snapshot }: HudWidgetRendererProps) {
  const p = buildMatchHeaderPresentation(snapshot.payload);
  const timeout = p.timeoutPanel;
  const objective = p.objective.mode !== 'normal' && p.objective.mode !== 'paused';
  return (
    <section
      aria-label="比赛头部"
      className="match-header match-header__top-score"
      data-match-header-widget="top-score-bar"
      data-side-mapping={p.currentSideMapping}
    >
      <div className="match-header__score-shell">
        <Team team={p.teamA} />
        <div
          className={`match-header__center match-header__center--${p.clockTone}`}
          data-clock-tone={p.clockTone}
        >
          {objective ? (
            <ObjectiveCenter presentation={p} />
          ) : timeout !== null ? (
            <div
              className="match-header__timeout-panel"
              data-timeout-owner={timeout.owner ?? 'unknown'}
              data-timeout-panel="true"
              aria-label="战术暂停"
            >
              <strong className="match-header__timeout-label">战术暂停</strong>
              {timeout.ownerName === null ? null : (
                <span className="match-header__timeout-owner">{timeout.ownerName}</span>
              )}
              <div className="match-header__timeout-facts">
                {timeout.remaining === null ? null : (
                  <span data-timeout-remaining>剩余 {timeout.remaining} 次</span>
                )}
                {timeout.clockText === null ? null : (
                  <strong data-timeout-countdown>{timeout.clockText}</strong>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="match-header__round-meta">
                {p.roundLabel === null ? null : <span data-round-label="true">{p.roundLabel}</span>}
              </div>
              <div className="match-header__clock" data-clock="true">
                <strong className="match-header__clock-value">{p.clockText ?? p.phaseLabel}</strong>
              </div>
            </>
          )}
        </div>
        <Team team={p.teamB} />
        {objective &&
        (p.objective.mode === 'planted' || p.objective.mode === 'defusing') &&
        !p.objective.stateOnly ? (
          <ObjectiveFuse center={p.objective} />
        ) : null}
      </div>
      {p.objective.aliveCount === null ? null : (
        <div
          className="match-header__alive-matchup"
          aria-label={`存活人数 ${p.objective.aliveCount}`}
        >
          <strong data-side={p.teamA.side}>{p.objective.aliveCount.split('v')[0]}</strong>
          <span>VS</span>
          <strong data-side={p.teamB.side}>{p.objective.aliveCount.split('v')[1]}</strong>
        </div>
      )}
    </section>
  );
}
