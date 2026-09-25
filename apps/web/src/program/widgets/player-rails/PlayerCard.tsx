import type { CSSProperties } from 'react';

import { observerHotkeyLabel } from '../../observer-hotkey';
import {
  weaponVisualRole,
  type PlayerCardPresentation,
  type PlayerRailAsset,
  type PlayerRailWeapon,
  type WeaponVisualRole,
} from './presentation';

function displayNumber(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

function displayMoney(value: number | null): string {
  return value === null ? '—' : `$${Math.round(value).toLocaleString('en-US')}`;
}

function displaySpent(value: number | null): string {
  return value === null ? '—' : `-$${Math.round(value).toLocaleString('en-US')}`;
}

function MaskIcon({
  asset,
  className = '',
  label,
  weaponVisualRole,
}: {
  readonly asset: PlayerRailAsset | null;
  readonly className?: string;
  readonly label: string;
  readonly weaponVisualRole?: WeaponVisualRole;
}) {
  if (asset === null) return null;
  const style = { '--player-rail-icon': `url("${asset.outputPath}")` } as CSSProperties;
  return (
    <span
      aria-label={label}
      className={`player-rail__icon ${className}`.trim()}
      data-asset-id={asset.canonicalKey}
      data-weapon-visual-role={weaponVisualRole}
      role="img"
      style={style}
    />
  );
}

function WeaponIcon({
  weapon,
  pairedWithFirearm,
}: {
  readonly weapon: PlayerRailWeapon | null;
  readonly pairedWithFirearm: boolean;
}) {
  const visualRole = weapon === null ? undefined : weaponVisualRole(weapon, pairedWithFirearm);
  return (
    <MaskIcon
      asset={weapon?.asset ?? null}
      className={visualRole === undefined ? '' : `is-${visualRole}`}
      label={weapon?.name ?? 'Weapon'}
      {...(visualRole === undefined ? {} : { weaponVisualRole: visualRole })}
    />
  );
}

function Avatar({
  player,
  dead,
}: {
  readonly player: PlayerCardPresentation;
  readonly dead: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="player-rail__avatar"
      data-avatar-present={player.avatarUrl !== null}
      data-card-part="avatar"
    >
      {player.avatarUrl === null ? null : (
        <img
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
          src={player.avatarUrl}
          data-dead={dead}
        />
      )}
    </div>
  );
}

function Equipment({ player }: { readonly player: PlayerCardPresentation }) {
  const slots = [
    { key: 'armor', label: 'Armor', asset: player.armorAsset },
    { key: 'kit', label: 'Defuse kit', asset: player.defuserAsset },
    { key: 'c4', label: 'C4', asset: player.c4Asset },
    { key: 'zeus', label: 'Zeus', asset: player.zeus?.asset ?? null },
  ] as const;
  return (
    <div className="player-rail__equipment" data-player-equipment="true">
      {slots
        .filter((slot) => slot.asset !== null)
        .map((slot) => (
          <span className="player-rail__equipment-slot" data-equipment={slot.key} key={slot.key}>
            <MaskIcon asset={slot.asset} label={slot.label} />
          </span>
        ))}
    </div>
  );
}

const UTILITY_FAMILIES = ['smoke', 'flash', 'he', 'fire'] as const;

function UtilityIcons({ player }: { readonly player: PlayerCardPresentation }) {
  const counts = new Map<
    PlayerCardPresentation['utility'][number]['family'],
    { count: number; asset: PlayerRailAsset | null }
  >();
  for (const utility of player.utility) {
    const current = counts.get(utility.family);
    counts.set(utility.family, {
      count: (current?.count ?? 0) + utility.count,
      asset: current?.asset ?? utility.asset,
    });
  }

  const icons = UTILITY_FAMILIES.flatMap((family) => {
    const utility = counts.get(family);
    if (utility === undefined || utility.asset === null) return [];
    return Array.from({ length: utility.count }, (_, index) => ({
      asset: utility.asset,
      family,
      key: `${family}-${index}`,
    }));
  }).slice(0, 4);

  return (
    <div className="player-rail__utility-icons" data-utility-count={icons.length}>
      {icons.map((utility) => (
        <span
          aria-label={utility.family}
          className="player-rail__utility-item"
          data-utility-family={utility.family}
          key={utility.key}
        >
          <MaskIcon asset={utility.asset} label={utility.family} />
        </span>
      ))}
    </div>
  );
}

function StatGlyph({ kind }: { readonly kind: 'kills' | 'deaths' }) {
  return (
    <svg aria-hidden="true" className="player-rail__stat-glyph" viewBox="0 0 16 16">
      {kind === 'kills' ? (
        <>
          <circle cx="8" cy="8" r="3.25" />
          <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
        </>
      ) : (
        <>
          <path d="M4 7.25a4 4 0 1 1 8 0v2.1c0 .8-.42 1.55-1.1 1.97V14H5.1v-2.68A2.3 2.3 0 0 1 4 9.35z" />
          <circle cx="6.45" cy="7.55" r="0.8" />
          <circle cx="9.55" cy="7.55" r="0.8" />
          <path d="M7 11.1h2M6.25 14v-1.8M8 14v-1.8M9.75 14v-1.8" />
        </>
      )}
    </svg>
  );
}

function Kd({ player }: { readonly player: PlayerCardPresentation }) {
  return (
    <span className="player-rail__kd" aria-label="Kills and deaths" data-player-rail-row-part="kd">
      <StatGlyph kind="kills" />
      <span>{displayNumber(player.stats.kills)}</span>
      <StatGlyph kind="deaths" />
      <span>{displayNumber(player.stats.deaths)}</span>
    </span>
  );
}

function RoundKillBadge({ kills }: { readonly kills: number }) {
  return (
    <span
      aria-label={`Round kills ${kills}`}
      className="player-rail__round-kill-badge"
      data-round-kills={kills}
      role="img"
    >
      <svg aria-hidden="true" viewBox="0 0 26 26">
        <path d="M13 1.5V5M13 21V24.5M1.5 13H5M21 13h3.5" />
        <circle cx="13" cy="13" r="6" />
        <text dominantBaseline="central" textAnchor="middle" x="13" y="13">
          {kills}
        </text>
      </svg>
    </span>
  );
}

function PlayerBody({
  player,
  dead,
}: {
  readonly player: PlayerCardPresentation;
  readonly dead: boolean;
}) {
  const healthStyle = { '--player-rail-health': `${player.healthPercent ?? 0}%` } as CSSProperties;
  const secondaryVisible = player.mode === 'freezetime' && player.secondaryWeapon !== null;
  const pairedWithFirearm = [
    player.primaryWeapon,
    secondaryVisible ? player.secondaryWeapon : null,
  ].some((weapon) => weapon?.item?.kind === 'firearm' && weapon.item.family !== 'pistol');
  return (
    <div className="player-rail__body" data-card-part="body" data-dead={dead}>
      <div className="player-rail__identity">
        <span className="player-rail__name" title={player.displayName ?? undefined}>
          {player.displayName ?? 'PLAYER'}
        </span>
        {dead ? null : (
          <strong className="player-rail__health-value" data-health-value="true">
            {displayNumber(player.health)}
          </strong>
        )}
      </div>

      {dead ? (
        <div aria-hidden="true" className="player-rail__health-spacer" data-health-spacer="true" />
      ) : (
        <div className="player-rail__health-bar" data-health-bar="true">
          <span style={healthStyle} />
        </div>
      )}

      <div
        className="player-rail__combat"
        data-combat-row="true"
        data-dead={dead}
        data-phase={player.mode}
        data-secondary={secondaryVisible}
      >
        <Kd player={player} />
        <div className="player-rail__context" data-player-rail-row-part="context">
          {dead ? (
            <div className="player-rail__dead-stats" data-dead-stats="true">
              {player.liveAdr === null ? null : (
                <span className="player-rail__adr">
                  <small>ADR</small>
                  <b>{displayNumber(player.liveAdr)}</b>
                </span>
              )}
              {player.currentRoundDamage === null ? null : (
                <span className="player-rail__damage">
                  <small>DMG</small>
                  <b>{displayNumber(player.currentRoundDamage)}</b>
                </span>
              )}
            </div>
          ) : (
            <div className="player-rail__loadout">
              <div className="player-rail__weapons">
                <div className="player-rail__weapon-icons">
                  <WeaponIcon pairedWithFirearm={pairedWithFirearm} weapon={player.primaryWeapon} />
                  {secondaryVisible ? (
                    <WeaponIcon
                      pairedWithFirearm={pairedWithFirearm}
                      weapon={player.secondaryWeapon}
                    />
                  ) : null}
                </div>
              </div>
              <Equipment player={player} />
              <UtilityIcons player={player} />
            </div>
          )}
        </div>
      </div>

      <div className="player-rail__bottom">
        <span className="player-rail__money">{displayMoney(player.money)}</span>
        {player.mode === 'freezetime' && !dead ? (
          <span className="player-rail__spent">{displaySpent(player.roundMoneySpent)}</span>
        ) : null}
        <span
          aria-hidden={player.roundKills === null || player.roundKills <= 0}
          className="player-rail__round-kill-slot"
          data-round-kill-slot="true"
        >
          {player.roundKills !== null && player.roundKills > 0 ? (
            <RoundKillBadge kills={player.roundKills} />
          ) : null}
        </span>
      </div>
    </div>
  );
}

export function PlayerCard({
  player,
  physicalSide = 'left',
}: {
  readonly player: PlayerCardPresentation;
  readonly physicalSide?: 'left' | 'right';
}) {
  const dead = player.mode === 'dead';
  const hasAvatar = player.avatarUrl !== null;
  const avatar = <Avatar dead={dead} player={player} />;
  const body = <PlayerBody dead={dead} player={player} />;
  const hotkeyLabel = observerHotkeyLabel(player.observerSlot);
  const endcap = (
    <div
      aria-label={`Observer hotkey ${hotkeyLabel}`}
      className={`player-rail__endcap player-rail__endcap--${physicalSide}`}
      data-card-part="observer-endcap"
      data-observed={player.observed}
      data-side={player.side}
      role="img"
    >
      <strong>{hotkeyLabel}</strong>
    </div>
  );

  return (
    <article
      aria-label={`${player.displayName ?? 'Player'} ${dead ? 'DEAD' : 'player card'}`}
      className={`player-rail__card player-rail__card--${player.mode}${
        player.observed ? ' is-observed' : ''
      }${player.healthPercent !== null && player.healthPercent <= 25 ? ' is-low-health' : ''}`}
      data-avatar={hasAvatar}
      data-life-state={player.lifeState}
      data-observed={player.observed}
      data-player-card={player.sourcePlayerId}
      data-side={player.side}
      data-physical-side={physicalSide}
    >
      {avatar}
      {body}
      {endcap}
    </article>
  );
}
