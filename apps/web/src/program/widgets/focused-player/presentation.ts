import type { ProgramPayload } from '@rivalhub-broadcast/protocol/program';
import {
  assetForCanonicalKey,
  weaponPresentation,
  utilityPresentation,
} from '../player-rails/presentation';

export function buildFocusedPlayerPresentation(payload: ProgramPayload) {
  if (payload.observedPlayerSourceId === null) return null;
  const matches = payload.players.filter(
    (p) => p.sourcePlayerId === payload.observedPlayerSourceId,
  );
  const player = matches.length === 1 ? matches[0] : undefined;
  if (
    player === undefined ||
    player.lineupEvidence !== 'current' ||
    player.state === null ||
    player.lifeState === 'unknown'
  )
    return null;
  const dead = player.lifeState === 'dead';
  const team =
    player.side === 'CT' ? payload.teams.ct : player.side === 'T' ? payload.teams.t : null;
  const hasC4 =
    !dead &&
    payload.bomb?.sourcePlayerId === player.sourcePlayerId &&
    (payload.bomb.state === 'carried' || payload.bomb.state === 'planting');
  const weapons = player.weaponsAvailable ? player.weapons.map(weaponPresentation) : [];
  const candidates = player.weaponsAvailable
    ? player.weapons.filter((w) => w.state === 'active')
    : [];
  const active = candidates.length === 1 ? candidates[0] : undefined;
  const resolved = active === undefined ? null : weaponPresentation(active);
  const activeItem =
    dead || resolved?.item == null || (resolved.item.kind === 'objective' && !hasC4)
      ? null
      : resolved;
  const firearm = activeItem?.item?.kind === 'firearm';
  const reserve = active?.ammoReserve;
  const ammoPresentation = activeItem?.item?.ammoPresentation;
  const reserveText =
    !firearm || reserve == null
      ? null
      : ammoPresentation === 'magazine'
        ? `MAG ×${reserve}`
        : ammoPresentation === 'shells'
          ? `SHELL ${reserve}`
          : ammoPresentation === 'reserve-rounds'
            ? `RDS ${reserve}`
            : null;
  return {
    sourcePlayerId: player.sourcePlayerId,
    avatarUrl: player.avatarUrl,
    displayName: player.displayName ?? 'PLAYER',
    observerSlot: player.observerSlot,
    side: player.side,
    teamName: team?.mode === 'canonical' ? team.name : (player.side ?? '—'),
    teamLogoUrl: team?.mode === 'canonical' ? team.logoUrl : null,
    dead,
    stats: {
      kills: player.matchStats?.kills ?? null,
      assists: player.matchStats?.assists ?? null,
      deaths: player.matchStats?.deaths ?? null,
    },
    completedAdr: player.completedAdr,
    health: dead ? null : player.state.health,
    healthFill:
      dead || player.state.health === null ? null : Math.max(0, Math.min(100, player.state.health)),
    armor: dead ? null : player.state.armor,
    armorAsset:
      !dead &&
      player.state.armor !== null &&
      player.state.armor > 0 &&
      player.state.hasHelmet !== null
        ? assetForCanonicalKey(
            player.state.hasHelmet ? 'equipment.armor-helmet' : 'equipment.armor',
          )
        : null,
    utility: dead ? [] : utilityPresentation(weapons),
    zeus: dead ? null : (weapons.find((w) => w.item?.canonicalKey === 'utility.taser') ?? null),
    kit:
      !dead && player.state.hasDefuser === true
        ? assetForCanonicalKey('equipment.defuse-kit')
        : null,
    c4: hasC4 ? assetForCanonicalKey('objective.c4') : null,
    activeItem,
    clip: firearm ? (active?.ammoClip ?? null) : null,
    clipFill:
      firearm &&
      active?.ammoClip != null &&
      active.ammoClipMax !== null &&
      Number.isFinite(active.ammoClipMax) &&
      active.ammoClipMax > 0
        ? Math.max(0, Math.min(1, active.ammoClip / active.ammoClipMax))
        : null,
    reserveText,
  };
}
export type FocusedPlayerPresentation = NonNullable<
  ReturnType<typeof buildFocusedPlayerPresentation>
>;
