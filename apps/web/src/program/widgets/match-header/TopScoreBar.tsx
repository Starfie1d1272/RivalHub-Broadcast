import type { HudWidgetRendererProps } from '../../hud-renderer-registry';

import { buildMatchHeaderPresentation, formatMatchHeaderScore } from './presentation';

/**
 * Presentation adaptation based on Lexogrine cs2-react-hud at
 * 7874750c97fcecd8f72eb3fad382917e035ec651 (MIT), using the wheel from
 * MatchBar.tsx, TeamScore.tsx, TeamLogo.tsx, SeriesBox.tsx, matchbar.scss,
 * Pause.tsx, and Timeout.tsx. Raw GSI props, donor domain types, current-side
 * ownership, and donor countdown semantics are intentionally not retained.
 */

function TeamLogo({ name, logoUrl }: { readonly name: string; readonly logoUrl: string | null }) {
  if (logoUrl === null || logoUrl.trim() === '') return null;
  return <img alt={`${name} 标志`} className="match-header__team-logo" src={logoUrl} />;
}

export function TopScoreBar({ snapshot }: HudWidgetRendererProps) {
  const presentation = buildMatchHeaderPresentation(snapshot.payload);
  const competitionLine = [presentation.competitionName, presentation.stageName]
    .filter((value): value is string => value !== null && value.trim() !== '')
    .join(' · ');

  return (
    <section
      aria-label="比赛头部"
      className="match-header match-header__top-score"
      data-match-header-widget="top-score-bar"
      data-side-mapping={presentation.currentSideMapping}
    >
      <div className="match-header__team match-header__team--a" data-team="a">
        <div className="match-header__team-identity">
          <TeamLogo logoUrl={presentation.teamA.logoUrl} name={presentation.teamA.name} />
          <span className="match-header__team-name" title={presentation.teamA.name}>
            {presentation.teamA.name}
          </span>
          <span
            className={`match-header__side-badge match-header__side-badge--${presentation.teamA.side?.toLowerCase() ?? 'unknown'}`}
          >
            {presentation.teamA.side ?? '—'}
          </span>
        </div>
        <strong className="match-header__map-score" data-score="a">
          {formatMatchHeaderScore(presentation.teamA.mapScore)}
        </strong>
      </div>

      <div
        className={`match-header__center match-header__center--${presentation.clockTone}`}
        data-clock-tone={presentation.clockTone}
      >
        <div className="match-header__clock" data-clock="true">
          <strong className="match-header__clock-value">
            {presentation.clockText ?? presentation.phaseLabel}
          </strong>
          {presentation.clockText !== null ? (
            <span className="match-header__phase">{presentation.phaseLabel}</span>
          ) : null}
        </div>
        <div className="match-header__round-meta">
          <span>{presentation.roundLabel ?? '回合编号不可用'}</span>
          <span>{presentation.currentMapName ?? '地图未知'}</span>
        </div>
        <div className="match-header__series-meta">
          <span>{presentation.bestOfLabel ?? 'BO —'}</span>
          <span>{presentation.seriesScoreText ?? '系列赛比分 —'}</span>
        </div>
        {competitionLine === '' ? null : (
          <span className="match-header__competition" title={competitionLine}>
            {competitionLine}
          </span>
        )}
        {presentation.timeoutText === null ? null : (
          <span
            className="match-header__timeout"
            data-timeout-owner={presentation.timeoutOwner ?? 'unknown'}
          >
            {presentation.timeoutText}
          </span>
        )}
      </div>

      <div className="match-header__team match-header__team--b" data-team="b">
        <strong className="match-header__map-score" data-score="b">
          {formatMatchHeaderScore(presentation.teamB.mapScore)}
        </strong>
        <div className="match-header__team-identity">
          <span
            className={`match-header__side-badge match-header__side-badge--${presentation.teamB.side?.toLowerCase() ?? 'unknown'}`}
          >
            {presentation.teamB.side ?? '—'}
          </span>
          <span className="match-header__team-name" title={presentation.teamB.name}>
            {presentation.teamB.name}
          </span>
          <TeamLogo logoUrl={presentation.teamB.logoUrl} name={presentation.teamB.name} />
        </div>
      </div>
    </section>
  );
}
