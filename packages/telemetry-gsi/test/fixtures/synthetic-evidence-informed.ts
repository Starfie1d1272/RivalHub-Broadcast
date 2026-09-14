export const SYNTHETIC_EVIDENCE_INFORMED_PROVENANCE = {
  fixtureKind: 'synthetic-evidence-informed',
  sourceCaptureId: '20260913T162802Z-3f41d8df',
  sourceCaptureFramesSha256: 'e34505e2626dfa6f0941b8b4ed675dbea38e2ff53e29e3240c36ad7a2673d218',
  sourceFrame: 'synthetic composition from documented source facts; no single source frame',
  sourceFrameSequence: null,
  sourceFrameRange: null,
  sanitization:
    'not a sanitized raw frame; source ids, display names, and provider timestamp are intentionally fixture values',
} as const;

export const SYNTHETIC_EVIDENCE_INFORMED_OBSERVER_FRAME = {
  provider: {
    name: 'CS2',
    appid: 730,
    version: 14181,
    timestamp: 1726220000,
  },
  map: {
    mode: 'competitive',
    name: 'de_mirage',
    phase: 'live',
    round: 7,
    team_ct: {
      name: 'Fixture CT',
      score: 4,
      timeouts_remaining: 1,
    },
    team_t: {
      name: 'Fixture T',
      score: 3,
      timeouts_remaining: 1,
    },
  },
  round: {
    phase: 'live',
    bomb: 'planted',
    win_team: 'T',
  },
  phase_countdowns: {
    phase: 'bomb',
    phase_ends_in: '32.5',
  },
  player: {
    steamid: 'fixture-player-ct-1',
    name: 'Fixture Observer',
    team: 'CT',
    observer_slot: 1,
    activity: 'playing',
    state: {
      health: 100,
      armor: 0,
      helmet: false,
      defusekit: false,
      flashed: 0,
      smoked: 0,
      burning: 0,
      money: 4200,
      round_kills: 0,
      round_killhs: 0,
      equip_value: 3900,
    },
    match_stats: {
      kills: 8,
      assists: 2,
      deaths: 5,
      mvps: 1,
      score: 52,
    },
    weapons: {
      weapon_0: {
        name: 'weapon_m4a1_silencer',
        type: 'Rifle',
        ammo_clip: 20,
        ammo_clip_max: 25,
        ammo_reserve: 80,
        state: 'active',
      },
    },
    position: '100.0, 200.0, 32.0',
    forward: '1.0, 0.0, 0.0',
  },
  allplayers: {
    'fixture-player-t-2': {
      name: 'Fixture T Two',
      team: 'T',
      observer_slot: 8,
      state: { health: 72, armor: 50, helmet: true },
      match_stats: { kills: 4, assists: 1, deaths: 6, mvps: 0, score: 30 },
      weapons: {},
      position: '300.0, 100.0, 32.0',
      forward: '0.0, 1.0, 0.0',
    },
    'fixture-player-ct-1': {
      name: 'Fixture CT One',
      team: 'CT',
      observer_slot: 1,
      state: { health: 100, armor: 0, helmet: false, defusekit: false },
      match_stats: { kills: 8, assists: 2, deaths: 5, mvps: 1, score: 52 },
      weapons: {
        weapon_0: {
          name: 'weapon_m4a1_silencer',
          type: 'Rifle',
          ammo_clip: 20,
          ammo_clip_max: 25,
          ammo_reserve: 80,
          state: 'active',
        },
      },
      position: '100.0, 200.0, 32.0',
      forward: '1.0, 0.0, 0.0',
    },
  },
  bomb: {
    state: 'planted',
    player: 'fixture-player-ct-1',
    position: '150.0, 250.0, 32.0',
    countdown: '28.75',
  },
  grenades: {
    'grenade-2': {
      type: 'inferno',
      owner: 'fixture-player-t-2',
      position: '320.0, 120.0, 32.0',
      velocity: '0.0, 0.0, 0.0',
      lifetime: '4.5',
      flames: {
        'flame-1': '320.0, 120.0, 32.0',
      },
    },
    'grenade-1': {
      type: 'frag',
      owner: 'fixture-player-ct-1',
      position: '110.0, 220.0, 40.0',
      velocity: '10.0, 0.0, -2.0',
      lifetime: '0.2',
    },
  },
  // These source hints are intentionally not interpreted by the adapter.
  previously: { round: { bomb: 'exploded', win_team: 'CT' } },
  added: { round: { bomb: 'planted' } },
  ignored_future_field: { nested: ['source', 'data'] },
} as const;

export const SYNTHETIC_EVIDENCE_INFORMED_ROUND_AFTER_BOMB_FRAME = {
  provider: { timestamp: 1726220001 },
  round: { phase: 'freezetime' },
} as const;
