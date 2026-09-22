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
      ctx.setTransform(size / 1000, 0, 0, size / 1000, 0, 0);
      ctx.clearRect(0, 0, 1000, 1000);
      ctx.fillStyle = '#10191e';
      ctx.fillRect(0, 0, 1000, 1000);
      const style = getComputedStyle(element);
      const sideColor = (side: RadarSide) =>
        side === 'CT'
          ? style.getPropertyValue('--rh-hud-side-ct').trim() || '#77b8e8'
          : side === 'T'
            ? style.getPropertyValue('--rh-hud-side-t').trim() || '#eac56d'
            : '#c2c8ce';
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
      const layerRect = (layer: 'upper' | 'lower' | 'single' | 'unknown') =>
        multiLayer
          ? { x: 10, y: layer === 'lower' ? 510 : 10, width: 980, height: 480 }
          : { x: 0, y: 0, width: 1000, height: 1000 };
      const pointAt = (point: { x: number; y: number; layer: string }) => {
        const rect = layerRect(point.layer as 'upper' | 'lower' | 'single' | 'unknown');
        return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
      };
      const map = geometry && !multiLayer ? getRadarMapAsset(geometry.mapKey, model.layer) : null;
      const background = map ? imageFor(map.outputPath) : null;
      element.dataset.radarState = !payload ? 'unavailable' : 'live';
      element.dataset.radarDiagnostic = model.diagnosticReason ?? 'none';
      if (model.unsupportedMap === null) delete element.dataset.radarUnsupportedMap;
      else element.dataset.radarUnsupportedMap = model.unsupportedMap;
      element.dataset.radarLayer = model.layer;
      element.dataset.radarLayers = multiLayer ? 'simultaneous' : model.layer;
      element.dataset.radarPlayers = String(model.players.size);
      element.dataset.radarTrails = String(
        [...model.grenades.values()].reduce((n, g) => n + g.trail.length, 0),
      );
      ctx.save();
      const z = model.zoom;
      ctx.translate(500, 500);
      ctx.scale(z.scale, z.scale);
      ctx.translate(-z.x * 1000, -z.y * 1000);
      if (background) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(background, 0, 0, 1000, 1000);
        ctx.globalAlpha = 1;
      } else if (geometry && multiLayer) {
        for (const floor of ['upper', 'lower'] as const) {
          const asset = getRadarMapAsset(geometry.mapKey, floor);
          const image = asset ? imageFor(asset.outputPath) : null;
          if (!image) continue;
          const rect = layerRect(floor);
          ctx.globalAlpha = floor === model.layer ? 0.88 : model.layer === 'unknown' ? 0.76 : 0.62;
          ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        }
        ctx.globalAlpha = 1;
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
              ctx.globalAlpha = layerOpacity(p, model.layer);
              circle(point.x, point.y, 9, '#e99b4680', sideColor(side), 2);
              ctx.globalAlpha = 1;
            }
          }
        }
        for (const marker of model.grenades.values()) {
          if (!isActiveSmoke(marker.source)) continue;
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          const x = point.x;
          const y = point.y;
          ctx.globalAlpha = layerOpacity(marker.target, model.layer);
          // Approximate broadcast footprint, scaled through the domain calibration.
          const radius = (projectWorldRadius(144, geometry) ?? 0) * 1000;
          const fill = ctx.createRadialGradient(x, y, 0, x, y, radius);
          fill.addColorStop(0, '#c5cbd07a');
          fill.addColorStop(0.75, '#a8afb460');
          fill.addColorStop(1, '#a8afb410');
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
          ctx.globalAlpha = alpha * 0.6;
          ctx.strokeStyle = sideColor(marker.side);
          ctx.lineWidth = 3;
          ctx.beginPath();
          marker.trail.forEach((p, i) =>
            i
              ? ctx.lineTo(
                  pointAt({ ...p, layer: marker.target.layer }).x,
                  pointAt({ ...p, layer: marker.target.layer }).y,
                )
              : ctx.moveTo(
                  pointAt({ ...p, layer: marker.target.layer }).x,
                  pointAt({ ...p, layer: marker.target.layer }).y,
                ),
          );
          ctx.stroke();
          ctx.globalAlpha = 1;
        };
        for (const exit of model.exits.values()) {
          const alpha = Math.max(0, (exit.until - now) / RADAR_PRESENTATION.exitMs);
          drawTrail(exit.marker, alpha);
          ctx.globalAlpha = alpha;
          const exitPoint = pointAt(exit.marker.target);
          circle(
            exitPoint.x,
            exitPoint.y,
            15 + (1 - alpha) * 18,
            '#ffffff10',
            sideColor(exit.marker.side),
            2,
          );
          ctx.globalAlpha = 1;
        }
        for (const marker of model.grenades.values()) {
          if (!marker.airborne) continue;
          drawTrail(marker, 1);
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          const x = point.x;
          const y = point.y;
          ctx.globalAlpha = layerOpacity(marker.target, model.layer);
          circle(x, y, 20, '#142028', sideColor(marker.side), 3);
          const url = grenadeIcon(marker.source.kind);
          const icon = url && imageFor(url);
          if (icon) ctx.drawImage(icon, x - 10, y - 10, 20, 20);
          else {
            ctx.fillStyle = '#ecedef';
            ctx.fillRect(x - 4, y - 4, 8, 8);
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
            const x = point.x;
            const y = point.y;
            ctx.globalAlpha = layerOpacity(p, model.layer);
            circle(
              x,
              y,
              25,
              '#211c16',
              bomb.state === 'defusing' || bomb.state === 'defused' ? '#89d7b3' : '#f0ae6d',
              5,
            );
            if (bombIcon) ctx.drawImage(bombIcon, x - 13, y - 13, 26, 26);
            ctx.globalAlpha = 1;
          }
        }
        for (const marker of model.players.values()) {
          const p = marker.source;
          const point = pointAt({ ...marker.target, x: marker.x, y: marker.y });
          const x = point.x;
          const y = point.y;
          const alive = p.lifeState === 'alive';
          ctx.globalAlpha = (alive ? 1 : 0.4) * layerOpacity(marker.target, model.layer);
          const color = sideColor(p.side);
          if (payload.observedPlayerSourceId === p.sourcePlayerId)
            circle(x, y, 34, '#00000000', '#ffffff', 5);
          if (alive && p.forward) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((marker.angle * Math.PI) / 180);
            ctx.beginPath();
            ctx.moveTo(33, 0);
            ctx.lineTo(13, -12);
            ctx.lineTo(13, 12);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (marker.shootingUntil > now) {
              ctx.fillStyle = '#fff4b0';
              ctx.fillRect(34, -4, 15, 8);
            }
            ctx.restore();
          }
          circle(x, y, 26, color, '#10171f', 3);
          if (p.lifeState === 'dead') {
            ctx.strokeStyle = '#10171f';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(x - 8, y - 8);
            ctx.lineTo(x + 8, y + 8);
            ctx.moveTo(x - 8, y + 8);
            ctx.lineTo(x + 8, y - 8);
            ctx.stroke();
          } else {
            ctx.fillStyle = '#0c1420';
            ctx.font = 'bold 25px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.observerSlot === null ? '?' : String(p.observerSlot), x, y + 1);
          }
          if (alive && p.flashAmount !== null && p.flashAmount > 0) {
            ctx.globalAlpha = Math.min(1, p.flashAmount / 255);
            circle(x, y, 21, '#ffffff55', '#ffffff', 4);
            ctx.globalAlpha = 1;
          }
          if (marker.damageUntil > now) circle(x, y, 23, '#00000000', '#ff6c69', 5);
          if (
            bomb?.sourcePlayerId === p.sourcePlayerId &&
            (bomb.state === 'carried' || bomb.state === 'planting')
          ) {
            ctx.fillStyle = '#111a22';
            ctx.fillRect(x + 10, y + 10, 22, 22);
            if (bombIcon) ctx.drawImage(bombIcon, x + 11, y + 11, 20, 20);
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
