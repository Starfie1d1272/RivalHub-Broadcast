import { describe, expect, it } from 'vitest';

import {
  findRadarAlphaBounds,
  mapRadarPoint,
  multiFloorTransforms,
  singleFloorTransform,
} from '../src/program/widgets/radar/compositor';

describe('Radar map compositor geometry', () => {
  it('finds the minimum alpha greater than 8 bounds', () => {
    const width = 5;
    const height = 4;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const setAlpha = (x: number, y: number, alpha: number) => {
      rgba[(y * width + x) * 4 + 3] = alpha;
    };
    setAlpha(0, 0, 8);
    setAlpha(1, 1, 9);
    setAlpha(3, 2, 255);

    expect(findRadarAlphaBounds(width, height, rgba)).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    expect(findRadarAlphaBounds(width, height, new Uint8ClampedArray(4))).toBeNull();
  });

  it('uniformly fits a single-floor alpha bounds into the 980-square usable area', () => {
    const transform = singleFloorTransform({
      imageWidth: 1024,
      imageHeight: 1024,
      bounds: { x: 12, y: 20, width: 400, height: 200 },
    });

    expect(transform.scale).toBeCloseTo(2.45);
    expect(transform.x).toBeCloseTo(10);
    expect(transform.y).toBeCloseTo(255);
    const mapped = mapRadarPoint({ x: 12 / 1024, y: 20 / 1024 }, transform);
    expect(mapped.x).toBeCloseTo(10);
    expect(mapped.y).toBeCloseTo(255);
  });

  it('uses one shared scale and the fixed 20-unit gap for both floors', () => {
    const { upper, lower } = multiFloorTransforms(
      { imageWidth: 1024, imageHeight: 1024, bounds: { x: 30, y: 10, width: 800, height: 400 } },
      { imageWidth: 1024, imageHeight: 1024, bounds: { x: 20, y: 40, width: 600, height: 500 } },
    );

    expect(upper.scale).toBe(lower.scale);
    expect(upper.y).toBe(10);
    expect(lower.y - (upper.y + upper.bounds.height * upper.scale)).toBeCloseTo(20);
    expect(lower.y + lower.bounds.height * lower.scale).toBeCloseTo(990);
    expect(upper.x + upper.bounds.width * upper.scale).toBeLessThanOrEqual(990);
    expect(lower.x + lower.bounds.width * lower.scale).toBeLessThanOrEqual(990);
  });
});
