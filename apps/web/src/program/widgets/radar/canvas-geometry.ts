export const RADAR_CANVAS_GEOMETRY = Object.freeze({
  logicalSize: 1000,
  inset: 10,
  artworkSize: 980,
});

export interface NormalizedRadarPoint {
  readonly x: number;
  readonly y: number;
}

export interface RadarCanvasViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RadarCanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RadarCanvasPlacement {
  readonly viewport: RadarCanvasViewport;
  readonly rect: RadarCanvasRect;
}

/**
 * #66 correction addendum: packages/radar canonical 1024 registration is the
 * only coordinate owner. Default V1 does not crop/independently scale a floor.
 */
export function radarBroadcastPlacement(
  _mapKey: string,
  _layer: string,
): RadarCanvasPlacement | null {
  return null;
}

export function radarCanvasArtworkRect(viewport: RadarCanvasViewport | null): RadarCanvasRect {
  if (viewport === null) {
    return {
      x: RADAR_CANVAS_GEOMETRY.inset,
      y: RADAR_CANVAS_GEOMETRY.inset,
      width: RADAR_CANVAS_GEOMETRY.artworkSize,
      height: RADAR_CANVAS_GEOMETRY.artworkSize,
    };
  }
  const aspect = viewport.width / viewport.height;
  const width =
    aspect >= 1 ? RADAR_CANVAS_GEOMETRY.artworkSize : RADAR_CANVAS_GEOMETRY.artworkSize * aspect;
  const height =
    aspect >= 1 ? RADAR_CANVAS_GEOMETRY.artworkSize / aspect : RADAR_CANVAS_GEOMETRY.artworkSize;
  return {
    x: (RADAR_CANVAS_GEOMETRY.logicalSize - width) / 2,
    y: (RADAR_CANVAS_GEOMETRY.logicalSize - height) / 2,
    width,
    height,
  };
}

export function radarPointInsideViewport(
  point: NormalizedRadarPoint,
  viewport: RadarCanvasViewport,
): boolean {
  return (
    point.x >= viewport.x &&
    point.x <= viewport.x + viewport.width &&
    point.y >= viewport.y &&
    point.y <= viewport.y + viewport.height
  );
}

export function radarCanvasPoint(
  point: NormalizedRadarPoint,
  viewport: RadarCanvasViewport | null = null,
  rectOverride: RadarCanvasRect | null = null,
) {
  if (viewport === null) {
    return {
      x: RADAR_CANVAS_GEOMETRY.inset + point.x * RADAR_CANVAS_GEOMETRY.artworkSize,
      y: RADAR_CANVAS_GEOMETRY.inset + point.y * RADAR_CANVAS_GEOMETRY.artworkSize,
    };
  }
  const rect = rectOverride ?? radarCanvasArtworkRect(viewport);
  return {
    x: rect.x + ((point.x - viewport.x) / viewport.width) * rect.width,
    y: rect.y + ((point.y - viewport.y) / viewport.height) * rect.height,
  };
}

export function radarCanvasRadius(
  normalizedRadius: number,
  viewport: RadarCanvasViewport | null = null,
  rectOverride: RadarCanvasRect | null = null,
): number {
  if (viewport === null) return normalizedRadius * RADAR_CANVAS_GEOMETRY.artworkSize;
  const rect = rectOverride ?? radarCanvasArtworkRect(viewport);
  return normalizedRadius * (rect.width / viewport.width);
}
