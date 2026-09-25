/** Match composition adapted from Lexogrine cs2-react-hud@7874750c97fcecd8f72eb3fad382917e035ec651
 * (MIT). Angular shell, series pips and objective choreography follow the user-provided reference.
 * Team binding and all gameplay progress remain owned by the existing presentation join/Core. */
import type { HudWidgetRendererProps } from '../../hud-renderer-registry';
import { useState } from 'react';
import { ObjectiveCenter, ObjectiveFuse } from './ObjectiveCenter';
import {
  buildMatchHeaderPresentation,
  formatMatchHeaderScore,
  type MatchHeaderTeamPresentation,
} from './presentation';

function TeamLogo({ team }: { readonly team: MatchHeaderTeamPresentation }) {
  const [failed, setFailed] = useState(false);
  if (team.logoUrl === null || failed) return null;
  return (
    <img
      alt=""
      className="match-header__team-logo"
      onError={() => setFailed(true)}
      src={team.logoUrl}
    />
  );
}

function Team({ team }: { readonly team: MatchHeaderTeamPresentation }) {
  return (
    <>
      <div
        aria-label={`${team.name} logo`}
        className={`match-header__score-zone match-header__score-zone--logo match-header__score-zone--logo-${team.key}`}
        data-team-logo-slot={team.key}
        data-side={team.side ?? 'unknown'}
      >
        <TeamLogo key={`${team.key}:${team.logoUrl ?? ''}`} team={team} />
      </div>
      <div
        aria-label={`${team.name} score`}
        className={`match-header__score-zone match-header__score-zone--score match-header__score-zone--score-${team.key}`}
        data-team={team.key}
        data-side={team.side ?? 'unknown'}
      >
        <strong className="match-header__map-score" data-score={team.key}>
          {formatMatchHeaderScore(team.mapScore)}
        </strong>
        <div
          className="match-header__win-slots"
          aria-label={`Series maps won ${team.seriesScore ?? 'unknown'}`}
        >
          {team.winSlots.map((won, index) => (
            <span key={index} data-series-win-slot={won ? 'won' : 'pending'} />
          ))}
        </div>
      </div>
      <span
        aria-hidden="true"
        className={`match-header__side-accent match-header__side-accent--${team.key}`}
        data-side={team.side ?? 'unknown'}
      />
    </>
  );
}
export function TopScoreBar({ snapshot, presentationRevision = 0 }: HudWidgetRendererProps) {
  const p = buildMatchHeaderPresentation(snapshot.payload);
  const timeout = p.timeoutPanel;
  const objective =
    p.objective.mode !== 'normal' &&
    p.objective.mode !== 'paused' &&
    p.clockTone !== 'timeout' &&
    p.clockTone !== 'paused';
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
          {p.clockTone === 'paused' ? (
            <div className="match-header__tech-pause" data-tech-pause="true">
              <svg aria-hidden="true" viewBox="0 0 18 18">
                <path d="M4 3h3v12H4zM11 3h3v12h-3z" />
              </svg>
              <strong>TECH PAUSE</strong>
            </div>
          ) : objective ? (
            <ObjectiveCenter
              cursor={snapshot.cursor}
              presentation={p}
              presentationRevision={presentationRevision}
            />
          ) : p.phaseLabel === 'ROUND OVER' ? (
            <div className="match-header__round-over" data-round-over="true">
              <span>ROUND</span>
              <strong>OVER</strong>
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
      </div>
      {objective &&
      (p.objective.mode === 'planted' || p.objective.mode === 'defusing') &&
      !p.objective.stateOnly ? (
        <ObjectiveFuse
          center={p.objective}
          cursor={snapshot.cursor}
          presentationRevision={presentationRevision}
        />
      ) : null}
      {timeout?.owner === 'a' ? (
        <TimeoutPanel timeout={timeout} side="a" ownerSide={p.teamA.side} />
      ) : null}
      {timeout?.owner === 'b' ? (
        <TimeoutPanel timeout={timeout} side="b" ownerSide={p.teamB.side} />
      ) : null}
      {p.objective.aliveCount === null ? null : (
        <div
          className="match-header__alive-matchup"
          aria-label={`存活人数 ${p.objective.aliveCount}`}
        >
          <strong data-side={p.teamA.side ?? 'unknown'}>
            {p.objective.aliveCount.split('v')[0]}
          </strong>
          <span>VS</span>
          <strong data-side={p.teamB.side ?? 'unknown'}>
            {p.objective.aliveCount.split('v')[1]}
          </strong>
        </div>
      )}
    </section>
  );
}

function TimeoutPanel({
  timeout,
  side,
  ownerSide,
}: {
  readonly timeout: NonNullable<ReturnType<typeof buildMatchHeaderPresentation>['timeoutPanel']>;
  readonly side: 'a' | 'b';
  readonly ownerSide: MatchHeaderTeamPresentation['side'];
}) {
  return (
    <div
      className={`match-header__timeout-panel match-header__timeout-panel--${side}`}
      data-timeout-owner={side}
      data-side={ownerSide ?? 'unknown'}
      data-timeout-panel="true"
      aria-label="TACTICAL TIMEOUT"
    >
      <strong className="match-header__timeout-label">TACTICAL TIMEOUT</strong>
      <span className="match-header__timeout-count">{timeout.remaining ?? '—'} LEFT</span>
    </div>
  );
}
