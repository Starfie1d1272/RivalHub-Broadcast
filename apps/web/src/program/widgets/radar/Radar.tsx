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
        'grayscale(0.78) saturate(0.12) brightness(1.03) contrast(1.18) ' +
        'drop-shadow(3px 0 0 rgba(243,246,250,.72)) ' +
        'drop-shadow(-3px 0 0 rgba(243,246,250,.72)) ' +
        'drop-shadow(0 3px 0 rgba(243,246,250,.72)) ' +
        'drop-shadow(0 -3px 0 rgba(243,246,250,.72))';
      if (singleImage) {
        ctx.globalAlpha = 1;
        drawArtwork(singleImage, placementFor('single'));
        ctx.globalAlpha = 1;
      } else if (geometry && multiLayer) {
        const floors =
          model.layer === 'upper' ? (['lower', 'upper'] as const) : (['upper', 'lower'] as const);
        for (const floor of floors) {
          const image = floor === 'upper' ? upperImage : lowerImage;
          if (!image) continue;
          ctx.globalAlpha = floor === model.layer ? 0.98 : model.layer === 'unknown' ? 0.86 : 0.72;
          drawArtwork(image, detachedFloors ? placementFor(floor) : null);
        }
        ctx.globalAlpha = 1;
      }
      ctx.filter = 'none';

      const drawSpawnZone = (x: number, y: number, width: number, height: number) => {
        ctx.fillStyle = 'rgba(47, 160, 96, 0.82)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = 'rgba(243, 246, 250, 0.82)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);
      };
      const drawSiteBadge = (label: 'A' | 'B', x: number, y: number) => {
        const size = 72;
        ctx.fillStyle = '#f3ce22';
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.fillStyle = '#0b1119';
        ctx.font = '900 40px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 1);
      };
      if (geometry?.mapKey === 'de_ancient') {
        drawSpawnZone(395, 0, 155, 205);
        drawSpawnZone(385, 855, 150, 125);
        drawSiteBadge('A', 190, 210);
        drawSiteBadge('B', 705, 485);
      } else if (geometry?.mapKey === 'de_nuke') {
        drawSpawnZone(122, 310, 104, 82);
        drawSpawnZone(790, 230, 105, 75);
        drawSiteBadge('A', 530, 255);
        drawSiteBadge('B', 175, 725);
      }

      if (geometry && payload) {
        // Effects are behind every player. Flame z is projected independently.
        let flameCount = 0;
        for (const source of payload.grenades.slice(0, RADAR_PRESENTATION.maxGrenades)) {
          const side =
            payload.players.find((p) => p.sourcePlayerId === source.ownerSourceId)?.side ??
            'unknown';
          for (const flame of source.flames) {
            if (++flameCount > RADAR_PRESENTATION.maxFlames) break;
            const p = projectWorldPosition(flame.position, geometry);
            if (p && !p.outOfBounds) {
              const point = pointAt(p);
              if (point) {
                ctx.globalAlpha = layerOpacity(p, model.layer);
                circle(point.x, point.y, 18, '#ef9e3f70', sideColor(side), 1.5);
                ctx.globalAlpha = 1;
              }
            }
          }
        }
        for (const marker of model.grenades.values()) {
          if (!isActiveSmoke(marker.source)) continue;
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          if (point === null) continue;
          const x = point.x;
          const y = point.y;
          ctx.globalAlpha = layerOpacity(marker.target, model.layer);
          // Approximate broadcast footprint, scaled through the domain calibration.
          const radius = radiusAt(projectWorldRadius(144, geometry) ?? 0, marker.target.layer);
          const fill = ctx.createRadialGradient(x, y, 0, x, y, radius);
          const smokeFill =
            marker.side === 'CT'
              ? ['#6aa8ff70', '#6aa8ff42', '#6aa8ff08']
              : marker.side === 'T'
                ? ['#f2bd4f70', '#f2bd4f42', '#f2bd4f08']
                : ['#c5cbd070', '#a8afb442', '#a8afb408'];
          fill.addColorStop(0, smokeFill[0]!);
          fill.addColorStop(0.75, smokeFill[1]!);
          fill.addColorStop(1, smokeFill[2]!);
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = sideColor(marker.side);
          ctx.lineWidth = 3;
          ctx.stroke();
          const remaining = smokeRemaining(marker.source.effectTimeSeconds);
          if (remaining !== null) {
            ctx.beginPath();
            ctx.arc(
              x,
              y,
              radius + 5,
              -Math.PI / 2,
              -Math.PI / 2 + (Math.PI * 2 * remaining) / SMOKE_PRESENTATION_DURATION_SECONDS,
            );
            ctx.lineWidth = 5;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
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
          circle(x, y, 24, '#0b1119', sideColor(marker.side), 3);
          const url = grenadeIcon(marker.source.kind);
          const icon = url && imageFor(url);
          if (icon) ctx.drawImage(icon, x - 20, y - 20, 40, 40);
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
                34,
                '#0b1119',
                bomb.state === 'defusing' || bomb.state === 'defused'
                  ? '#83d8e8'
                  : bomb.state === 'planting'
                    ? '#aab4c0'
                    : bomb.state === 'planted'
                      ? '#f06f6f'
                      : '#f3f6fa',
                5,
              );
              if (bombIcon) ctx.drawImage(bombIcon, x - 25, y - 25, 50, 50);
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
          circle(x, y, 30, color, '#0b1119', 3);
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
            ctx.fillStyle = '#0b1119';
            ctx.fillRect(x + 12, y + 12, 54, 54);
            if (bombIcon) ctx.drawImage(bombIcon, x + 14, y + 14, 50, 50);
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
