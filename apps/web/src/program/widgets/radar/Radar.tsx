import { useEffect, useRef } from 'react';
import type { RadarSnapshot } from '@rivalhub-broadcast/protocol/radar';
import { projectWorldPosition, projectWorldRadius } from '@rivalhub-broadcast/radar';
import { getCs2Asset, getRadarMapAsset } from '@rivalhub-broadcast/cs2-assets';
import type { LocalChannelClient } from '../../../realtime';
import type { RadarHudWidgetRendererProps } from '../../hud-renderer-registry';
import {
  RadarPresentation,
  RADAR_PRESENTATION,
  SMOKE_PRESENTATION_DURATION_SECONDS,
  grenadeIcon,
  isMultiLayerGeometry,
  isActiveSmoke,
  layerOpacity,
  smokeRemaining,
  type RadarSide,
} from './presentation';
import {
  RADAR_CANVAS_GEOMETRY,
  radarBroadcastPlacement,
  radarCanvasPoint,
  radarCanvasRadius,
  radarPointInsideViewport,
  type RadarCanvasPlacement,
} from './canvas-geometry';
import { effectCentroid, smokeContour, smokeLobes } from './effect-geometry';
import './radar.css';

export interface RadarProps {
  readonly client?: LocalChannelClient<'radar'> | undefined;
  readonly snapshot?: RadarSnapshot | null | undefined;
  readonly zoomMode?: 'full-map' | 'auto' | undefined;
}

/** React owns the surface. Accepted channel samples and rAF own all motion. */
export function Radar({ client, snapshot, zoomMode = 'full-map' }: RadarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const currentSnapshot = useRef(snapshot);
  useEffect(() => {
    currentSnapshot.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const model = new RadarPresentation();
    const images = new Map<string, HTMLImageElement>();
    let frame = 0;
    let disposed = false;
    let lastStatic: RadarSnapshot | null | undefined;
    let lastConnection: unknown;
    const imageFor = (url: string): HTMLImageElement | null => {
      let image = images.get(url);
      if (!image) {
        image = new Image();
        image.src = url;
        images.set(url, image);
      }
      return image.complete && image.naturalWidth > 0 ? image : null;
    };
    const accept = () => {
      if (!client) return;
      const state = client.getSnapshot();
      if (state === lastConnection) return;
      lastConnection = state;
      model.accept(state.state === 'live' ? state.current : null, performance.now(), false);
    };
    const unsubscribe = client?.subscribe(accept);
    accept();
    const render = (now: number) => {
      if (disposed) return;
      if (!client && lastStatic !== currentSnapshot.current) {
        lastStatic = currentSnapshot.current;
        model.accept(lastStatic ?? null, now);
      }
      model.tick(now, zoomMode === 'auto');
      const size = Math.max(
        1,
        Math.round(element.clientWidth * Math.min(window.devicePixelRatio || 1, 2)),
      );
      if (element.width !== size) {
        element.width = size;
        element.height = size;
      }
      const ctx = context;
      const logicalSize = RADAR_CANVAS_GEOMETRY.logicalSize;
      ctx.setTransform(size / logicalSize, 0, 0, size / logicalSize, 0, 0);
      ctx.clearRect(0, 0, logicalSize, logicalSize);
      const style = getComputedStyle(element);
      const sideColor = (side: RadarSide) =>
        side === 'CT'
          ? style.getPropertyValue('--rh-hud-side-ct').trim() || '#6aa8ff'
          : side === 'T'
            ? style.getPropertyValue('--rh-hud-side-t').trim() || '#f2bd4f'
            : '#aab4c0';
      const circle = (
        x: number,
        y: number,
        radius: number,
        fill: string,
        stroke?: string,
        width = 4,
      ) => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      };
      const smoothClosedPath = (
        points: readonly { readonly x: number; readonly y: number }[],
      ) => {
        if (points.length < 3) return;
        const first = points[0]!;
        const last = points.at(-1)!;
        ctx.beginPath();
        ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
        for (let index = 0; index < points.length; index += 1) {
          const current = points[index]!;
          const next = points[(index + 1) % points.length]!;
          ctx.quadraticCurveTo(
            current.x,
            current.y,
            (current.x + next.x) / 2,
            (current.y + next.y) / 2,
          );
        }
        ctx.closePath();
      };
      const geometry = model.geometry;
      const payload = model.snapshot?.payload;
      const multiLayer = geometry !== null && isMultiLayerGeometry(geometry);
      const singleAsset =
        geometry !== null && !multiLayer ? getRadarMapAsset(geometry.mapKey, 'overview') : null;
      const singleImage = singleAsset ? imageFor(singleAsset.outputPath) : null;
      const upperAsset =
        geometry !== null && multiLayer ? getRadarMapAsset(geometry.mapKey, 'upper') : null;
      const lowerAsset =
        geometry !== null && multiLayer ? getRadarMapAsset(geometry.mapKey, 'lower') : null;
      const upperImage = upperAsset ? imageFor(upperAsset.outputPath) : null;
      const lowerImage = lowerAsset ? imageFor(lowerAsset.outputPath) : null;
      const placementFor = (layer: string): RadarCanvasPlacement | null =>
        geometry === null ? null : radarBroadcastPlacement(geometry.mapKey, layer);
      const pointAt = (point: { x: number; y: number; layer?: string }, layerHint?: string) => {
        const placement = placementFor(layerHint ?? point.layer ?? model.layer);
        if (placement !== null && !radarPointInsideViewport(point, placement.viewport)) return null;
        return radarCanvasPoint(point, placement?.viewport ?? null, placement?.rect ?? null);
      };
      const radiusAt = (normalizedRadius: number, layer: string) => {
        const placement = placementFor(layer);
        return radarCanvasRadius(
          normalizedRadius,
          placement?.viewport ?? null,
          placement?.rect ?? null,
        );
      };
      const drawArtwork = (
        image: HTMLImageElement,
        placement: RadarCanvasPlacement | null = null,
      ) => {
        if (placement === null) {
          ctx.drawImage(
            image,
            RADAR_CANVAS_GEOMETRY.inset,
            RADAR_CANVAS_GEOMETRY.inset,
            RADAR_CANVAS_GEOMETRY.artworkSize,
            RADAR_CANVAS_GEOMETRY.artworkSize,
          );
          return;
        }
        const { viewport, rect } = placement;
        ctx.drawImage(
          image,
          viewport.x * image.naturalWidth,
          viewport.y * image.naturalHeight,
          viewport.width * image.naturalWidth,
          viewport.height * image.naturalHeight,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        );
      };
      const detachedFloors = geometry?.mapKey === 'de_nuke' && multiLayer;
      element.dataset.radarState = !payload ? 'unavailable' : 'live';
      element.dataset.radarDiagnostic = model.diagnosticReason ?? 'none';
      if (model.unsupportedMap === null) delete element.dataset.radarUnsupportedMap;
      else element.dataset.radarUnsupportedMap = model.unsupportedMap;
      element.dataset.radarLayer = model.layer;
      element.dataset.radarLayers = multiLayer ? 'simultaneous' : model.layer;
      element.dataset.radarCompositor = detachedFloors
        ? 'ewc-detached-floor-shared-calibration'
        : multiLayer
          ? 'shared-calibration'
          : 'single-calibration';
      element.dataset.radarCoordinateSpace = 'overview-1024';
      element.dataset.radarArtwork = (multiLayer ? upperImage && lowerImage : singleImage)
        ? 'ready'
        : 'loading';
      element.dataset.radarVisibleFloors = multiLayer ? 'upper,lower' : model.layer;
      element.dataset.radarPlayers = String(model.players.size);
      element.dataset.radarTrails = String(
        [...model.grenades.values()].reduce((n, g) => n + g.trail.length, 0),
      );
      element.dataset.radarSmokes = String(
        [...model.grenades.values()].filter((marker) => isActiveSmoke(marker.source)).length,
      );
      element.dataset.radarFlamePoints = String(
        payload?.grenades.reduce((count, grenade) => count + grenade.flames.length, 0) ?? 0,
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        RADAR_CANVAS_GEOMETRY.inset,
        RADAR_CANVAS_GEOMETRY.inset,
        RADAR_CANVAS_GEOMETRY.artworkSize,
        RADAR_CANVAS_GEOMETRY.artworkSize,
      );
      ctx.clip();
      const z = model.zoom;
      ctx.translate(logicalSize / 2, logicalSize / 2);
      ctx.scale(z.scale, z.scale);
      ctx.translate(-z.x * logicalSize, -z.y * logicalSize);
      ctx.filter =
        'grayscale(0.82) saturate(0.1) brightness(0.72) contrast(1.16) ' +
        'drop-shadow(3px 0 0 rgba(243,246,250,.72)) ' +
        'drop-shadow(-3px 0 0 rgba(243,246,250,.72)) ' +
        'drop-shadow(0 3px 0 rgba(243,246,250,.72)) ' +
        'drop-shadow(0 -3px 0 rgba(243,246,250,.72))';
      if (singleImage) {
        ctx.globalAlpha = 0.84;
        drawArtwork(singleImage, placementFor('single'));
        ctx.globalAlpha = 1;
      } else if (geometry && multiLayer) {
        const floors =
          model.layer === 'upper' ? (['lower', 'upper'] as const) : (['upper', 'lower'] as const);
        for (const floor of floors) {
          const image = floor === 'upper' ? upperImage : lowerImage;
          if (!image) continue;
          ctx.globalAlpha = floor === model.layer ? 0.86 : model.layer === 'unknown' ? 0.72 : 0.5;
          drawArtwork(image, placementFor(floor));
        }
        ctx.globalAlpha = 1;
      }
      ctx.filter = 'none';

      const drawSiteBadge = (
        label: 'A' | 'B',
        normalized: { readonly x: number; readonly y: number },
        layer: string,
      ) => {
        const placement = placementFor(layer);
        const point = radarCanvasPoint(
          normalized,
          placement?.viewport ?? null,
          placement?.rect ?? null,
        );
        const size = 56;
        ctx.fillStyle = '#f3ce22';
        ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
        ctx.fillStyle = '#0b1119';
        ctx.font = '900 32px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, point.x, point.y + 1);
      };
      if (geometry?.mapKey === 'de_ancient') {
        // Valve overview artwork already owns spawn-zone geometry. Only add
        // calibrated broadcast labels at the centers of the source bombsites.
        drawSiteBadge('A', { x: 0.302, y: 0.26 }, 'single');
        drawSiteBadge('B', { x: 0.8, y: 0.4 }, 'single');
      } else if (geometry?.mapKey === 'de_nuke') {
        drawSiteBadge('A', { x: 0.58, y: 0.48 }, 'upper');
        drawSiteBadge('B', { x: 0.58, y: 0.58 }, 'lower');
      }

      if (geometry && payload) {
        // Active effects are spatial footprints, not enlarged grenade markers.
        // Eon (ISC) and Lexogrine (MIT) informed the state split; this Canvas
        // implementation is original and keeps RivalHub's calibrated truth.
        let flameCount = 0;
        for (const source of payload.grenades.slice(0, RADAR_PRESENTATION.maxGrenades)) {
          if (source.flames.length === 0) continue;
          const flamePoints: Array<{
            readonly x: number;
            readonly y: number;
            readonly radius: number;
            readonly opacity: number;
          }> = [];
          for (const flame of source.flames) {
            if (++flameCount > RADAR_PRESENTATION.maxFlames) break;
            const projected = projectWorldPosition(flame.position, geometry);
            if (!projected || projected.outOfBounds) continue;
            const point = pointAt(projected);
            if (point === null) continue;
            const worldRadius = projectWorldRadius(52, geometry) ?? 0;
            const radius = Math.max(8, Math.min(18, radiusAt(worldRadius, projected.layer)));
            flamePoints.push({
              x: point.x,
              y: point.y,
              radius,
              opacity: layerOpacity(projected, model.layer),
            });
          }
          if (flamePoints.length === 0) continue;

          ctx.save();
          ctx.filter = 'blur(5px)';
          ctx.fillStyle = '#e85f2f';
          for (const flame of flamePoints) {
            ctx.globalAlpha = flame.opacity * 0.46;
            circle(flame.x, flame.y, flame.radius * 1.45, '#e85f2f');
          }
          ctx.filter = 'none';
          ctx.globalCompositeOperation = 'lighter';
          for (const flame of flamePoints) {
            ctx.globalAlpha = flame.opacity * 0.58;
            circle(flame.x, flame.y, flame.radius * 0.9, '#f49b3d');
            ctx.globalAlpha = flame.opacity * 0.34;
            circle(flame.x, flame.y, flame.radius * 0.42, '#ffd16a');
          }
          ctx.globalCompositeOperation = 'source-over';
          const centroid = effectCentroid(flamePoints);
          if (centroid !== null) {
            ctx.globalAlpha =
              flamePoints.reduce((sum, flame) => sum + flame.opacity, 0) /
              flamePoints.length /
              2.5;
            const ownerSide =
              payload.players.find((player) => player.sourcePlayerId === source.ownerSourceId)
                ?.side ?? 'unknown';
            circle(centroid.x, centroid.y, 5, sideColor(ownerSide));
          }
          ctx.restore();
        }

        for (const marker of model.grenades.values()) {
          if (!isActiveSmoke(marker.source)) continue;
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          if (point === null) continue;
          const x = point.x;
          const y = point.y;
          const opacity = layerOpacity(marker.target, model.layer);
          const radius = radiusAt(projectWorldRadius(144, geometry) ?? 0, marker.target.layer);
          const contour = smokeContour(marker.source.sourceEntityId, radius).map((offset) => ({
            x: x + offset.x,
            y: y + offset.y,
          }));

          ctx.save();
          ctx.globalAlpha = opacity;
          smoothClosedPath(contour);
          ctx.fillStyle = '#aab2ba24';
          ctx.fill();

          for (const lobe of smokeLobes(marker.source.sourceEntityId, radius)) {
            const lx = x + lobe.dx;
            const ly = y + lobe.dy;
            const fill = ctx.createRadialGradient(lx, ly, 0, lx, ly, lobe.radius);
            fill.addColorStop(0, '#eef1f270');
            fill.addColorStop(0.48, '#c7cdd152');
            fill.addColorStop(0.82, '#9ca5ad30');
            fill.addColorStop(1, '#7f899200');
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.arc(lx, ly, lobe.radius, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.globalAlpha = opacity * 0.58;
          smoothClosedPath(contour);
          ctx.strokeStyle = sideColor(marker.side);
          ctx.lineWidth = 1.75;
          ctx.stroke();

          const remaining = smokeRemaining(marker.source.effectTimeSeconds);
          if (remaining !== null) {
            ctx.globalAlpha = opacity * 0.7;
            ctx.beginPath();
            ctx.arc(
              x,
              y,
              radius + 7,
              -Math.PI / 2,
              -Math.PI / 2 + (Math.PI * 2 * remaining) / SMOKE_PRESENTATION_DURATION_SECONDS,
            );
            ctx.strokeStyle = '#f3f6fa';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
          ctx.restore();
        }
        const drawTrail = (
          marker: typeof model.grenades extends Map<string, infer V> ? V : never,
          alpha: number,
        ) => {
          const trail = marker.trail
            .map((point) => pointAt(point, marker.target.layer))
            .filter((point): point is NonNullable<typeof point> => point !== null);
          if (trail.length < 2) return;
          ctx.globalAlpha = alpha * 0.34;
          ctx.strokeStyle = sideColor(marker.side);
          ctx.lineWidth = 2;
          ctx.beginPath();
          trail.forEach((point, index) =>
            index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
          );
          ctx.stroke();
          ctx.globalAlpha = 1;
        };
        for (const exit of model.exits.values()) {
          const alpha = Math.max(0, (exit.until - now) / RADAR_PRESENTATION.exitMs);
          drawTrail(exit.marker, alpha);
          ctx.globalAlpha = alpha;
          const exitPoint = pointAt(exit.marker.target);
          if (exitPoint) {
            circle(
              exitPoint.x,
              exitPoint.y,
              15 + (1 - alpha) * 18,
              '#ffffff10',
              sideColor(exit.marker.side),
              2,
            );
          }
          ctx.globalAlpha = 1;
        }
        for (const marker of model.grenades.values()) {
          if (!marker.airborne) continue;
          drawTrail(marker, 1);
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          if (point === null) continue;
          const x = point.x;
          const y = point.y;
          ctx.globalAlpha = layerOpacity(marker.target, model.layer);
          circle(x, y, 18, '#00000000', sideColor(marker.side), 1.5);
          const url = grenadeIcon(marker.source.kind, marker.side);
          const icon = url && imageFor(url);
          if (icon) ctx.drawImage(icon, x - 14, y - 14, 28, 28);
          else {
            ctx.fillStyle = '#ecedef';
            ctx.fillRect(x - 6, y - 6, 12, 12);
          }
          ctx.globalAlpha = 1;
        }
        const bomb = payload.bomb;
        const bombAsset = getCs2Asset('objective.c4');
        const bombIcon = bombAsset && imageFor(bombAsset.outputPath);
        if (
          bomb &&
          bomb.state !== 'carried' &&
          bomb.state !== 'unknown' &&
          !(bomb.state === 'planting' && bomb.sourcePlayerId !== null) &&
          model.bombVisible(now)
        ) {
          const p = projectWorldPosition(bomb.position, geometry);
          if (p && !p.outOfBounds) {
            const point = pointAt(p);
            if (point !== null) {
              const x = point.x;
              const y = point.y;
              ctx.globalAlpha = layerOpacity(p, model.layer);
              circle(
                x,
                y,
                27,
                '#00000000',
                bomb.state === 'defusing' || bomb.state === 'defused'
                  ? '#83d8e8'
                  : bomb.state === 'planting'
                    ? '#aab4c0'
                    : bomb.state === 'planted'
                      ? '#f06f6f'
                      : '#f3f6fa',
                3,
              );
              if (bombIcon) ctx.drawImage(bombIcon, x - 20, y - 20, 40, 40);
              ctx.globalAlpha = 1;
            }
          }
        }
        for (const marker of model.players.values()) {
          const p = marker.source;
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          if (point === null) continue;
          const x = point.x;
          const y = point.y;
          const alive = p.lifeState === 'alive';
          const color = sideColor(p.side);
          ctx.globalAlpha = layerOpacity(marker.target, model.layer);
          if (!alive) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(x - 19, y - 19);
            ctx.lineTo(x + 19, y + 19);
            ctx.moveTo(x - 19, y + 19);
            ctx.lineTo(x + 19, y - 19);
            ctx.stroke();
            ctx.globalAlpha = 1;
            continue;
          }
          if (payload.observedPlayerSourceId === p.sourcePlayerId)
            circle(x, y, 37, '#00000000', '#ffffff', 5);
          if (p.forward) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((marker.angle * Math.PI) / 180);
            ctx.beginPath();
            ctx.moveTo(37, 0);
            ctx.lineTo(14, -13);
            ctx.lineTo(14, 13);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (marker.shootingUntil > now) {
              ctx.fillStyle = '#fff4b0';
              ctx.fillRect(34, -4, 15, 8);
            }
            ctx.restore();
          }
          circle(x, y, 33, '#f3f6fa');
          circle(x, y, 29, color, '#0b1119', 2);
          ctx.fillStyle = '#0b1119';
          ctx.font = '800 32px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.observerSlot === null ? '?' : String(p.observerSlot), x, y + 1);
          if (alive && p.flashAmount !== null && p.flashAmount > 0) {
            ctx.globalAlpha = Math.min(1, p.flashAmount / 255);
            circle(x, y, 24, '#ffffff55', '#ffffff', 4);
            ctx.globalAlpha = 1;
          }
          if (marker.damageUntil > now) circle(x, y, 27, '#00000000', '#ff6c69', 5);
          if (
            bomb?.sourcePlayerId === p.sourcePlayerId &&
            (bomb.state === 'carried' || bomb.state === 'planting')
          ) {
            circle(x + 32, y + 32, 18, '#00000000', '#f3f6fa', 2);
            if (bombIcon) ctx.drawImage(bombIcon, x + 16, y + 16, 32, 32);
          }
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      if (!payload) {
        // Safe fail-closed presentation without disruptive center placeholder
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe?.();
      model.reset();
      images.clear();
    };
  }, [client, zoomMode]);
  if (client === undefined && snapshot == null) {
    return null;
  }
  return <canvas aria-label="比赛雷达" className="radar" ref={canvas} />;
}

export function RadarWidget({ radarClient, radarSnapshot, settings }: RadarHudWidgetRendererProps) {
  return (
    <Radar
      client={radarClient}
      snapshot={radarSnapshot}
      zoomMode={settings.settings.zoomMode === 'auto' ? 'auto' : 'full-map'}
    />
  );
}
