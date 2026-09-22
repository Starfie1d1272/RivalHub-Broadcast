import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';
import type { RadarSnapshot } from '@rivalhub-broadcast/protocol/radar';
import { getProgramFixture } from './program-fixtures';
import { radarVisualFixture } from './radar-fixtures';
import {
  DEFAULT_HUD_COMPOSITE_FIXTURES,
  type DefaultHudCompositeFixture,
} from './default-hud-composite-ids';

export { DEFAULT_HUD_COMPOSITE_FIXTURES };
export type { DefaultHudCompositeFixture };

export interface DefaultHudCompositeSnapshot {
  readonly id: DefaultHudCompositeFixture;
  readonly snapshot: ProgramSnapshot;
  readonly radarSnapshot: RadarSnapshot;
  readonly provenance: 'real-derived' | 'synthetic-edge';
}

const SOURCES: Record<DefaultHudCompositeFixture, string> = {
  'default-live-5v5': 'live-canonical',
  'default-avatar-present': 'live-canonical',
  'default-avatar-missing': 'live-canonical',
  'default-freezetime': 'player-rails-freezetime',
  'default-observed': 'player-rails-dead-observed',
  'default-dead': 'player-rails-dead-observed',
  'default-low-hp': 'live-canonical',
  'default-planted': 'real-planted',
  'default-critical': 'real-planted',
  'default-defusing': 'real-defusing',
  'default-timeout': 'series-timeout-a',
  'default-tech-pause': 'real-paused',
  'default-halftime': 'series-halftime-swap',
  'default-nuke-multifloor': 'live-canonical',
  'default-missing-logo': 'series-logo-mixed',
};

const AVATAR_COLORS = [
  ['#3b607a', '#d9ad83', '#192e3b'],
  ['#634f78', '#b77e66', '#32233f'],
  ['#3c6c5c', '#e2c19b', '#263c37'],
  ['#806649', '#9f6657', '#3d3027'],
  ['#39587d', '#c99079', '#273449'],
  ['#815255', '#d7b08b', '#412c33'],
  ['#496f7e', '#a8755e', '#283d49'],
  ['#706142', '#dfb997', '#3b3525'],
  ['#47556e', '#b87d65', '#282f40'],
  ['#4f7054', '#e1bd9b', '#2b3b2c'],
] as const;

function deterministicAvatar(index: number): string {
  const [background, skin, clothing] = AVATAR_COLORS[index % AVATAR_COLORS.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="78" height="78" viewBox="0 0 78 78"><rect width="78" height="78" fill="${background}"/><path d="M5 78c3-20 15-29 34-29s31 9 34 29" fill="${clothing}"/><path d="M24 29c0-13 6-21 16-21s16 8 16 21v8c0 12-7 21-16 21s-16-9-16-21z" fill="${skin}"/><path d="M22 30c0-17 8-25 19-25 10 0 17 6 18 20-7-2-11-8-13-12-5 8-13 13-24 14z" fill="${clothing}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function sourceSnapshot(id: DefaultHudCompositeFixture): ProgramSnapshot {
  const snapshot = getProgramFixture(SOURCES[id]);
  if (snapshot === null) throw new Error(`Default HUD source fixture is missing: ${SOURCES[id]}`);
  return structuredClone(snapshot);
}

function mutateProgram(id: DefaultHudCompositeFixture, snapshot: ProgramSnapshot): void {
  if (id === 'default-avatar-present') {
    snapshot.payload.players.forEach((player, index) => {
      player.avatarUrl = deterministicAvatar(index);
    });
  }
  if (id === 'default-observed' || id === 'default-low-hp') {
    const player = snapshot.payload.players.find(
      (candidate) => candidate.sourcePlayerId === snapshot.payload.observedPlayerSourceId,
    );
    if (player?.state) player.state.roundKills = 2;
  }
  if (id === 'default-low-hp') {
    const player = snapshot.payload.players.find(
      (candidate) => candidate.lifeState === 'alive' && candidate.state !== null,
    );
    if (player?.state) player.state.health = 20;
  }
  if (id === 'default-critical') {
    const explosion = snapshot.payload.bomb?.explosion;
    if (explosion) explosion.remainingSeconds = 8;
  }
  if (id === 'default-nuke-multifloor') {
    snapshot.payload.map.name = 'de_nuke';
  }
  if (id === 'default-missing-logo' && snapshot.payload.series !== null) {
    snapshot.payload.series.entrants.a.logoUrl = null;
    snapshot.payload.series.entrants.b.logoUrl = null;
  }
}

export function getDefaultHudCompositeFixture(id: string): DefaultHudCompositeSnapshot | null {
  if (!DEFAULT_HUD_COMPOSITE_FIXTURES.includes(id as DefaultHudCompositeFixture)) return null;
  const fixtureId = id as DefaultHudCompositeFixture;
  const snapshot = sourceSnapshot(fixtureId);
  mutateProgram(fixtureId, snapshot);
  const radarId = fixtureId === 'default-nuke-multifloor' ? 'nuke-upper' : 'focused';
  const radarSnapshot = structuredClone(radarVisualFixture(radarId).snapshot);
  if (fixtureId === 'default-nuke-multifloor') {
    radarSnapshot.payload.players.forEach((player, index) => {
      if (player.position !== null) player.position.z = index % 2 === 0 ? 0 : -600;
    });
  }
  return {
    id: fixtureId,
    snapshot,
    radarSnapshot,
    provenance:
      fixtureId === 'default-avatar-present' ||
      fixtureId === 'default-low-hp' ||
      fixtureId === 'default-critical' ||
      fixtureId === 'default-nuke-multifloor' ||
      fixtureId === 'default-missing-logo'
        ? 'synthetic-edge'
        : 'real-derived',
  };
}
