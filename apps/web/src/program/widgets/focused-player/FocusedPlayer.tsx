import { useState, type CSSProperties } from 'react';
import type { HudWidgetRendererProps } from '../../hud-renderer-registry';
import type { PlayerRailAsset } from '../player-rails/presentation';
import { buildFocusedPlayerPresentation, type FocusedPlayerPresentation } from './presentation';

function Icon({ asset }: { readonly asset: PlayerRailAsset | null }) {
  if (asset === null) return null;
  return (
    <span
      className="focused-player__icon"
      role="img"
      aria-label={asset.canonicalKey}
      data-asset-id={asset.canonicalKey}
      style={{ '--focused-icon': `url("${asset.outputPath}")` } as CSSProperties}
    />
  );
}

export function FocusedPlayerCard({ player }: { readonly player: FocusedPlayerPresentation }) {
  return <Card key={`${player.sourcePlayerId}:${player.avatarUrl ?? ''}`} player={player} />;
}

function Card({ player: p }: { readonly player: FocusedPlayerPresentation }) {
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = p.avatarUrl !== null && avatarLoaded && !avatarFailed;
  return (
    <article
      aria-label="Focused player"
      className="focused-player"
      data-focused-player={p.sourcePlayerId}
      data-avatar={showAvatar}
      data-side={p.side}
      data-dead={p.dead}
    >
      <div className="focused-player__identity">
        <strong className="focused-player__name" title={p.displayName}>
          {p.displayName}
        </strong>
        <div className="focused-player__metrics" aria-label="K A D ADR">
          <span>
            <small>K</small>
            <b>{p.stats.kills ?? '—'}</b>
          </span>
          <span>
            <small>A</small>
            <b>{p.stats.assists ?? '—'}</b>
          </span>
          <span>
            <small>D</small>
            <b>{p.stats.deaths ?? '—'}</b>
          </span>
          <span>
            <small>ADR</small>
            <b>{p.completedAdr === null ? '—' : Number(p.completedAdr.toFixed(1))}</b>
          </span>
        </div>
      </div>

      <div className="focused-player__action" data-focused-action="true">
        <div
          aria-label={
            showAvatar ? `${p.displayName} avatar` : `Observer ${p.observerSlot ?? 'unknown'}`
          }
          className={`focused-player__media${showAvatar ? ' has-avatar' : ' is-observer-tile'}`}
          data-avatar-slot="true"
          data-side={p.side}
        >
          {p.avatarUrl === null || avatarFailed ? null : (
            <img
              src={p.avatarUrl}
              alt={`${p.displayName} avatar`}
              style={{ display: showAvatar ? undefined : 'none' }}
              onLoad={() => setAvatarLoaded(true)}
              onError={() => setAvatarFailed(true)}
            />
          )}
          {showAvatar ? (
            <span className="focused-player__slot-badge">{p.observerSlot ?? '—'}</span>
          ) : (
            <strong className="focused-player__observer-tile-number">
              {p.observerSlot ?? '—'}
            </strong>
          )}
        </div>
        <span
          aria-hidden="true"
          className="focused-player__action-gap focused-player__action-gap--a"
        />
        {p.dead ? (
          <div aria-label="Dead" className="focused-player__dead-state" />
        ) : (
          <>
            <div className="focused-player__active" aria-label="Active item">
              <Icon asset={p.activeItem?.asset ?? null} />
            </div>
            <span
              aria-hidden="true"
              className="focused-player__action-gap focused-player__action-gap--b"
            />
            <div className="focused-player__ammo">
              {p.clip === null ? null : <strong>{p.clip}</strong>}
              {p.clipFill === null ? null : (
                <div className="focused-player__clip-track">
                  <span style={{ width: `${p.clipFill * 100}%` }} />
                </div>
              )}
              {p.reserveText === null ? null : <span>{p.reserveText}</span>}
            </div>
          </>
        )}
      </div>

      <div className="focused-player__vitals" data-danger={p.health !== null && p.health <= 25}>
        {p.dead ? null : (
          <>
            <div className="focused-player__vitals-values">
              <strong className="focused-player__hp">{p.health ?? '—'}</strong>
              <span className="focused-player__armor">
                <Icon asset={p.armorAsset} />
                <b>{p.armor ?? '—'}</b>
              </span>
            </div>
            <div className="focused-player__health-track">
              {p.healthFill === null ? null : <span style={{ width: `${p.healthFill}%` }} />}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

export function FocusedPlayer({ snapshot }: HudWidgetRendererProps) {
  const player = buildFocusedPlayerPresentation(snapshot.payload);
  return player === null ? null : <FocusedPlayerCard player={player} />;
}
