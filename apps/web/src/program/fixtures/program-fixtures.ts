import { LOCAL_PROTOCOL_VERSION, PROGRAM_SCHEMA_VERSION } from '@rivalhub-broadcast/protocol';
import {
  programSnapshotSchema,
  type ProgramPayload,
  type ProgramSnapshot,
} from '@rivalhub-broadcast/protocol/program';

export const PROGRAM_FIXTURE_IDS = [
  'awaiting-neutral',
  'live-neutral',
  'live-canonical',
  'context-stale',
  'identity-degraded',
  'identity-mismatch',
  'bomb-planted',
  'bomb-defusing',
  'timeout-ct',
  'stress-long-labels',
] as const;

export type ProgramFixtureId = (typeof PROGRAM_FIXTURE_IDS)[number];

type ProgramPlayer = ProgramPayload['players'][number];
type PlayerState = NonNullable<ProgramPlayer['state']>;
type MatchStats = NonNullable<ProgramPlayer['matchStats']>;
type ProgramWeapon = ProgramPlayer['weapons'][number];
type ProgramTeam = ProgramPayload['teams']['ct'];
type ProgramMatch = NonNullable<ProgramPayload['match']>;
type LiveStatus = ProgramPayload['status'];

const FIXTURE_CURSOR = {
  producerInstanceId: 'fixture-producer',
  liveSessionId: 'fixture-session',
  runtimeSeq: 42,
  programSourceGeneration: 1,
  programReceiveSequence: 42,
  mapEpoch: 1,
} as const;

const LIVE_COVERAGE = {
  map: 'present',
  round: 'present',
  phaseCountdowns: 'present',
  player: 'present',
  allPlayers: 'present',
  bomb: 'absent',
} satisfies ProgramPayload['coverage'];

const BOMB_COVERAGE: ProgramPayload['coverage'] = { ...LIVE_COVERAGE, bomb: 'present' };

const DEFAULT_PLAYER_STATE: PlayerState = {
  health: 100,
  armor: 100,
  hasHelmet: true,
  hasDefuser: false,
  flashed: 0,
  smoked: 0,
  burning: 0,
  money: 4_200,
  roundTotalDamage: 0,
  roundKills: 0,
  roundKillHeadshots: 0,
  equipValue: 3_900,
};

const DEFAULT_MATCH_STATS: MatchStats = {
  kills: 12,
  assists: 3,
  deaths: 8,
  mvps: 2,
  score: 15,
};

function neutralTeam(name: 'CT' | 'T'): ProgramTeam {
  return {
    mode: 'neutral',
    entryId: null,
    name,
    logoUrl: null,
    seriesScore: null,
  };
}

function canonicalTeam(entryId: string, name: string, seriesScore: number | null): ProgramTeam {
  return {
    mode: 'canonical',
    entryId,
    name,
    logoUrl: null,
    seriesScore,
  };
}

function makeWeapon(
  sourceWeaponId: string,
  name: string,
  state: NonNullable<ProgramWeapon['state']>,
): ProgramWeapon {
  return {
    sourceWeaponId,
    name,
    paintKit: null,
    type: 'rifle',
    ammoClip: 30,
    ammoClipMax: 30,
    ammoReserve: 90,
    state,
  };
}

function makePlayer(
  sourcePlayerId: string,
  side: 'CT' | 'T',
  observerSlot: number,
  overrides: Partial<ProgramPlayer> = {},
): ProgramPlayer {
  return {
    sourcePlayerId,
    canonicalPlayerId: null,
    displayName: sourcePlayerId,
    displayNameSource: 'observed',
    avatarUrl: null,
    side,
    observerSlot,
    activity: 'playing',
    lifeState: 'alive',
    state: { ...DEFAULT_PLAYER_STATE },
    matchStats: { ...DEFAULT_MATCH_STATS },
    weapons: [],
    ...overrides,
  };
}

function observedPlayers(): ProgramPlayer[] {
  return Array.from({ length: 10 }, (_, index) => {
    const side = index < 5 ? 'CT' : 'T';
    const slot = index + 1;
    return makePlayer(`fixture-player-${side.toLowerCase()}-${slot}`, side, slot, {
      displayName: `Observed ${side} ${String(slot).padStart(2, '0')}`,
    });
  });
}

function canonicalPlayers(): ProgramPlayer[] {
  const names = ['Astra', 'Boreal', 'Cinder', 'Drift', 'Ember'];
  return observedPlayers().map((player, index) => {
    const side = index < 5 ? 'ct' : 't';
    const playerSide = index < 5 ? 'CT' : 'T';
    const name = names[index % names.length] ?? 'Player';
    return makePlayer(player.sourcePlayerId, playerSide, index + 1, {
      canonicalPlayerId: `fixture-canonical-${side}-${index % 5}`,
      displayName: `${name} ${player.side}`,
      displayNameSource: 'canonical',
      state: player.state,
      matchStats: player.matchStats,
      weapons: player.weapons,
    });
  });
}

function fixtureMatch(overrides: Partial<ProgramMatch> = {}): ProgramMatch {
  return {
    matchId: 'fixture-match-bo3',
    competition: {
      competitionId: 'fixture-competition',
      slug: 'fixture-spring-major',
      name: 'Fixture Spring Major',
      themeColor: null,
    },
    format: 'bo3',
    stage: 'Playoffs',
    ...overrides,
  };
}

function makeLivePayload({
  context = 'unbound',
  identity = 'unbound',
  match = null,
  teams = { ct: neutralTeam('CT'), t: neutralTeam('T') },
  players = observedPlayers(),
  mapName = 'de_ancient',
  mapMode = 'competitive',
  mapPhase = 'live',
  roundNumber = 12,
  score = { ct: 6, t: 5 },
  round = { phase: 'live', winnerSide: 'unknown' },
  clock = { phase: 'live', endsInSeconds: 74 },
  observedPlayerSourceId = players[0]?.sourcePlayerId ?? null,
  bomb = null,
  coverage = LIVE_COVERAGE,
}: {
  readonly context?: LiveStatus['context'];
  readonly identity?: LiveStatus['identity'];
  readonly match?: ProgramPayload['match'];
  readonly teams?: ProgramPayload['teams'];
  readonly players?: ProgramPlayer[];
  readonly mapName?: string | null;
  readonly mapMode?: string | null;
  readonly mapPhase?: ProgramPayload['map']['phase'];
  readonly roundNumber?: number | null;
  readonly score?: ProgramPayload['map']['score'];
  readonly round?: ProgramPayload['round'];
  readonly clock?: ProgramPayload['clock'];
  readonly observedPlayerSourceId?: string | null;
  readonly bomb?: ProgramPayload['bomb'];
  readonly coverage?: ProgramPayload['coverage'];
} = {}): ProgramPayload {
  return {
    status: { telemetry: 'fresh', context, identity },
    match,
    teams,
    map: {
      name: mapName,
      mode: mapMode,
      phase: mapPhase,
      roundNumber,
      score,
      timeoutsRemaining: { ct: 1, t: 2 },
    },
    round,
    clock,
    observedPlayerSourceId,
    players,
    bomb,
    coverage,
  };
}

function makeSnapshot(payload: ProgramPayload): ProgramSnapshot {
  return programSnapshotSchema.parse({
    type: 'snapshot',
    protocolVersion: LOCAL_PROTOCOL_VERSION,
    channel: 'program',
    schemaVersion: PROGRAM_SCHEMA_VERSION,
    channelSeq: 1,
    cursor: FIXTURE_CURSOR,
    payload,
  });
}

function awaitingPayload(): ProgramPayload {
  return {
    status: { telemetry: 'awaiting', context: 'unbound', identity: 'unbound' },
    match: null,
    teams: { ct: neutralTeam('CT'), t: neutralTeam('T') },
    map: {
      name: null,
      mode: null,
      phase: null,
      roundNumber: null,
      score: { ct: null, t: null },
      timeoutsRemaining: { ct: null, t: null },
    },
    round: null,
    clock: null,
    observedPlayerSourceId: null,
    players: [],
    bomb: null,
    coverage: {
      map: 'absent',
      round: 'absent',
      phaseCountdowns: 'absent',
      player: 'absent',
      allPlayers: 'absent',
      bomb: 'absent',
    },
  };
}

const canonicalTeams = {
  ct: canonicalTeam('fixture-entry-a', 'Northstar', 1),
  t: canonicalTeam('fixture-entry-b', 'Southpoint', 0),
};

const staleCanonicalTeams = {
  ct: canonicalTeam('fixture-entry-a', 'Northstar', null),
  t: canonicalTeam('fixture-entry-b', 'Southpoint', null),
};

const canonicalPayload = makeLivePayload({
  context: 'fresh',
  identity: 'matched',
  match: fixtureMatch(),
  teams: canonicalTeams,
  players: canonicalPlayers(),
  observedPlayerSourceId: 'fixture-player-ct-1',
});

const degradedPlayers = observedPlayers().map((player, index) => {
  if (index >= 2) return player;
  const side = index < 5 ? 'ct' : 't';
  const playerSide = index < 5 ? 'CT' : 'T';
  return makePlayer(player.sourcePlayerId, playerSide, index + 1, {
    canonicalPlayerId: `fixture-canonical-${side}-${index}`,
    displayName: `Partially verified ${player.side} ${index + 1}`,
    displayNameSource: 'canonical',
    state: player.state,
    matchStats: player.matchStats,
    weapons: player.weapons,
  });
});

const stressPlayers = [
  'AsterionLongNameAlpha',
  'BorealisLongNameBravo',
  'CinderblockLongNameCharlie',
  'DriftwoodLongNameDelta',
  'EmberglassLongNameEcho',
  'FrostlineLongNameFoxtrot',
  'GraniteLongNameGolf',
  'HalcyonLongNameHotel',
  'IronwoodLongNameIndia',
  'JuniperLongNameJuliett',
].map((displayName, index) => {
  const side = index < 5 ? 'CT' : 'T';
  const health = [100, 48, 0, null, 76][index % 5] ?? null;
  const state: PlayerState = {
    ...DEFAULT_PLAYER_STATE,
    health,
    armor: [100, 62, 0, null, 18][index % 5] ?? null,
    hasHelmet: index % 4 !== 3,
    hasDefuser: side === 'CT' && index % 2 === 0,
    flashed: index === 1 ? 1.2 : 0,
    smoked: index === 7 ? 4.5 : 0,
    burning: index === 2 ? 2.1 : 0,
    money: [16_000, 2_400, 0, null, 8_750][index % 5] ?? null,
    roundTotalDamage: [128, 64, 0, null, 91][index % 5] ?? null,
    roundKills: [2, 1, 0, null, 3][index % 5] ?? null,
    roundKillHeadshots: [1, 0, 0, null, 2][index % 5] ?? null,
    equipValue: [5_400, 2_200, 0, null, 4_800][index % 5] ?? null,
  };
  return makePlayer(`stress-player-${index + 1}`, side, index + 1, {
    canonicalPlayerId: `stress-canonical-player-${index + 1}`,
    displayName,
    displayNameSource: 'canonical',
    lifeState: (['alive', 'alive', 'dead', 'unknown', 'alive'] as const)[index % 5]!,
    state,
    matchStats: {
      kills: [18, 11, 4, null, 22][index % 5] ?? null,
      assists: [6, 2, 0, null, 7][index % 5] ?? null,
      deaths: [9, 13, 16, null, 5][index % 5] ?? null,
      mvps: [3, 1, 0, null, 4][index % 5] ?? null,
      score: [24, 15, 5, null, 31][index % 5] ?? null,
    },
    weapons:
      index % 2 === 0
        ? [makeWeapon(`stress-weapon-${index + 1}`, 'AK-47', 'active')]
        : [
            makeWeapon(`stress-weapon-${index + 1}`, 'M4A1-S', 'active'),
            {
              ...makeWeapon(`stress-pistol-${index + 1}`, 'USP-S', 'holstered'),
              type: 'pistol',
              ammoClip: 12,
              ammoClipMax: 12,
              ammoReserve: 24,
            },
          ],
  });
});

const stressMatch = fixtureMatch({
  competition: {
    competitionId: 'fixture-competition-stress',
    slug: 'fixture-long-label-competition',
    name: 'International Championship Qualifier With An Intentionally Long Competition Name',
    themeColor: null,
  },
  stage: 'Long Stage Name For Overflow And Layout Regression Coverage',
});

const fixtureRecord = {
  'awaiting-neutral': makeSnapshot(awaitingPayload()),
  'live-neutral': makeSnapshot(
    makeLivePayload({
      context: 'unbound',
      identity: 'unbound',
      score: { ct: 3, t: 2 },
      roundNumber: 6,
      clock: { phase: 'live', endsInSeconds: 51 },
    }),
  ),
  'live-canonical': makeSnapshot(canonicalPayload),
  'context-stale': makeSnapshot(
    makeLivePayload({
      context: 'stale',
      identity: 'matched',
      match: fixtureMatch(),
      teams: staleCanonicalTeams,
      players: canonicalPlayers(),
      observedPlayerSourceId: 'fixture-player-t-8',
      clock: { phase: 'live', endsInSeconds: 38 },
    }),
  ),
  'identity-degraded': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'degraded',
      match: fixtureMatch(),
      teams: { ct: neutralTeam('CT'), t: neutralTeam('T') },
      players: degradedPlayers,
      coverage: { ...LIVE_COVERAGE, allPlayers: 'degraded' },
    }),
  ),
  'identity-mismatch': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'mismatch',
      match: fixtureMatch(),
      teams: { ct: neutralTeam('CT'), t: neutralTeam('T') },
      players: observedPlayers(),
      observedPlayerSourceId: 'fixture-player-t-10',
    }),
  ),
  'bomb-planted': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      players: canonicalPlayers(),
      clock: { phase: 'bomb', endsInSeconds: 28 },
      bomb: { state: 'planted', sourcePlayerId: null, countdownSeconds: 28 },
      coverage: BOMB_COVERAGE,
    }),
  ),
  'bomb-defusing': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      players: canonicalPlayers(),
      clock: { phase: 'defuse', endsInSeconds: 4 },
      bomb: { state: 'defusing', sourcePlayerId: 'fixture-player-ct-2', countdownSeconds: 4 },
      coverage: BOMB_COVERAGE,
    }),
  ),
  'timeout-ct': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      players: canonicalPlayers(),
      clock: { phase: 'timeout_ct', endsInSeconds: 25 },
      round: { phase: 'freezetime', winnerSide: 'unknown' },
    }),
  ),
  'stress-long-labels': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: stressMatch,
      teams: {
        ct: canonicalTeam(
          'fixture-entry-long-a',
          'Northstar International Academy Development Roster',
          1,
        ),
        t: canonicalTeam(
          'fixture-entry-long-b',
          'Southpoint Competitive Collective Select Division',
          0,
        ),
      },
      players: stressPlayers,
      roundNumber: 19,
      score: { ct: 10, t: 8 },
      clock: { phase: 'live', endsInSeconds: 17 },
    }),
  ),
} satisfies Readonly<Record<ProgramFixtureId, ProgramSnapshot>>;

export const programFixtures: Readonly<Record<ProgramFixtureId, ProgramSnapshot>> = fixtureRecord;

export function getProgramFixture(id: string): ProgramSnapshot | null {
  return Object.prototype.hasOwnProperty.call(programFixtures, id)
    ? programFixtures[id as ProgramFixtureId]
    : null;
}
