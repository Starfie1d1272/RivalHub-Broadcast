import { describe, expect, it } from 'vitest';

import { clientPointToHudLogicalPoint } from '../src/operator/hud-canvas-geometry';

describe('HUD canvas pointer geometry', () => {
  it('converts a scaled preview back to logical 1920 x 1080 coordinates', () => {
    expect(
      clientPointToHudLogicalPoint(500, 300, {
        left: 100,
        top: 100,
        width: 960,
        height: 540,
      }),
    ).toEqual({ x: 800, y: 400 });
  });

  it('fails closed for a zero-sized frame', () => {
    expect(
      clientPointToHudLogicalPoint(500, 300, {
        left: 100,
        top: 100,
        width: 0,
        height: 540,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
