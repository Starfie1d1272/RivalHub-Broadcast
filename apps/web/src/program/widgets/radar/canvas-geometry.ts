export const RADAR_CANVAS_GEOMETRY = Object.freeze({
  logicalSize: 1000,
  inset: 10,
  artworkSize: 980,
});

export interface NormalizedRadarPoint {
  readonly x: number;
  readonly y: number;
}

/** Map pixels and projected entities share the same normalized 1024 overview. */
export function radarCanvasPoint(point: NormalizedRadarPoint) {
  return {
    x: RADAR_CANVAS_GEOMETRY.inset + point.x * RADAR_CANVAS_GEOMETRY.artworkSize,
    y: RADAR_CANVAS_GEOMETRY.inset + point.y * RADAR_CANVAS_GEOMETRY.artworkSize,
  };
}

/** Radius projections are normalized to the overview reference width. */
export function radarCanvasRadius(normalizedRadius: number): number {
  return normalizedRadius * RADAR_CANVAS_GEOMETRY.artworkSize;
}
