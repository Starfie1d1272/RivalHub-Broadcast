import { useEffect, useRef, useState, type CSSProperties } from 'react';

import {
  teamUtilityAsset,
  type PlayerRailSide,
  type TeamSummaryPresentation,
  type TeamUtilityFamily,
} from './presentation';

const SUMMARY_HOLD_MS = 5_000;

function formatMoney(value: number | null): string {
  return value === null ? '—' : `$${Math.round(value).toLocaleString('en-US')}`;
}

function formatUtility(value: number | null): string {
  return value === null ? '—' : String(value);
}

const UTILITY_SLOTS: readonly { readonly family: TeamUtilityFamily; readonly label: string }[] = [
  { family: 'smoke', label: 'SMOKE' },
  { family: 'flash', label: 'FLASH' },
  { family: 'he', label: 'HE' },
  { family: 'fire', label: 'FIRE' },
];

function UtilityAsset({
  side,
  family,
  label,
}: {
  readonly side: PlayerRailSide;
  readonly family: TeamUtilityFamily;
  readonly label: string;
}) {
  const asset = teamUtilityAsset(side, family);
  if (asset === null) return null;
  const style = { '--player-rail-icon': `url("${asset.outputPath}")` } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className="player-rail__icon"
      data-asset-id={asset.canonicalKey}
      style={style}
    >
      {label}
    </span>
  );
}

export function TeamSummary({
  phase,
  side,
  summary,
}: {
  readonly phase: 'freezetime' | 'live' | 'unknown';
  readonly side: PlayerRailSide;
  readonly summary: TeamSummaryPresentation;
}) {
  const previousPhase = useRef(phase);
  const [carryoverActive, setCarryoverActive] = useState(false);

  useEffect(() => {
    const wasFreezetime = previousPhase.current === 'freezetime';
    previousPhase.current = phase;
    if (phase !== 'live' || !wasFreezetime) {
      setCarryoverActive(false);
      return;
    }
    setCarryoverActive(true);
    const timer = window.setTimeout(() => setCarryoverActive(false), SUMMARY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const visible = phase === 'freezetime' || (phase === 'live' && carryoverActive);
  const displayed = visible ? summary : null;
  const utility = displayed?.utility ?? null;

  return (
    <div
      aria-hidden={!visible}
      className={`player-rail__summary${visible ? ' is-visible' : ''}`}
      data-summary-carryover={carryoverActive}
      data-summary-phase={phase}
      data-summary-visible={visible}
      data-team-summary={side}
    >
      <div className="player-rail__economy" data-summary-row="economy">
        <div>
          <span>MONEY</span>
          <strong>{formatMoney(displayed?.money ?? null)}</strong>
        </div>
        <div>
          <span>EQUIP</span>
          <strong>{formatMoney(displayed?.equip ?? null)}</strong>
        </div>
        <div>
          <span>LOSS</span>
          <strong>{formatMoney(displayed?.lossBonus ?? null)}</strong>
        </div>
      </div>
      <div className="player-rail__utility" data-summary-row="utility">
        {UTILITY_SLOTS.map(({ family, label }) => (
          <span
            aria-label={`${label} ${utility === null ? 'unavailable' : utility[family]}`}
            className="player-rail__summary-utility"
            data-utility={family}
            key={family}
          >
            <UtilityAsset family={family} label={label} side={side} />
            <small>{label}</small>
            <b>{formatUtility(utility?.[family] ?? null)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export { SUMMARY_HOLD_MS };
