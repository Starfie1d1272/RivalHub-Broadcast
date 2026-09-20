import type { CSSProperties, PointerEvent } from 'react';

import {
  HUD_WIDGET_REGISTRY,
  placementToBox,
  type HudResolvedPreset,
  type HudWidgetId,
} from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import type { LocalChannelConnectionState } from '../realtime';

import './gameplay-hud.css';

export type GameplayHudMode = 'program' | 'editor';

export interface GameplayHudProps {
  readonly snapshot: ProgramSnapshot | null;
  readonly resolvedPreset: HudResolvedPreset;
  readonly mode: GameplayHudMode;
  readonly connectionState?: LocalChannelConnectionState | undefined;
  readonly selectedWidgetId?: HudWidgetId | null;
  readonly onWidgetPointerDown?:
    ((widgetId: HudWidgetId, event: PointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onRadarResizePointerDown?:
    ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
}

function canRenderProgram(
  snapshot: ProgramSnapshot | null,
  connectionState: LocalChannelConnectionState | undefined,
): boolean {
  if (snapshot === null || snapshot.payload.status.telemetry !== 'fresh') return false;
  if (connectionState === undefined) return true;
  return connectionState === 'live';
}

function themeStyle(theme: HudResolvedPreset['theme']): CSSProperties {
  return {
    '--rh-hud-brand': theme.brandColor,
    '--rh-hud-text': theme.semantic.colors.textPrimary,
    '--rh-hud-muted': theme.semantic.colors.textMuted,
    '--rh-hud-side-ct': theme.semantic.colors.sideCt,
    '--rh-hud-side-t': theme.semantic.colors.sideT,
    '--rh-hud-surface': theme.semantic.surface.primary,
    '--rh-hud-surface-strong': theme.semantic.surface.strong,
    '--rh-hud-surface-opacity': theme.semantic.surface.opacity,
    '--rh-hud-border-opacity': theme.semantic.surface.borderOpacity,
    '--rh-hud-radius-md': `${theme.semantic.radius.md}px`,
  } as CSSProperties;
}

export function GameplayHud({
  snapshot,
  resolvedPreset,
  mode,
  connectionState,
  selectedWidgetId = null,
  onWidgetPointerDown,
  onRadarResizePointerDown,
}: GameplayHudProps) {
  if (mode === 'program' && !canRenderProgram(snapshot, connectionState)) return null;

  return (
    <div
      className={`gameplay-hud gameplay-hud--${mode}`}
      data-gameplay-hud="true"
      data-hud-preset-id={resolvedPreset.preset.id}
      style={themeStyle(resolvedPreset.theme)}
    >
      {HUD_WIDGET_REGISTRY.map((descriptor) => {
        const placement = resolvedPreset.layout.widgets[descriptor.id];
        if (placement === undefined || !placement.visible) return null;
        if (mode === 'program' && descriptor.rendererAvailability === 'unimplemented') return null;
        const box = placementToBox(descriptor.id, placement);
        const selected = selectedWidgetId === descriptor.id;
        return (
          <div
            aria-label={mode === 'editor' ? `${descriptor.label}，可拖动` : undefined}
            className={`gameplay-hud__widget${selected ? ' is-selected' : ''}`}
            data-hud-widget={descriptor.id}
            data-renderer-availability={descriptor.rendererAvailability}
            key={descriptor.id}
            onPointerDown={
              mode === 'editor' && onWidgetPointerDown === undefined
                ? undefined
                : (event) => onWidgetPointerDown?.(descriptor.id, event)
            }
            style={{
              height: `${box.height}px`,
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
            }}
          >
            {mode === 'editor' ? (
              <>
                <span className="gameplay-hud__widget-label">{descriptor.label}</span>
                {descriptor.id === 'radar' && selected ? (
                  <button
                    aria-label="调整雷达大小"
                    className="gameplay-hud__resize-handle"
                    onPointerDown={onRadarResizePointerDown}
                    type="button"
                  />
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
