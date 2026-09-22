export interface RadarAlphaBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RadarFloorImage {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly bounds: RadarAlphaBounds;
}

export interface RadarFloorTransform extends RadarFloorImage {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const RADAR_COMPOSITOR = Object.freeze({
  logicalSize: 1000,
  padding: 10,
  gap: 20,
  usableSize: 980,
});

export function findRadarAlphaBounds(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  alphaThreshold = 8,
): RadarAlphaBounds | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length < width * height * 4
  ) {
    return null;
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3]! <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function singleFloorTransform(image: RadarFloorImage): RadarFloorTransform {
  const scale = Math.min(
    RADAR_COMPOSITOR.usableSize / image.bounds.width,
    RADAR_COMPOSITOR.usableSize / image.bounds.height,
  );
  return {
    ...image,
    scale,
    x: RADAR_COMPOSITOR.padding + (RADAR_COMPOSITOR.usableSize - image.bounds.width * scale) / 2,
    y: RADAR_COMPOSITOR.padding + (RADAR_COMPOSITOR.usableSize - image.bounds.height * scale) / 2,
  };
}

export function multiFloorTransforms(
  upper: RadarFloorImage,
  lower: RadarFloorImage,
): { readonly upper: RadarFloorTransform; readonly lower: RadarFloorTransform } {
  const scale = Math.min(
    RADAR_COMPOSITOR.usableSize / Math.max(upper.bounds.width, lower.bounds.width),
    (RADAR_COMPOSITOR.usableSize - RADAR_COMPOSITOR.gap) /
      (upper.bounds.height + lower.bounds.height),
  );
  const upperHeight = upper.bounds.height * scale;
  return {
    upper: {
      ...upper,
      scale,
      x: RADAR_COMPOSITOR.padding + (RADAR_COMPOSITOR.usableSize - upper.bounds.width * scale) / 2,
      y: RADAR_COMPOSITOR.padding,
    },
    lower: {
      ...lower,
      scale,
      x: RADAR_COMPOSITOR.padding + (RADAR_COMPOSITOR.usableSize - lower.bounds.width * scale) / 2,
      y: RADAR_COMPOSITOR.padding + upperHeight + RADAR_COMPOSITOR.gap,
    },
  };
}

export function mapRadarPoint(
  point: { readonly x: number; readonly y: number },
  transform: RadarFloorTransform,
): { readonly x: number; readonly y: number } {
  return {
    x: transform.x + (point.x * transform.imageWidth - transform.bounds.x) * transform.scale,
    y: transform.y + (point.y * transform.imageHeight - transform.bounds.y) * transform.scale,
  };
}
