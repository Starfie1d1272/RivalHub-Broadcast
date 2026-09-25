import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProjectionCursor } from '@rivalhub-broadcast/protocol/shared';
import type { HudWidgetRendererProps } from '../../hud-renderer-registry';
import { consecutivePresentationSamples } from '../../presentation-sample';
import type { PlayerRailAsset } from '../player-rails/presentation';
import { DeathWatermark } from '../player-rails/DeathWatermark';
import {
  buildFocusedPlayerPresentation,
  type FocusedPlayerItemKind,
  type FocusedPlayerPresentation,
} from './presentation';

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

interface ActiveItemState {
  readonly key: string;
  readonly asset: PlayerRailAsset | null;
  readonly kind: FocusedPlayerItemKind;
  readonly cursor: ProjectionCursor | null;
  readonly presentationRevision: number;
}

function ActiveItemSlot({
  player,
  cursor,
  presentationRevision,
}: {
  readonly player: FocusedPlayerPresentation;
  readonly cursor: ProjectionCursor | null;
  readonly presentationRevision: number;
}) {
  const itemKey = player.activeItem?.item?.canonicalKey ?? player.activeItem?.name ?? 'unavailable';
  const current = useMemo<ActiveItemState>(
    () => ({
      key: itemKey,
      asset: player.activeItem?.asset ?? null,
      kind: player.activeItemKind,
      cursor,
      presentationRevision,
    }),
    [itemKey, player.activeItem?.asset, player.activeItemKind, cursor, presentationRevision],
  );
  const previous = useRef(current);
  const timer = useRef<number | null>(null);
  const [outgoing, setOutgoing] = useState<ActiveItemState | null>(null);
  useEffect(() => {
    const last = previous.current;
    const changed = last.key !== current.key;
    const continuous =
      last.cursor !== null &&
      cursor !== null &&
      consecutivePresentationSamples(
        last.cursor,
        cursor,
        last.presentationRevision,
        presentationRevision,
      );
    previous.current = current;
    if (changed && continuous) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setOutgoing(last);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOutgoing(null);
      }, 120);
    } else if (changed) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setOutgoing(null);
    }
  }, [
    current,
    itemKey,
    cursor,
    cursor?.producerInstanceId,
    cursor?.liveSessionId,
    cursor?.programSourceGeneration,
    cursor?.programReceiveSequence,
    cursor?.mapEpoch,
    cursor?.runtimeSeq,
    presentationRevision,
  ]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      className="focused-player__active"
      aria-label="Active item"
      data-active-item-kind={player.activeItemKind}
      data-active-item-key={itemKey}
      data-item-transition={outgoing !== null}
    >
      {outgoing === null ? null : (
        <span
          aria-hidden="true"
          className="focused-player__item-layer focused-player__item-layer--outgoing"
          data-item-kind={outgoing.kind}
        >
          <Icon asset={outgoing.asset} />
        </span>
      )}
      <span
        className={`focused-player__item-layer${outgoing === null ? '' : ' focused-player__item-layer--incoming'}`}
        data-item-kind={player.activeItemKind}
      >
        <Icon asset={player.activeItem?.asset ?? null} />
      </span>
    </div>
  );
}

function FocusedPlayerFace({
  player: p,
  cursor,
  presentationRevision,
  outgoing = false,
  incoming = false,
}: {
  readonly player: FocusedPlayerPresentation;
  readonly cursor: ProjectionCursor | null;
  readonly presentationRevision: number;
  readonly outgoing?: boolean;
  readonly incoming?: boolean;
}) {
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState<string | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  useLayoutEffect(() => {
    const avatarUrl = p.avatarUrl;
    if (avatarUrl === null) return;
    if (displayAvatarUrl === avatarUrl || failedAvatarUrl === avatarUrl) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      setDisplayAvatarUrl(avatarUrl);
      setFailedAvatarUrl(null);
    };
    image.onerror = () => {
      if (!active) return;
      setDisplayAvatarUrl(null);
      setFailedAvatarUrl(avatarUrl);
    };
    image.src = avatarUrl;
    return () => {
      active = false;
    };
  }, [p.avatarUrl, displayAvatarUrl, failedAvatarUrl]);
  const showAvatar =
    p.avatarUrl !== null && displayAvatarUrl === p.avatarUrl && failedAvatarUrl !== p.avatarUrl;
  return (
    <div
      aria-hidden={outgoing || undefined}
      className={`focused-player__face${outgoing ? ' focused-player__face--outgoing' : ''}${incoming ? ' focused-player__face--incoming' : ''}`}
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
          {p.avatarUrl !== null && failedAvatarUrl !== p.avatarUrl ? (
            <img
              src={p.avatarUrl}
              alt={`${p.displayName} avatar`}
              style={{ visibility: showAvatar ? 'visible' : 'hidden' }}
              onLoad={() => {
                setDisplayAvatarUrl(p.avatarUrl);
                setFailedAvatarUrl(null);
              }}
              onError={() => {
                setDisplayAvatarUrl(null);
                setFailedAvatarUrl(p.avatarUrl);
              }}
            />
          ) : null}
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
          <div aria-label="Dead" className="focused-player__dead-state">
            <DeathWatermark className="focused-player__death-mark" />
          </div>
        ) : (
          <>
            <ActiveItemSlot
              cursor={cursor}
              player={p}
              presentationRevision={presentationRevision}
            />
            <span
              aria-hidden="true"
              className="focused-player__action-gap focused-player__action-gap--b"
            />
            <div className="focused-player__ammo">
              {p.clip === null ? null : <strong>{p.clip}</strong>}
              {p.reserveMagazine === null ? null : (
                <span
                  aria-label={`Magazines in reserve: ${p.reserveMagazine.count}`}
                  className="focused-player__reserve-magazines"
                  data-ammo-presentation="magazine"
                >
                  <span
                    aria-hidden="true"
                    className="focused-player__reserve-magazine-icon"
                    data-asset-id={p.reserveMagazine.asset.canonicalKey}
                    style={
                      {
                        '--focused-icon': `url("${p.reserveMagazine.asset.outputPath}")`,
                      } as CSSProperties
                    }
                  />
                  <span>{p.reserveMagazine.count}</span>
                </span>
              )}
              {p.reserveText === null ? null : (
                <span
                  data-ammo-presentation={
                    p.reserveText.startsWith('SHELL ') ? 'shells' : 'reserve-rounds'
                  }
                >
                  {p.reserveText}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="focused-player__vitals" data-danger={p.health !== null && p.health <= 25}>
        {p.dead ? null : (
          <div className="focused-player__vitals-values">
            <span className="focused-player__health-cluster">
              <strong className="focused-player__hp">{p.health ?? '—'}</strong>
              <span className="focused-player__health-track">
                {p.healthFill === null ? null : <span style={{ width: `${p.healthFill}%` }} />}
              </span>
            </span>
            <span className="focused-player__armor">
              <Icon asset={p.armorAsset} />
              <b>{p.armor ?? '—'}</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function FocusedPlayerCard({
  player,
  cursor = null,
  presentationRevision = 0,
}: {
  readonly player: FocusedPlayerPresentation;
  readonly cursor?: ProjectionCursor | null;
  readonly presentationRevision?: number;
}) {
  const previous = useRef<{
    readonly player: FocusedPlayerPresentation;
    readonly cursor: ProjectionCursor | null;
    readonly presentationRevision: number;
  }>({ player, cursor, presentationRevision });
  const timer = useRef<number | null>(null);
  const [outgoing, setOutgoing] = useState<FocusedPlayerPresentation | null>(null);
  useEffect(() => {
    const prior = previous.current;
    const changedIdentity = prior.player.sourcePlayerId !== player.sourcePlayerId;
    const continuous =
      prior.cursor !== null &&
      cursor !== null &&
      consecutivePresentationSamples(
        prior.cursor,
        cursor,
        prior.presentationRevision,
        presentationRevision,
      );
    previous.current = { player, cursor, presentationRevision };
    if (changedIdentity && continuous) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setOutgoing(prior.player);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOutgoing(null);
      }, 140);
    } else if (changedIdentity) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setOutgoing(null);
    }
  }, [
    player,
    cursor,
    player.sourcePlayerId,
    cursor?.producerInstanceId,
    cursor?.liveSessionId,
    cursor?.programSourceGeneration,
    cursor?.programReceiveSequence,
    cursor?.mapEpoch,
    cursor?.runtimeSeq,
    presentationRevision,
  ]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <article
      aria-label="Focused player"
      className="focused-player"
      data-focused-player={player.sourcePlayerId}
      data-side={player.side}
      data-dead={player.dead}
      data-observer-transition={outgoing !== null}
    >
      {outgoing === null ? null : (
        <FocusedPlayerFace
          key={`outgoing:${outgoing.sourcePlayerId}:${outgoing.avatarUrl ?? ''}`}
          cursor={null}
          outgoing
          player={outgoing}
          presentationRevision={presentationRevision}
        />
      )}
      <FocusedPlayerFace
        key={`current:${player.sourcePlayerId}:${player.avatarUrl ?? ''}`}
        cursor={cursor}
        incoming={outgoing !== null}
        player={player}
        presentationRevision={presentationRevision}
      />
    </article>
  );
}

export function FocusedPlayer({ snapshot, presentationRevision = 0 }: HudWidgetRendererProps) {
  const player = buildFocusedPlayerPresentation(snapshot.payload);
  return player === null ? null : (
    <FocusedPlayerCard
      cursor={snapshot.cursor}
      player={player}
      presentationRevision={presentationRevision}
    />
  );
}
