import { describe, expect, it } from 'vitest';

import { adaptGsiPayload, MAX_DIAGNOSTICS_PER_FRAME, type GsiDiagnostic } from '../src/index.js';
import {
  SYNTHETIC_EVIDENCE_INFORMED_OBSERVER_FRAME,
  SYNTHETIC_EVIDENCE_INFORMED_PROVENANCE,
  SYNTHETIC_EVIDENCE_INFORMED_ROUND_AFTER_BOMB_FRAME,
} from './fixtures/synthetic-evidence-informed.js';
import { REAL_DERIVED_FRAME, REAL_DERIVED_PROVENANCE } from './fixtures/real-derived.js';
import {
  REAL_DERIVED_B_FRAME,
  REAL_DERIVED_B_PROVENANCE,
  REAL_DERIVED_C_LIFECYCLE_FRAMES,
  REAL_DERIVED_C_PROVENANCE,
} from './fixtures/real-derived-observer.js';

const receiveContext = {
  sequence: 17,
  receivedAt: '2026-09-14T00:00:00.000Z',
  receivedMonotonicMs: 1234.5,
} as const;

function diagnosticCodes(result: {
  readonly diagnostics: { readonly entries: readonly GsiDiagnostic[] };
}) {
  return result.diagnostics.entries.map((entry) => entry.code);
}

function playerFixture(sourcePlayerId: string) {
  return {
    name: sourcePlayerId,
    team: 'CT',
    state: { health: 100, armor: 0, helmet: false },
    position: '0, 0, 0',
    forward: '1, 0, 0',
  };
}

describe('adaptGsiPayload', () => {
  it('normalizes a synthetic evidence-informed composition without leaking raw GSI shape', () => {
    const result = adaptGsiPayload(SYNTHETIC_EVIDENCE_INFORMED_OBSERVER_FRAME, receiveContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.observation.receive).toEqual(receiveContext);
    expect(result.observation.source).toEqual({
      kind: 'cs2-gsi',
      providerTimestampSeconds: 1726220000,
    });
    expect(result.observation.coverage).toEqual({
      provider: 'present',
      map: 'present',
      round: 'present',
      phaseCountdowns: 'present',
      player: 'present',
      allPlayers: 'present',
      bomb: 'present',
      grenades: 'present',
    });
    expect(result.observation.telemetry.map).toMatchObject({
      name: 'de_mirage',
      mode: 'competitive',
      phase: 'live',
      roundNumber: 7,
      sides: {
        ct: { name: 'Fixture CT', score: 4 },
        t: { name: 'Fixture T', score: 3 },
      },
    });
    expect(result.observation.telemetry.phaseCountdowns).toEqual({
      phase: 'bomb',
      endsInSeconds: 32.5,
    });
    expect(result.observation.telemetry.player?.sourcePlayerId).toBe('fixture-player-ct-1');
    expect(result.observation.telemetry.player?.position).toEqual({ x: 100, y: 200, z: 32 });
    expect(result.observation.telemetry.player?.state).toMatchObject({
      health: 100,
      armor: 0,
      hasHelmet: false,
      hasDefuser: false,
      flashed: 0,
      money: 4200,
    });
    expect(result.observation.telemetry.allPlayers?.map((player) => player.sourcePlayerId)).toEqual(
      ['fixture-player-ct-1', 'fixture-player-t-2'],
    );
    expect(result.observation.telemetry.bomb).toEqual({
      state: 'planted',
      sourcePlayerId: 'fixture-player-ct-1',
      position: { x: 150, y: 250, z: 32 },
      countdownSeconds: 28.75,
    });
    expect(result.observation.telemetry.round?.bomb).toEqual({ state: 'planted' });
    expect(result.observation.telemetry.grenades?.map((grenade) => grenade.sourceEntityId)).toEqual(
      ['grenade-1', 'grenade-2'],
    );
    expect(result.observation.telemetry.grenades?.[1]).toMatchObject({
      kind: 'inferno',
      ownerSourceId: 'fixture-player-t-2',
      lifetimeSeconds: 4.5,
      flames: [{ sourceFlameId: 'flame-1', position: { x: 320, y: 120, z: 32 } }],
    });
    expect(result.observation).not.toHaveProperty('diagnostics');
    expect(result.observation.telemetry).not.toHaveProperty('previously');
    expect(result.observation.telemetry).not.toHaveProperty('added');
  });

  it('keeps explicit provenance for a synthetic evidence-informed fixture', () => {
    expect(SYNTHETIC_EVIDENCE_INFORMED_PROVENANCE).toMatchObject({
      fixtureKind: 'synthetic-evidence-informed',
      sourceCaptureId: '20260913T162802Z-3f41d8df',
      sourceFrame: 'synthetic composition from documented source facts; no single source frame',
      sourceFrameSequence: null,
      sourceFrameRange: null,
    });
    expect(SYNTHETIC_EVIDENCE_INFORMED_PROVENANCE.sourceCaptureFramesSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(SYNTHETIC_EVIDENCE_INFORMED_PROVENANCE.sanitization).toContain(
      'not a sanitized raw frame',
    );
  });

  it('keeps exact provenance for a sanitized real-derived frame excerpt', () => {
    expect(REAL_DERIVED_PROVENANCE).toEqual({
      fixtureKind: 'sanitized-real-derived',
      sourceCaptureId: 'roundsense-economy-runtime-20260807',
      sourceCaptureFramesSha256: 'beb711e09b4a9fcb7dca9c1b44cfd1699cecf7ed4a101a74ae69d995529646cb',
      sourceFrameSequence: 2,
      sourceFrameRange: 'seq=2..2',
      sanitization:
        'steamid -> fixture-player-ct-1; name -> Fixture Real-Derived Player; outer capture envelope omitted; provider timestamp and source fields retained',
    });

    const result = adaptGsiPayload(REAL_DERIVED_FRAME, receiveContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual({ entries: [], suppressedCount: 0 });
    expect(result.observation.coverage).toEqual({
      provider: 'present',
      map: 'present',
      round: 'present',
      phaseCountdowns: 'absent',
      player: 'present',
      allPlayers: 'absent',
      bomb: 'absent',
      grenades: 'absent',
    });
    expect(result.observation.source.providerTimestampSeconds).toBe(1786117842);
    expect(result.observation.telemetry.map).toMatchObject({
      name: 'de_mirage',
      phase: 'live',
      roundNumber: 0,
    });
    expect(result.observation.telemetry.player).toMatchObject({
      sourcePlayerId: 'fixture-player-ct-1',
      displayName: 'Fixture Real-Derived Player',
      side: 'CT',
      state: { hasHelmet: false },
      weapons: [
        { sourceWeaponId: 'weapon_0', name: 'weapon_knife' },
        { sourceWeaponId: 'weapon_1', name: 'weapon_hkp2000' },
      ],
    });
    expect(result.observation.telemetry).not.toHaveProperty('previously');
  });

  it('normalizes the exact B observer excerpt with string timers and flame vectors', () => {
    expect(REAL_DERIVED_B_PROVENANCE).toEqual({
      fixtureKind: 'sanitized-real-derived',
      sourceCaptureId: '20260913T161643Z-56b6492b',
      sourceCaptureFramesSha256: '519cec4f94f93b2cbc3b34d5e32d60e428039a94b3999d058a56910afcd7c5f9',
      sourceFrameSequence: 45,
      sourceFrameRange: 'seq=45..45',
      sourcePayloadBlocks: [
        'provider',
        'map',
        'phase_countdowns',
        'player',
        'allplayers',
        'grenades',
      ],
      sanitization:
        'all Steam ids mapped to fixture-player-*; player names mapped to Fixture *; team names mapped to Fixture CT/T; irrelevant source fields omitted',
    });

    const result = adaptGsiPayload(REAL_DERIVED_B_FRAME, {
      ...receiveContext,
      sequence: REAL_DERIVED_B_PROVENANCE.sourceFrameSequence,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual({ entries: [], suppressedCount: 0 });
    expect(result.observation.coverage).toEqual({
      provider: 'present',
      map: 'present',
      round: 'absent',
      phaseCountdowns: 'present',
      player: 'present',
      allPlayers: 'present',
      bomb: 'absent',
      grenades: 'present',
    });
    expect(result.observation.telemetry.map?.sides).toEqual({
      ct: { name: 'Fixture CT', score: 0, timeoutsRemaining: 3 },
      t: { name: 'Fixture T', score: 0, timeoutsRemaining: 3 },
    });
    expect(result.observation.telemetry.phaseCountdowns).toEqual({
      phase: 'warmup',
      endsInSeconds: 7.4,
    });
    expect(result.observation.telemetry.player?.state).toMatchObject({
      hasHelmet: true,
      roundTotalDamage: 0,
    });
    expect(result.observation.telemetry.allPlayers).toHaveLength(10);
    expect(result.observation.telemetry.grenades).toHaveLength(2);
    const inferno = result.observation.telemetry.grenades?.[0];
    expect(inferno).toMatchObject({
      sourceEntityId: '148',
      kind: 'inferno',
      ownerSourceId: 'fixture-player-9',
      lifetimeSeconds: 0.103,
    });
    expect(inferno?.flames).toHaveLength(8);
    expect(inferno?.flames).toContainEqual({
      sourceFlameId: 'flame_p598_n793_p92',
      position: { x: 598, y: -793, z: 92 },
    });
    expect(inferno).not.toHaveProperty('effectSeconds');
    expect(inferno?.flames?.[0]).not.toHaveProperty('lifetimeSeconds');
  });

  it('normalizes exact C bomb lifecycle excerpts without retaining omitted round fields', () => {
    expect(REAL_DERIVED_C_PROVENANCE).toEqual({
      fixtureKind: 'sanitized-real-derived',
      sourceCaptureId: '20260913T162802Z-3f41d8df',
      sourceCaptureFramesSha256: 'e34505e2626dfa6f0941b8b4ed675dbea38e2ff53e29e3240c36ad7a2673d218',
      sourceFrameSequences: [567, 580, 661, 746, 775],
      sourceFrameRange: 'seq=567,580,661,746,775',
      sourcePayloadBlocks: ['provider', 'phase_countdowns', 'round', 'bomb'],
      sanitization:
        'bomb player ids mapped from source numeric ids to fixture-player-*; provider and source values retained; unrelated blocks omitted',
    });

    const observations = REAL_DERIVED_C_LIFECYCLE_FRAMES.map((frame) => {
      const result = adaptGsiPayload(frame.payload, {
        ...receiveContext,
        sequence: frame.sequence,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return undefined;
      expect(result.diagnostics).toEqual({ entries: [], suppressedCount: 0 });
      return result.observation;
    });

    const [planting, planted, defusing, exploded, newRound] = observations;
    expect(planting?.telemetry.phaseCountdowns).toEqual({
      phase: 'live',
      endsInSeconds: 52.2,
    });
    expect(planting?.telemetry.bomb).toEqual({
      state: 'planting',
      position: { x: -1639.3, y: 2675, z: 47.8 },
      sourcePlayerId: 'fixture-player-330',
      countdownSeconds: 2.991,
    });
    expect(planted?.telemetry.round).toEqual({ phase: 'live', bomb: { state: 'planted' } });
    expect(planted?.telemetry.bomb).toEqual({
      state: 'planted',
      position: { x: -1639.3, y: 2675, z: 6.8 },
      countdownSeconds: 39.914,
    });
    expect(defusing?.telemetry.bomb).toMatchObject({
      state: 'defusing',
      sourcePlayerId: 'fixture-player-342',
      countdownSeconds: 9.794,
    });
    expect(exploded?.telemetry.round).toEqual({
      phase: 'over',
      winnerSide: 'T',
      bomb: { state: 'exploded' },
    });
    expect(exploded?.telemetry.bomb).toEqual({
      state: 'exploded',
      position: { x: -1639.3, y: 2675, z: 7.2 },
    });
    expect(newRound?.telemetry.round).toEqual({ phase: 'freezetime' });
    expect(newRound?.telemetry.bomb).toEqual({
      state: 'carried',
      sourcePlayerId: 'fixture-player-338',
      position: { x: -493, y: -808, z: 148.6 },
    });
  });

  it('distinguishes absent blocks from explicitly empty collections', () => {
    const absent = adaptGsiPayload({}, receiveContext);
    const empty = adaptGsiPayload({ grenades: {} }, receiveContext);

    expect(absent.ok).toBe(true);
    expect(empty.ok).toBe(true);
    if (!absent.ok || !empty.ok) return;

    expect(absent.observation.coverage.grenades).toBe('absent');
    expect(absent.observation.telemetry).not.toHaveProperty('grenades');
    expect(empty.observation.coverage.grenades).toBe('present');
    expect(empty.observation.telemetry.grenades).toEqual([]);
  });

  it('preserves zero and false values instead of converting them to unknown or absent', () => {
    const result = adaptGsiPayload(
      {
        player: {
          steamid: 'player-zero',
          state: {
            health: 0,
            armor: 0,
            helmet: false,
            defusekit: false,
            money: 0,
            flashed: 0,
          },
        },
        phase_countdowns: { phase: 'live', phase_ends_in: '0' },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.telemetry.player?.state).toEqual({
      health: 0,
      armor: 0,
      hasHelmet: false,
      hasDefuser: false,
      money: 0,
      flashed: 0,
    });
    expect(result.observation.telemetry.phaseCountdowns?.endsInSeconds).toBe(0);
  });

  it('accepts only strict decimal strings for evidence-backed source timers', () => {
    const result = adaptGsiPayload(
      {
        phase_countdowns: { phase: 'live', phase_ends_in: 1.5 },
        bomb: { state: 'planted', countdown: 2.5 },
        grenades: { grenade: { lifetime: 0.5 } },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.telemetry.phaseCountdowns).toEqual({ phase: 'live' });
    expect(result.observation.telemetry.bomb).toEqual({ state: 'planted' });
    expect(result.observation.telemetry.grenades).toEqual([{ sourceEntityId: 'grenade' }]);
    expect(diagnosticCodes(result)).toHaveLength(3);
    expect(diagnosticCodes(result)).toEqual(['INVALID_FIELD', 'INVALID_FIELD', 'INVALID_FIELD']);
  });

  it('normalizes unknown control values to unknown while retaining the rest of the block', () => {
    const result = adaptGsiPayload(
      {
        map: { name: 'de_future', phase: 'intermission_time' },
        round: { phase: 'future-round-phase', win_team: 'future-side' },
        player: {
          steamid: 'player-future',
          team: 'future-team',
          state: { health: 25 },
          weapons: { weapon_0: { state: 'deploying', name: 'future_weapon' } },
        },
        grenades: { 'grenade-future': { type: 'future-grenade-kind' } },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.telemetry.map).toMatchObject({ name: 'de_future', phase: 'unknown' });
    expect(result.observation.telemetry.round).toMatchObject({
      phase: 'unknown',
      winnerSide: 'unknown',
    });
    expect(result.observation.telemetry.player).toMatchObject({
      side: 'unknown',
      state: { health: 25 },
      weapons: [{ state: 'unknown', name: 'future_weapon' }],
    });
    expect(result.observation.telemetry.grenades).toEqual([
      { sourceEntityId: 'grenade-future', kind: 'future-grenade-kind' },
    ]);
    expect(diagnosticCodes(result)).toEqual(expect.arrayContaining(['UNKNOWN_GSI_ENUM']));
  });

  it('ignores unknown extra fields and does not use previously or added as normalized truth', () => {
    const withHints = adaptGsiPayload(SYNTHETIC_EVIDENCE_INFORMED_OBSERVER_FRAME, receiveContext);
    const withoutHints = adaptGsiPayload(
      {
        ...SYNTHETIC_EVIDENCE_INFORMED_OBSERVER_FRAME,
        previously: undefined,
        added: undefined,
        ignored_future_field: undefined,
      },
      receiveContext,
    );

    expect(withHints).toEqual(withoutHints);
  });

  it('returns a bounded fatal result for an invalid root', () => {
    const result = adaptGsiPayload(['not', 'an', 'object'], receiveContext);

    expect(result).toEqual({
      ok: false,
      diagnostics: {
        entries: [{ code: 'INVALID_ROOT', severity: 'fatal', path: '$' }],
        suppressedCount: 0,
      },
    });
  });

  it('degrades only an invalid block or field while preserving valid sibling blocks', () => {
    const invalidBlock = adaptGsiPayload(
      { provider: { timestamp: 12 }, map: [], round: { phase: 'live' } },
      receiveContext,
    );
    const invalidField = adaptGsiPayload(
      { map: { name: 42, phase: 'live' }, round: { phase: 'live' } },
      receiveContext,
    );

    expect(invalidBlock.ok).toBe(true);
    expect(invalidField.ok).toBe(true);
    if (!invalidBlock.ok || !invalidField.ok) return;

    expect(invalidBlock.observation.coverage).toMatchObject({
      provider: 'present',
      map: 'degraded',
      round: 'present',
    });
    expect(invalidBlock.observation.telemetry.round?.phase).toBe('live');
    expect(invalidField.observation.coverage.map).toBe('degraded');
    expect(invalidField.observation.telemetry.map).toEqual({ phase: 'live' });
    expect(diagnosticCodes(invalidBlock)).toContain('UNEXPECTED_BLOCK_SHAPE');
    expect(diagnosticCodes(invalidField)).toContain('INVALID_FIELD');
  });

  it('drops only malformed vectors and allplayers/grenade entries', () => {
    const result = adaptGsiPayload(
      {
        allplayers: {
          'player-valid': { name: 'Valid', position: '1, 2, 3' },
          'player-malformed': 'not an object',
        },
        player: {
          steamid: 'player-observed',
          position: 'malformed vector',
          state: { health: 50 },
        },
        grenades: {
          'grenade-valid': { type: 'smoke', position: '4, 5, 6' },
          'grenade-malformed': null,
        },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.coverage).toMatchObject({
      allPlayers: 'degraded',
      player: 'degraded',
      grenades: 'degraded',
    });
    expect(result.observation.telemetry.allPlayers?.map((player) => player.sourcePlayerId)).toEqual(
      ['player-valid'],
    );
    expect(result.observation.telemetry.player).toMatchObject({
      sourcePlayerId: 'player-observed',
      state: { health: 50 },
    });
    expect(result.observation.telemetry.player).not.toHaveProperty('position');
    expect(result.observation.telemetry.grenades).toEqual([
      { sourceEntityId: 'grenade-valid', kind: 'smoke', position: { x: 4, y: 5, z: 6 } },
    ]);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        'INVALID_ALLPLAYERS_ENTRY',
        'MALFORMED_VECTOR',
        'INVALID_GRENADE_ENTRY',
      ]),
    );
  });

  it('rejects unproven alternate raw shapes instead of guessing normalized values', () => {
    const result = adaptGsiPayload(
      {
        player: {
          steamid: 'player-object-shape',
          position: { x: 1, y: 2, z: 3 },
        },
        round: { bomb: { state: 'planted' } },
        bomb: { state: 'carried', player: { steamid: 'player-object-shape' } },
        grenades: {
          'grenade-object-shape': {
            kind: 'smoke',
            owner: { steamid: 'player-object-shape' },
          },
        },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.telemetry.player).toEqual({
      sourcePlayerId: 'player-object-shape',
    });
    expect(result.observation.telemetry.round).toEqual({});
    expect(result.observation.telemetry.bomb).toEqual({ state: 'carried' });
    expect(result.observation.telemetry.grenades).toEqual([
      { sourceEntityId: 'grenade-object-shape' },
    ]);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining(['MALFORMED_VECTOR', 'INVALID_FIELD']),
    );
  });

  it('accepts heartbeat/provider-only frames with explicit absent coverage', () => {
    const result = adaptGsiPayload({ provider: { timestamp: 99 } }, receiveContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.coverage).toEqual({
      provider: 'present',
      map: 'absent',
      round: 'absent',
      phaseCountdowns: 'absent',
      player: 'absent',
      allPlayers: 'absent',
      bomb: 'absent',
      grenades: 'absent',
    });
    expect(result.observation.telemetry).toEqual({});
  });

  it('does not retain a round bomb after a later current frame omits it', () => {
    const first = adaptGsiPayload(SYNTHETIC_EVIDENCE_INFORMED_OBSERVER_FRAME, receiveContext);
    const second = adaptGsiPayload(SYNTHETIC_EVIDENCE_INFORMED_ROUND_AFTER_BOMB_FRAME, {
      ...receiveContext,
      sequence: receiveContext.sequence + 1,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.observation.telemetry.round?.bomb).toEqual({ state: 'planted' });
    expect(second.observation.telemetry.round).toEqual({ phase: 'freezetime' });
    expect(second.observation.coverage.round).toBe('present');
  });

  it.each([9, 10, 11])(
    'accepts %i-player allplayers collections without a fixed-10 invariant',
    (count) => {
      const allplayers: Record<string, ReturnType<typeof playerFixture>> = {};
      for (let index = 0; index < count; index += 1) {
        allplayers[`player-${String(index).padStart(2, '0')}`] = playerFixture(`player-${index}`);
      }

      const result = adaptGsiPayload({ allplayers }, receiveContext);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.observation.coverage.allPlayers).toBe('present');
      expect(result.observation.telemetry.allPlayers).toHaveLength(count);
    },
  );

  it('orders players, weapons, grenades, and flames deterministically by source id', () => {
    const result = adaptGsiPayload(
      {
        allplayers: {
          player_b: playerFixture('B'),
          player_a: playerFixture('A'),
        },
        grenades: {
          grenade_b: { flames: { flame_b: '0, 0, 0', flame_a: '0, 0, 0' } },
          grenade_a: {},
        },
        player: {
          steamid: 'observed',
          weapons: { weapon_b: {}, weapon_a: {} },
        },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.telemetry.allPlayers?.map((player) => player.sourcePlayerId)).toEqual(
      ['player_a', 'player_b'],
    );
    expect(result.observation.telemetry.grenades?.map((grenade) => grenade.sourceEntityId)).toEqual(
      ['grenade_a', 'grenade_b'],
    );
    expect(
      result.observation.telemetry.grenades?.[1]?.flames?.map((flame) => flame.sourceFlameId),
    ).toEqual(['flame_a', 'flame_b']);
    expect(
      result.observation.telemetry.player?.weapons?.map((weapon) => weapon.sourceWeaponId),
    ).toEqual(['weapon_a', 'weapon_b']);
  });

  it('is deterministic and stateless across calls', () => {
    const frameA = { map: { name: 'de_a' }, allplayers: { a: playerFixture('A') } };
    const frameB = { map: { name: 'de_b' }, allplayers: { b: playerFixture('B') } };

    const direct = adaptGsiPayload(frameB, receiveContext);
    adaptGsiPayload(frameA, receiveContext);
    const afterAnotherFrame = adaptGsiPayload(frameB, receiveContext);

    expect(afterAnotherFrame).toEqual(direct);
  });

  it('caps diagnostics and reports suppressed entries without retaining raw objects', () => {
    const malformedPlayers: Record<string, unknown> = {};
    for (let index = 0; index < MAX_DIAGNOSTICS_PER_FRAME + 20; index += 1) {
      malformedPlayers[`player-${index}`] = null;
    }

    const result = adaptGsiPayload(
      {
        allplayers: malformedPlayers,
        map: { phase: 'unknown-phase', name: 42 },
      },
      receiveContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.entries).toHaveLength(MAX_DIAGNOSTICS_PER_FRAME);
    expect(result.diagnostics.suppressedCount).toBeGreaterThan(0);
    expect(
      result.diagnostics.entries.every((entry) =>
        Object.keys(entry).every((key) => ['code', 'severity', 'path', 'rawValue'].includes(key)),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.entries.some((entry) => entry.rawValue && entry.rawValue.length > 64),
    ).toBe(false);
  });

  it.each([
    null,
    false,
    0,
    '',
    [],
    {},
    { map: null },
    { allplayers: [] },
    { grenades: [] },
    { player: { steamid: 'p', position: { x: 'bad', y: 0, z: 0 } } },
    { nested: { arbitrary: ['json', 1, false, null] } },
  ])('does not throw for JSON-compatible input %#', (payload) => {
    expect(() => adaptGsiPayload(payload, receiveContext)).not.toThrow();
  });
});
