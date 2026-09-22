/** Presentation shell adapted from Lexogrine Observed.tsx / observed.scss,
 * cs2-react-hud@7874750c97fcecd8f72eb3fad382917e035ec651 (MIT).
 * Program identity and official asset/ammo metadata replace donor ownership. */
import { useState, type CSSProperties } from 'react';
import type { HudWidgetRendererProps } from '../../hud-renderer-registry';
import type { PlayerRailAsset } from '../player-rails/presentation';
import { buildFocusedPlayerPresentation, type FocusedPlayerPresentation } from './presentation';

function Icon({
  asset,
  active = false,
}: {
  readonly asset: PlayerRailAsset | null;
  readonly active?: boolean;
}) {
  return asset === null ? null : (
    <span
      className="focused-player__icon"
      role="img"
      aria-label={asset.canonicalKey}
      data-asset-id={asset.canonicalKey}
      data-active={active}
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
      aria-label="当前观察选手"
      className="focused-player"
      data-focused-player={p.sourcePlayerId}
      data-avatar={showAvatar}
      data-side={p.side}
      data-dead={p.dead}
    >
      <div className="focused-player__media" data-avatar-slot="true">
        {p.avatarUrl === null || avatarFailed ? null : (
          <img
            src={p.avatarUrl}
            alt={`${p.displayName} 头像`}
            style={{ display: showAvatar ? undefined : 'none' }}
            onLoad={() => setAvatarLoaded(true)}
            onError={() => setAvatarFailed(true)}
          />
        )}
        <span className="focused-player__slot">{p.observerSlot ?? '—'}</span>
      </div>
      <div className="focused-player__identity">
        <div className="focused-player__name-row">
          <strong title={p.displayName}>{p.displayName}</strong>
        </div>
        <div className="focused-player__metrics">
          <span>
            <small>K</small>
            {p.stats.kills ?? '—'}
          </span>
          <span>
            <small>A</small>
            {p.stats.assists ?? '—'}
          </span>
          <span>
            <small>D</small>
            {p.stats.deaths ?? '—'}
          </span>
          <span>
            <small>ADR</small>
            {p.completedAdr === null ? '—' : Number(p.completedAdr.toFixed(1))}
          </span>
        </div>
      </div>
      <div className="focused-player__combat">
        {p.dead ? (
          <strong className="focused-player__dead">DEAD</strong>
        ) : (
          <>
            <div
              className="focused-player__vitals"
              data-danger={p.health !== null && p.health <= 25}
            >
              <strong>
                {p.health ?? '—'}
                <small>HP</small>
              </strong>
              {p.armorAsset === null ? null : (
                <span>
                  <Icon asset={p.armorAsset} />
                  {p.armor}
                </span>
              )}
              <div className="focused-player__health-track">
                {p.healthFill === null ? null : <span style={{ width: `${p.healthFill}%` }} />}
              </div>
            </div>
            <div className="focused-player__active">
              {p.activeItem === null ? (
                <span className="focused-player__unavailable">—</span>
              ) : (
                <Icon asset={p.activeItem.asset} />
              )}
            </div>
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
    </article>
  );
}
export function FocusedPlayer({ snapshot }: HudWidgetRendererProps) {
  const player = buildFocusedPlayerPresentation(snapshot.payload);
  return player === null ? null : <FocusedPlayerCard player={player} />;
}
