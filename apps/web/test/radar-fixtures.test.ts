import { describe, expect, it } from 'vitest';
import { projectWorldPosition, defaultMapGeometryProvider } from '@rivalhub-broadcast/radar';
import { getDefaultHudCompositeFixture } from '../src/program/fixtures/default-hud-composite-fixtures';
import { radarVisualFixture } from '../src/program/fixtures/radar-fixtures';

describe('Nuke Radar fixtures', () => {
  const geometry = defaultMapGeometryProvider.resolve('de_nuke');

  it('uses in-bounds canonical calibration anchors for each floor', () => {
    expect(geometry).not.toBeNull();
    for (const [fixture, floor] of [
      ['nuke-upper', 'upper'],
      ['nuke-lower', 'lower'],
    ] as const) {
      const snapshot = radarVisualFixture(fixture).snapshot;
      const points = snapshot.payload.players.map((player) =>
        projectWorldPosition(player.position, geometry!),
      );
      expect(points).toHaveLength(10);
      expect(points.every((point) => point !== null && !point.outOfBounds)).toBe(true);
      expect(points.every((point) => point?.layer === floor)).toBe(true);
      expect(new Set(points.map((point) => `${point!.x}:${point!.y}`)).size).toBe(10);
    }
  });

  it('distributes the composite players across the shared upper and lower image space', () => {
    const fixture = getDefaultHudCompositeFixture('default-nuke-multifloor');
    expect(fixture).not.toBeNull();
    const points = fixture!.radarSnapshot.payload.players.map((player) =>
      projectWorldPosition(player.position, geometry!),
    );
    expect(points.every((point) => point !== null && !point.outOfBounds)).toBe(true);
    expect(points.filter((point) => point?.layer === 'upper')).toHaveLength(5);
    expect(points.filter((point) => point?.layer === 'lower')).toHaveLength(5);
  });
});
