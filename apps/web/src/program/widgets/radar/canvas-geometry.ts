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

/**
 * Broadcast viewports trim transparent source padding without changing the
 * canonical 1024 overview calibration. Nuke's Valve artwork only occupies
 * roughly half of the source texture vertically; fitting the whole texture
 * makes the on-air map materially smaller than the EWC reference.
 */
const BROADCAST_VIEWPORTS: Readonly<Record<string, RadarCanvasViewport>> =
  Object.freeze({
    de_nuke: Object.freeze({ x: 0.055, y: 0.27, width: 0.92, height: 0.52 }),
  });

export function radarBroadcastViewport(mapKey: string): RadarCanvasViewport | null {
  return BROADCAST_VIEWPORTS[mapKey] ?? null;
}

export function radarCanvasArtworkRect(viewport: RadarCanvasViewport | null) {
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
    aspect >= 1
      ? RADAR_CANVAS_GEOMETRY.artworkSize
      : RADAR_CANVAS_GEOMETRY.artworkSize * aspect;
  const height =
    aspect >= 1
      ? RADAR_CANVAS_GEOMETRY.artworkSize / aspect
      : RADAR_CANVAS_GEOMETRY.artworkSize;
  return {
    x: (RADAR_CANVAS_GEOMETRY.logicalSize - width) / 2,
    y: (RADAR_CANVAS_GEOMETRY.logicalSize - height) / 2,
    width,
    height,
  };
}

/** Map pixels and projected entities share the same normalized 1024 overview. */
export function radarCanvasPoint(
  point: NormalizedRadarPoint,
  viewport: RadarCanvasViewport | null = null,
) {
  if (viewport === null) {
    return {
      x: RADAR_CANVAS_GEOMETRY.inset + point.x * RADAR_CANVAS_GEOMETRY.artworkSize,
      y: RADAR_CANVAS_GEOMETRY.inset + point.y * RADAR_CANVAS_GEOMETRY.artworkSize,
    };
  }
  const rect = radarCanvasArtworkRect(viewport);
  return {
    x: rect.x + ((point.x - viewport.x) / viewport.width) * rect.width,
    y: rect.y + ((point.y - viewport.y) / viewport.height) * rect.height,
  };
}

/** Radius projections are normalized to the same display transform as points. */
export function radarCanvasRadius(
  normalizedRadius: number,
  viewport: RadarCanvasViewport | null = null,
): number {
  if (viewport === null)
    return normalizedRadius * RADAR_CANVAS_GEOMETRY.artworkSize;
  const rect = radarCanvasArtworkRect(viewport);
  return normalizedRadius * (rect.width / viewport.width);
}
