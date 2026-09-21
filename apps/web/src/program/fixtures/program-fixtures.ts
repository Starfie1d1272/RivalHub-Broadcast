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
  'series-bo1',
  'series-bo3-map1',
  'series-bo5',
  'series-not-played',
  'series-logo-mixed',
  'series-halftime-swap',
  'series-timeout-a',
  'series-timeout-b',
  'series-paused',
  'series-decider',
  'series-partial-history',
  'series-history-unavailable',
  'series-mapping-unavailable',
  'series-round-unavailable',
  'series-overtime-history',
  'series-long-labels',
] as const;

export type ProgramFixtureId = (typeof PROGRAM_FIXTURE_IDS)[number];

export const PROGRAM_FIXTURE_LABELS: Readonly<Record<ProgramFixtureId, string>> = {
  'awaiting-neutral': '等待初始状态',
  'live-neutral': '实时中 · 未绑定队伍',
  'live-canonical': '实时中 · 已匹配队伍',
  'context-stale': '比赛上下文过期',
  'identity-degraded': '选手身份部分确认',
  'identity-mismatch': '选手身份不匹配',
  'bomb-planted': '炸弹已安装',
  'bomb-defusing': '正在拆弹',
  'timeout-ct': 'CT 暂停',
  'stress-long-labels': '长名称压力场景',
  'series-bo1': 'BO1 系列赛',
  'series-bo3-map1': 'BO3 · Map 1',
  'series-bo5': 'BO5 中盘',
  'series-not-played': '系列赛未进行地图',
  'series-logo-mixed': '队伍 Logo 有/无',
  'series-halftime-swap': '半场换边',
  'series-timeout-a': 'A 队战术暂停',
  'series-timeout-b': 'B 队战术暂停',
  'series-paused': '比赛暂停',
  'series-decider': '决胜图',
  'series-partial-history': '回合历史不完整',
  'series-history-unavailable': '回合历史不可用',
  'series-mapping-unavailable': '队伍映射暂不可用',
  'series-round-unavailable': '回合编号不可用',
  'series-overtime-history': '加时回合密度',
  'series-long-labels': '系列赛长名称压力场景',
};

type ProgramPlayer = ProgramPayload['players'][number];
type PlayerState = NonNullable<ProgramPlayer['state']>;
type MatchStats = NonNullable<ProgramPlayer['matchStats']>;
type ProgramWeapon = ProgramPlayer['weapons'][number];
type ProgramTeam = ProgramPayload['teams']['ct'];
type ProgramMatch = NonNullable<ProgramPayload['match']>;
type LiveStatus = ProgramPayload['status'];
type ProgramSeries = NonNullable<ProgramPayload['series']>;

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

function canonicalTeam(
  entryId: string,
  name: string,
  seriesScore: number | null,
  logoUrl: string | null = null,
): ProgramTeam {
  return {
    mode: 'canonical',
    entryId,
    name,
    logoUrl,
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
    identityEvidence: 'observed',
    lineupEvidence: 'current',
    displayName: sourcePlayerId,
    displayNameSource: 'observed',
    avatarUrl: null,
    side,
    observerSlot,
    activity: 'playing',
    lifeState: 'alive',
    liveAdr: null,
    completedAdr: null,
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
      identityEvidence: 'canonical',
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

const SERIES_ENTRANTS: ProgramSeries['entrants'] = {
  a: { entryId: 'fixture-entry-a', name: 'Northstar', logoUrl: null },
  b: { entryId: 'fixture-entry-b', name: 'Southpoint', logoUrl: null },
};

function seriesMap(
  overrides: Partial<ProgramSeries['maps'][number]> &
    Pick<ProgramSeries['maps'][number], 'mapOrder' | 'mapName'>,
): ProgramSeries['maps'][number] {
  const { mapOrder, mapName, ...rest } = overrides;
  return {
    mapId: null,
    mapOrder,
    mapName,
    selection: { kind: 'unknown' },
    teamAStartSide: null,
    status: 'pending',
    finalScore: null,
    winnerEntryId: null,
    ...rest,
  };
}

function completeRoundHistory(
  count = 12,
  entrants: ProgramSeries['entrants'] = SERIES_ENTRANTS,
  mapOrder = 2,
): NonNullable<ProgramSeries['roundHistory']> {
  return {
    mapOrder,
    completeness: 'complete',
    rounds: Array.from({ length: count }, (_, index) => {
      const winnerIsA = index % 2 === 0;
      return {
        roundNumber: index + 1,
        winnerSide: index % 3 === 0 ? 'CT' : 'T',
        winnerEntryId: winnerIsA ? entrants.a.entryId : entrants.b.entryId,
        winCondition: index % 3 === 0 ? 'elimination' : 'time',
      };
    }),
  };
}

function makeSeries({
  format = 'bo3',
  entrants = SERIES_ENTRANTS,
  score = { a: 1, b: 0 },
  currentMapOrder = 2,
  maps,
  roundHistory,
}: {
  readonly format?: ProgramSeries['format'];
  readonly entrants?: ProgramSeries['entrants'];
  readonly score?: ProgramSeries['score'];
  readonly currentMapOrder?: number | null;
  readonly maps: readonly ProgramSeries['maps'][number][];
  readonly roundHistory?: ProgramSeries['roundHistory'];
}): ProgramSeries {
  const resolvedRoundHistory =
    roundHistory ?? completeRoundHistory(12, entrants, currentMapOrder ?? 1);
  return {
    format,
    requiredWins: format === 'bo1' ? 1 : format === 'bo3' ? 2 : 3,
    entrants,
    score,
    status: 'live',
    bindingState: 'bound',
    currentMapOrder,
    maps: [...maps],
    veto: [],
    roundHistory: resolvedRoundHistory,
  };
}

const BO3_SERIES = makeSeries({
  maps: [
    seriesMap({
      mapId: 'fixture-map-1',
      mapOrder: 1,
      mapName: 'de_ancient',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.a.entryId },
      teamAStartSide: 'CT',
      status: 'completed',
      finalScore: { a: 13, b: 9 },
      winnerEntryId: SERIES_ENTRANTS.a.entryId,
    }),
    seriesMap({
      mapId: 'fixture-map-2',
      mapOrder: 2,
      mapName: 'de_mirage',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.b.entryId },
      teamAStartSide: 'T',
      status: 'current',
    }),
    seriesMap({
      mapId: 'fixture-map-3',
      mapOrder: 3,
      mapName: 'de_nuke',
      selection: { kind: 'decider' },
      status: 'pending',
    }),
  ],
});

const BO3_MAP1_SERIES = makeSeries({
  score: { a: 0, b: 0 },
  currentMapOrder: 1,
  maps: [
    seriesMap({
      mapId: 'fixture-map1-current',
      mapOrder: 1,
      mapName: 'de_ancient',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.a.entryId },
      teamAStartSide: 'CT',
      status: 'current',
    }),
    seriesMap({
      mapId: 'fixture-map1-next',
      mapOrder: 2,
      mapName: 'de_mirage',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.b.entryId },
      status: 'pending',
    }),
    seriesMap({
      mapId: 'fixture-map1-decider',
      mapOrder: 3,
      mapName: 'de_nuke',
      selection: { kind: 'decider' },
      status: 'pending',
    }),
  ],
});

const BO1_SERIES = makeSeries({
  format: 'bo1',
  score: { a: 0, b: 0 },
  currentMapOrder: 1,
  roundHistory: completeRoundHistory(8),
  maps: [
    seriesMap({
      mapId: 'fixture-bo1-map',
      mapOrder: 1,
      mapName: 'de_vertigo',
      selection: { kind: 'unknown' },
      status: 'current',
    }),
  ],
});

const BO5_SERIES = makeSeries({
  format: 'bo5',
  score: { a: 1, b: 1 },
  currentMapOrder: 3,
  maps: [
    seriesMap({
      mapId: 'fixture-bo5-map-1',
      mapOrder: 1,
      mapName: 'de_ancient',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.a.entryId },
      status: 'completed',
      finalScore: { a: 13, b: 11 },
      winnerEntryId: SERIES_ENTRANTS.a.entryId,
    }),
    seriesMap({
      mapId: 'fixture-bo5-map-2',
      mapOrder: 2,
      mapName: 'de_anubis',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.b.entryId },
      status: 'completed',
      finalScore: { a: 8, b: 13 },
      winnerEntryId: SERIES_ENTRANTS.b.entryId,
    }),
    seriesMap({
      mapId: 'fixture-bo5-map-3',
      mapOrder: 3,
      mapName: 'de_inferno',
      selection: { kind: 'unknown' },
      status: 'current',
    }),
    seriesMap({
      mapId: 'fixture-bo5-map-4',
      mapOrder: 4,
      mapName: 'de_mirage',
      selection: { kind: 'unknown' },
      status: 'pending',
    }),
    seriesMap({
      mapId: 'fixture-bo5-map-5',
      mapOrder: 5,
      mapName: 'de_nuke',
      selection: { kind: 'decider' },
      status: 'pending',
    }),
  ],
});

const NOT_PLAYED_SERIES = makeSeries({
  format: 'bo5',
  score: { a: 1, b: 0 },
  currentMapOrder: 3,
  maps: BO5_SERIES.maps.map((map) =>
    map.mapOrder === 4 ? { ...map, status: 'not_played' as const } : map,
  ),
});

const MIXED_LOGO_URL =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22 viewBox=%220 0 28 28%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%224%22 fill=%22%23888888%22/%3E%3C/svg%3E';
const MIXED_LOGO_ENTRANTS: ProgramSeries['entrants'] = {
  a: { ...SERIES_ENTRANTS.a, logoUrl: MIXED_LOGO_URL },
  b: SERIES_ENTRANTS.b,
};

const MIXED_LOGO_SERIES = makeSeries({
  entrants: MIXED_LOGO_ENTRANTS,
  maps: BO3_SERIES.maps,
});

const OVERTIME_HISTORY_SERIES = makeSeries({
  maps: BO3_SERIES.maps,
  roundHistory: completeRoundHistory(36),
});

const DECIDER_SERIES = makeSeries({
  score: { a: 1, b: 1 },
  currentMapOrder: 3,
  maps: [
    seriesMap({
      mapId: 'fixture-decider-map-1',
      mapOrder: 1,
      mapName: 'de_ancient',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.a.entryId },
      status: 'completed',
      finalScore: { a: 13, b: 6 },
      winnerEntryId: SERIES_ENTRANTS.a.entryId,
    }),
    seriesMap({
      mapId: 'fixture-decider-map-2',
      mapOrder: 2,
      mapName: 'de_anubis',
      selection: { kind: 'pick', entryId: SERIES_ENTRANTS.b.entryId },
      status: 'completed',
      finalScore: { a: 10, b: 13 },
      winnerEntryId: SERIES_ENTRANTS.b.entryId,
    }),
    seriesMap({
      mapId: 'fixture-decider-map-3',
      mapOrder: 3,
      mapName: 'de_nuke',
      selection: { kind: 'decider' },
      status: 'current',
    }),
  ],
});

const PARTIAL_HISTORY_SERIES = makeSeries({
  maps: BO3_SERIES.maps,
  roundHistory: {
    mapOrder: 2,
    completeness: 'partial',
    rounds: [
      {
        roundNumber: 3,
        winnerSide: 'CT',
        winnerEntryId: SERIES_ENTRANTS.a.entryId,
        winCondition: 'elimination',
      },
      {
        roundNumber: 5,
        winnerSide: 'unknown',
        winnerEntryId: SERIES_ENTRANTS.b.entryId,
        winCondition: 'unknown',
      },
    ],
  },
});

const UNAVAILABLE_HISTORY_SERIES = makeSeries({
  maps: BO3_SERIES.maps,
  roundHistory: { mapOrder: 2, completeness: 'unavailable', rounds: [] },
});

const LONG_SERIES: ProgramSeries = makeSeries({
  format: 'bo5',
  score: { a: 2, b: 1 },
  currentMapOrder: 4,
  entrants: {
    a: {
      entryId: 'fixture-entry-long-a',
      name: 'Northstar International Academy Development Roster',
      logoUrl: null,
    },
    b: {
      entryId: 'fixture-entry-long-b',
      name: 'Southpoint Competitive Collective Select Division',
      logoUrl: null,
    },
  },
  maps: [
    seriesMap({
      mapOrder: 1,
      mapName: 'de_ancient',
      status: 'completed',
      finalScore: { a: 13, b: 11 },
      winnerEntryId: 'fixture-entry-long-a',
    }),
    seriesMap({
      mapOrder: 2,
      mapName: 'de_anubis',
      status: 'completed',
      finalScore: { a: 10, b: 13 },
      winnerEntryId: 'fixture-entry-long-b',
    }),
    seriesMap({
      mapOrder: 3,
      mapName: 'de_inferno',
      status: 'completed',
      finalScore: { a: 13, b: 9 },
      winnerEntryId: 'fixture-entry-long-a',
    }),
    seriesMap({ mapOrder: 4, mapName: 'de_mirage', status: 'current' }),
    seriesMap({
      mapOrder: 5,
      mapName: 'de_nuke',
      selection: { kind: 'decider' },
      status: 'pending',
    }),
  ],
});

function makeLivePayload({
  context = 'unbound',
  identity = 'unbound',
  match = null,
  teams = { ct: neutralTeam('CT'), t: neutralTeam('T') },
  series = null,
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
  readonly series?: ProgramPayload['series'];
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
    series,
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
    series: null,
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

const mixedLogoTeams = {
  ct: canonicalTeam('fixture-entry-a', 'Northstar', 1, MIXED_LOGO_URL),
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
  series: BO3_SERIES,
  players: canonicalPlayers(),
  mapName: 'de_mirage',
  roundNumber: 13,
  score: { ct: 7, t: 5 },
  clock: { phase: 'live', endsInSeconds: 48 },
  observedPlayerSourceId: 'fixture-player-ct-1',
});

const degradedPlayers = observedPlayers().map((player, index) => {
  if (index >= 2) return player;
  const side = index < 5 ? 'ct' : 't';
  const playerSide = index < 5 ? 'CT' : 'T';
  return makePlayer(player.sourcePlayerId, playerSide, index + 1, {
    canonicalPlayerId: `fixture-canonical-${side}-${index}`,
    identityEvidence: 'canonical',
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
    identityEvidence: 'canonical',
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
  format: 'bo5',
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
      bomb: {
        state: 'planted',
        sourcePlayerId: null,
        explosion: { remainingSeconds: 28, durationSeconds: null },
        action: null,
      },
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
      bomb: {
        state: 'defusing',
        sourcePlayerId: 'fixture-player-ct-2',
        explosion: { remainingSeconds: 28, durationSeconds: null },
        action: {
          kind: 'defuse',
          sourcePlayerId: 'fixture-player-ct-2',
          remainingSeconds: 4,
          durationSeconds: 10,
          hasDefuseKit: false,
        },
      },
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
      series: LONG_SERIES,
      players: stressPlayers,
      roundNumber: 19,
      score: { ct: 10, t: 8 },
      clock: { phase: 'live', endsInSeconds: 17 },
    }),
  ),
  'series-bo1': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch({ format: 'bo1' }),
      teams: canonicalTeams,
      series: BO1_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_vertigo',
      roundNumber: 8,
      score: { ct: 4, t: 4 },
      clock: { phase: 'freezetime', endsInSeconds: 12 },
    }),
  ),
  'series-bo3-map1': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: BO3_MAP1_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_ancient',
      roundNumber: 1,
      score: { ct: 0, t: 0 },
      clock: { phase: 'freezetime', endsInSeconds: 12 },
    }),
  ),
  'series-bo5': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch({ format: 'bo5' }),
      teams: canonicalTeams,
      series: BO5_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_inferno',
      roundNumber: 18,
      score: { ct: 9, t: 8 },
      clock: { phase: 'live', endsInSeconds: 36 },
    }),
  ),
  'series-not-played': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch({ format: 'bo5' }),
      teams: canonicalTeams,
      series: NOT_PLAYED_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_inferno',
      roundNumber: 18,
      score: { ct: 9, t: 8 },
      clock: { phase: 'live', endsInSeconds: 36 },
    }),
  ),
  'series-logo-mixed': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: mixedLogoTeams,
      series: MIXED_LOGO_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 13,
      score: { ct: 7, t: 5 },
      clock: { phase: 'live', endsInSeconds: 48 },
    }),
  ),
  'series-halftime-swap': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: {
        ct: canonicalTeam('fixture-entry-b', 'Southpoint', 0),
        t: canonicalTeam('fixture-entry-a', 'Northstar', 1),
      },
      series: BO3_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 13,
      score: { ct: 5, t: 7 },
      clock: { phase: 'live', endsInSeconds: 48 },
    }),
  ),
  'series-timeout-a': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: BO3_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 14,
      score: { ct: 8, t: 6 },
      clock: { phase: 'timeout_ct', endsInSeconds: 22 },
    }),
  ),
  'series-timeout-b': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: BO3_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 14,
      score: { ct: 8, t: 6 },
      clock: { phase: 'timeout_t', endsInSeconds: 22 },
    }),
  ),
  'series-paused': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: BO3_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 14,
      score: { ct: 8, t: 6 },
      clock: { phase: 'paused', endsInSeconds: 0 },
    }),
  ),
  'series-decider': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: DECIDER_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_nuke',
      roundNumber: 27,
      score: { ct: 12, t: 11 },
      clock: { phase: 'live', endsInSeconds: 63 },
    }),
  ),
  'series-partial-history': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: PARTIAL_HISTORY_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 5,
      score: { ct: 3, t: 2 },
      clock: { phase: 'live', endsInSeconds: 51 },
    }),
  ),
  'series-history-unavailable': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: UNAVAILABLE_HISTORY_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 5,
      score: { ct: 3, t: 2 },
      clock: { phase: 'live', endsInSeconds: 51 },
    }),
  ),
  'series-mapping-unavailable': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'degraded',
      match: fixtureMatch(),
      teams: { ct: neutralTeam('CT'), t: neutralTeam('T') },
      series: BO3_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 13,
      score: { ct: 7, t: 5 },
      clock: { phase: 'timeout_ct', endsInSeconds: 22 },
    }),
  ),
  'series-round-unavailable': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: BO3_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: null,
      score: { ct: 7, t: 5 },
      clock: { phase: 'live', endsInSeconds: 48 },
    }),
  ),
  'series-overtime-history': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: fixtureMatch(),
      teams: canonicalTeams,
      series: OVERTIME_HISTORY_SERIES,
      players: canonicalPlayers(),
      mapName: 'de_mirage',
      roundNumber: 36,
      score: { ct: 15, t: 14 },
      clock: { phase: 'live', endsInSeconds: 48 },
    }),
  ),
  'series-long-labels': makeSnapshot(
    makeLivePayload({
      context: 'fresh',
      identity: 'matched',
      match: stressMatch,
      teams: {
        ct: canonicalTeam(
          'fixture-entry-long-a',
          'Northstar International Academy Development Roster',
          2,
        ),
        t: canonicalTeam(
          'fixture-entry-long-b',
          'Southpoint Competitive Collective Select Division',
          1,
        ),
      },
      series: LONG_SERIES,
      players: stressPlayers,
      mapName: 'de_mirage',
      roundNumber: 22,
      score: { ct: 11, t: 9 },
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
