/**
 * Presentation adaptation based on Lexogrine cs2-react-hud at
 * 7874750c97fcecd8f72eb3fad382917e035ec651 (MIT), using TeamBox.tsx. Raw
 * GSI props, donor domain types, and donor lifecycle semantics are omitted.
 */

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
  { family: 'smoke', label: '烟雾弹' },
  { family: 'fire', label: '燃烧弹' },
  { family: 'flash', label: '闪光弹' },
  { family: 'he', label: '高爆手雷' },
  { family: 'decoy', label: '诱饵弹' },
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
  const style = {
    '--player-rail-icon': `url("${asset.outputPath}")`,
  } as CSSProperties;
  return (
    <span
      aria-label={label}
      className="player-rail__icon"
      data-asset-id={asset.canonicalKey}
      role="img"
      style={style}
    />
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
      <div className="player-rail__economy">
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
      <div className="player-rail__utility" aria-label="队伍道具">
        <span>UTIL</span>
        {utility === null ? (
          <strong>—</strong>
        ) : (
          <div className="player-rail__utility-values">
            {UTILITY_SLOTS.map(({ family, label }) => (
              <span className="player-rail__utility-item" data-utility={family} key={family}>
                <UtilityAsset family={family} label={label} side={side} />
                <b>×{formatUtility(utility[family])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { SUMMARY_HOLD_MS };
