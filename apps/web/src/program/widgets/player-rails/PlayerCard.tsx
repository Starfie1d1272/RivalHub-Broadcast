/**
 * Presentation adaptation based on Lexogrine cs2-react-hud at
 * 7874750c97fcecd8f72eb3fad382917e035ec651 (MIT), using Player.tsx and
 * TeamBox.tsx. Raw GSI props, donor domain types, and donor lifecycle
 * semantics are intentionally omitted.
 */

import type { CSSProperties } from 'react';

import type { PlayerCardPresentation, PlayerRailAsset, PlayerRailWeapon } from './presentation';

function displayNumber(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

function displayMoney(value: number | null): string {
  return value === null ? '—' : `$${Math.round(value).toLocaleString('en-US')}`;
}

function displaySpent(value: number | null): string {
  return value === null ? '—' : `-${displayMoney(value)}`;
}

function MaskIcon({
  asset,
  className = '',
  label,
}: {
  readonly asset: PlayerRailAsset | null;
  readonly className?: string;
  readonly label: string;
}) {
  if (asset === null) return null;
  const style = {
    '--player-rail-icon': `url("${asset.outputPath}")`,
  } as CSSProperties;
  return (
    <span
      aria-label={label}
      className={`player-rail__icon ${className}`.trim()}
      data-asset-id={asset.canonicalKey}
      role="img"
      style={style}
    />
  );
}

function WeaponIcon({
  weapon,
  className = '',
}: {
  readonly weapon: PlayerRailWeapon;
  readonly className?: string;
}) {
  return <MaskIcon asset={weapon.asset} className={className} label={weapon.name ?? '未知装备'} />;
}

function KAD({
  player,
  dead,
}: {
  readonly player: PlayerCardPresentation;
  readonly dead: boolean;
}) {
  return (
    <div className={`player-rail__kad${dead ? ' is-dead' : ''}`} aria-label="击杀助攻死亡">
      <span>
        <small>K</small>
        {displayNumber(player.stats.kills)}
      </span>
      <span>
        <small>A</small>
        {displayNumber(player.stats.assists)}
      </span>
      <span>
        <small>D</small>
        {displayNumber(player.stats.deaths)}
      </span>
    </div>
  );
}

function UtilityIcons({ player }: { readonly player: PlayerCardPresentation }) {
  return (
    <div className="player-rail__utility-icons">
      {player.utility.map((utility) => (
        <span
          className="player-rail__utility-item"
          data-utility-family={utility.family}
          key={utility.sourceWeaponId}
        >
          <WeaponIcon weapon={utility} />
          <b>×{utility.count}</b>
        </span>
      ))}
    </div>
  );
}

export function PlayerCard({ player }: { readonly player: PlayerCardPresentation }) {
  const dead = player.mode === 'dead';
  const healthStyle = {
    '--player-rail-health': `${player.healthPercent ?? 0}%`,
  } as CSSProperties;
  return (
    <article
      aria-label={`${player.displayName ?? '未知选手'} ${dead ? '已阵亡' : '选手卡'}`}
      className={`player-rail__card player-rail__card--${player.mode}${
        player.observed ? ' is-observed' : ''
      }${player.healthPercent !== null && player.healthPercent <= 25 ? ' is-low-health' : ''}`}
      data-life-state={player.lifeState}
      data-observed={player.observed}
      data-player-card={player.sourcePlayerId}
    >
      <div className="player-rail__identity">
        <span className="player-rail__slot">{player.observerSlot ?? '—'}</span>
        <span className="player-rail__name" title={player.displayName ?? undefined}>
          {player.displayName ?? '未知选手'}
        </span>
        {dead ? <strong className="player-rail__dead-label">DEAD</strong> : null}
        {!dead && player.health !== null ? (
          <strong className="player-rail__health-value">{displayNumber(player.health)}</strong>
        ) : null}
        {player.roundKills !== null && player.roundKills > 0 ? (
          <b className="player-rail__round-kills">+{displayNumber(player.roundKills)}</b>
        ) : null}
      </div>

      {dead ? (
        <div aria-hidden="true" className="player-rail__health-spacer" data-health-spacer="true" />
      ) : (
        <div className="player-rail__health-bar">
          <span style={healthStyle} />
        </div>
      )}

      {dead ? (
        <div className="player-rail__dead-stats">
          <KAD dead player={player} />
          <span>
            <small>ADR</small>
            {displayNumber(player.liveAdr)}
          </span>
          <span>
            <small>DMG</small>
            {displayNumber(player.currentRoundDamage)}
          </span>
        </div>
      ) : (
        <div className="player-rail__combat">
          <div className="player-rail__weapons">
            <WeaponIcon
              className="is-primary"
              weapon={
                player.primaryWeapon ?? {
                  sourceWeaponId: 'none',
                  name: null,
                  item: null,
                  asset: null,
                  ammoReserve: null,
                }
              }
            />
            {player.secondaryWeapon ? (
              <WeaponIcon className="is-secondary" weapon={player.secondaryWeapon} />
            ) : null}
            {player.zeus ? <WeaponIcon className="is-zeus" weapon={player.zeus} /> : null}
          </div>
          {player.mode === 'freezetime' || player.mode === 'live' ? (
            <div className="player-rail__equipment" data-player-equipment="true">
              <MaskIcon asset={player.armorAsset} label="护甲" />
              {player.hasDefuser ? <MaskIcon asset={player.defuserAsset} label="拆弹器" /> : null}
              {player.hasC4 ? <MaskIcon asset={player.c4Asset} label="C4" /> : null}
            </div>
          ) : null}
          <UtilityIcons player={player} />
        </div>
      )}

      <div className="player-rail__bottom">
        {dead ? (
          <span className="player-rail__money is-dead-money">{displayMoney(player.money)}</span>
        ) : (
          <>
            <span
              className={`player-rail__money${player.mode === 'freezetime' ? ' is-freeze-money' : ''}`}
            >
              {displayMoney(player.money)}
            </span>
            {player.mode === 'freezetime' ? (
              <span className="player-rail__spent">{displaySpent(player.roundMoneySpent)}</span>
            ) : null}
            <KAD dead={false} player={player} />
          </>
        )}
      </div>
    </article>
  );
}
