export const REAL_DERIVED_PROVENANCE = {
  fixtureKind: 'sanitized-real-derived',
  sourceCaptureId: 'roundsense-economy-runtime-20260807',
  sourceCaptureFramesSha256: 'beb711e09b4a9fcb7dca9c1b44cfd1699cecf7ed4a101a74ae69d995529646cb',
  sourceFrameSequence: 2,
  sourceFrameRange: 'seq=2..2',
  sanitization:
    'steamid -> fixture-player-ct-1; name -> Fixture Real-Derived Player; outer capture envelope omitted; provider timestamp and source fields retained',
} as const;

export const REAL_DERIVED_FRAME = {
  provider: {
    name: 'Counter-Strike: Global Offensive',
    appid: 730,
    version: 14174,
    timestamp: 1786117842,
  },
  map: {
    name: 'de_mirage',
    mode: 'competitive',
    phase: 'live',
    round: 0,
    team_ct: {
      score: 0,
      consecutive_round_losses: 1,
      matches_won_this_series: 0,
      timeouts_remaining: 1,
    },
    team_t: {
      score: 0,
      consecutive_round_losses: 1,
      matches_won_this_series: 0,
      timeouts_remaining: 1,
    },
    num_matches_to_win_series: 0,
  },
  round: {
    phase: 'freezetime',
  },
  player: {
    steamid: 'fixture-player-ct-1',
    name: 'Fixture Real-Derived Player',
    activity: 'playing',
    observer_slot: 0,
    team: 'CT',
    state: {
      health: 100,
      armor: 0,
      helmet: false,
      flashed: 0,
      smoked: 0,
      burning: 0,
      money: 800,
      round_kills: 0,
      round_killhs: 0,
      equip_value: 200,
    },
    weapons: {
      weapon_0: {
        name: 'weapon_knife',
        paintkit: 'default',
        type: 'Knife',
        state: 'holstered',
      },
      weapon_1: {
        name: 'weapon_hkp2000',
        paintkit: 'default',
        type: 'Pistol',
        ammo_clip: 13,
        ammo_reserve: 4,
        state: 'active',
        ammo_clip_max: 13,
      },
    },
    match_stats: {
      kills: 0,
      assists: 0,
      deaths: 0,
      mvps: 0,
      score: 0,
    },
  },
  previously: {
    map: { phase: 'warmup' },
  },
} as const;
